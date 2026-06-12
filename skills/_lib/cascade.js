/**
 * Cascade orchestration: plan → backup → save → verify → deploy → summary.
 *
 * Used by propagate-columns, rename-column-cascade, remove-column-cascade.
 * Single-node skills are invoked via the SAP CLI (no shell-out to a child node
 * process — we call them as functions from within this process for speed and
 * shared auth state).
 */

import fs from "fs/promises";
import os from "os";
import path from "path";
import { getCommands } from "@sap/datasphere-cli";
import {
  HOST,
  authenticate,
  buildGraph,
  loadCache,
  saveCache,
  traceDownstream,
  readObject,
} from "./graph.js";

/** Sort BFS items by depth ascending (sources first); dedupe by name keeping shallowest. */
export function topoOrder(items) {
  const byName = new Map();
  for (const it of items) {
    const existing = byName.get(it.name);
    if (!existing || it.depth < existing.depth) byName.set(it.name, it);
  }
  return [...byName.values()].sort((a, b) => a.depth - b.depth);
}

/**
 * Classify an edge for cascade processing.
 *  - "process": direct or join — must update node
 *  - "skip":    association — auto-visible, no update needed
 *  - "warn":    sql — cannot auto-edit SQL views
 */
export function classifyEdge(edgeType) {
  if (edgeType === "association") return "skip";
  if (edgeType === "sql") return "warn";
  return "process";
}

/**
 * Backup raw CSN of every node in the plan to a timestamped folder.
 * Returns the backup directory path.
 */
export async function backupNodes(token, space, plan, action) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dir = path.join(process.cwd(), ".cache", "backups", `${stamp}-${action}`);
  await fs.mkdir(dir, { recursive: true });
  const snapshots = new Map(); // name → CSN data, reused later to avoid re-reads
  await Promise.all(plan.map(async (item) => {
    const endpoint = item.node.type === "analyticModel" ? "analyticmodels"
      : item.node.type === "table" ? "localtables"
      : "views";
    const data = await readObject(token, space, endpoint, item.name);
    if (data) {
      snapshots.set(item.name, data);
      await fs.writeFile(path.join(dir, `${item.name}.json`), JSON.stringify(data, null, 2));
    }
  }));
  return { dir, snapshots };
}

/** Pretty-print the plan to stdout. */
export function printPlan(plan, action) {
  console.log(`\n-- Cascade Plan (${action}) ${"-".repeat(40)}\n`);
  for (const item of plan) {
    const tag = item.node.type === "analyticModel" ? "[AM]"
      : item.node.type === "view" ? "[view]"
      : item.node.type === "table" ? "[table]" : "[?]";
    const cls = classifyEdge(item.edgeType || "direct");
    const marker = cls === "process" ? "✓" : cls === "skip" ? "·" : "!";
    console.log(`  ${marker} ${tag} ${item.name}  (depth ${item.depth}, edge ${item.edgeType || "root"})`);
  }
  console.log();
}

/**
 * Build the cascade plan from the graph:
 *  - BFS downstream from start
 *  - Topo-order
 */
export function buildPlan(graph, startName) {
  const tree = traceDownstream(graph, startName);
  const ordered = topoOrder(tree);
  return ordered;
}

/**
 * Deploy an object by re-reading its current CSN and re-saving it without --no-deploy.
 * The DSP CLI has no separate "deploy" sub-command — deploy is triggered by omitting
 * --no-deploy on the update call.
 *
 * IMPORTANT: Callers should generally NOT pass `snapshotData`. If a backup snapshot
 * captured before the save phase is passed in, this function will deploy that
 * (pre-modification) CSN and undo the changes. The default behavior — re-reading
 * fresh CSN — deploys whatever was just saved, which is what cascades want.
 * `snapshotData` is retained only for callers that intentionally want to deploy
 * a specific known CSN.
 *
 * @param {string} token  Bearer token
 * @param {string} space  Space ID
 * @param {"view"|"analyticModel"} type  Object type
 * @param {string} name   Technical name
 * @param {object} commands  CLI commands object
 * @param {object} [snapshotData]  Optional: deploy this CSN instead of re-reading
 * @returns {{ ok: boolean, error?: string }}
 */
export async function deployObject(token, space, type, name, commands, snapshotData) {
  const endpoint = type === "analyticModel" ? "analyticmodels" : "views";
  const cliCmd = type === "analyticModel" ? "objects analytic-models update" : "objects views update";
  const data = snapshotData || await readObject(token, space, endpoint, name);
  if (!data) return { ok: false, error: `could not read ${name} for deploy` };
  const tmpFile = path.join(os.tmpdir(), `dsp_deploy_${name}.json`);
  await fs.writeFile(tmpFile, JSON.stringify(data, null, 2), "utf8");
  try {
    await commands[cliCmd]({
      "--host": HOST,
      "--space": space,
      "--technical-name": name,
      "--file-path": tmpFile,
      "--allow-missing-dependencies": true,
      // --no-deploy intentionally omitted to trigger deploy
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.response?.data?.message || err.message };
  }
}

/**
 * Run the full cascade lifecycle.
 *
 * Args:
 *   start:        name of the starting object
 *   space:        space ID
 *   action:       "add" | "rename" | "remove" (used in backup dir name + summary)
 *   processNode:  async (item, commands, token) => { ok, error?, deployable? }
 *                 Called once per node classified as "process".
 *                 Returns ok=true on save success; false on failure.
 *   verifyNode:   async (item, commands, token) => { ok, detail }
 *                 Called per save-success node to confirm the change.
 *   deployNode:   async (item, commands, token) => { ok, error? }
 *                 Called per verified node when noDeploy=false. Should re-read
 *                 fresh CSN and deploy that — must NOT use a pre-save snapshot.
 *   dryRun, noDeploy, force, cache, refresh, maxNodes
 */
export async function runCascade(opts) {
  const {
    start, space, action,
    processNode, verifyNode, deployNode,
    dryRun = false, noDeploy = false, force = false,
    cache = false, refresh = false,
    maxNodes = 50,
  } = opts;

  console.log("=".repeat(60));
  console.log(`Cascade ${action}: ${start}  (space: ${space})`);
  console.log("=".repeat(60));

  // Build / load graph
  let graph;
  if (cache && !refresh) graph = await loadCache(space);
  let token;
  if (!graph) {
    console.log("\n  Scanning space to build dependency graph...");
    token = await authenticate();
    graph = await buildGraph(token, space, start);
    if (cache) await saveCache(graph);
  }

  // Plan
  const plan = buildPlan(graph, start);
  printPlan(plan, action);

  if (plan.length === 0) {
    console.log("  Nothing to do — start node has no downstream consumers.");
    return { ok: true, summary: [] };
  }

  // SQL warnings
  const sqlNodes = plan.filter(p => p.edgeType === "sql");
  if (sqlNodes.length > 0) {
    console.log(`  ! ${sqlNodes.length} SQL view(s) in chain — these will be skipped (manual edit required):`);
    for (const s of sqlNodes) console.log(`      - ${s.name}`);
  }

  // Guard
  const processable = plan.filter(p => classifyEdge(p.edgeType) === "process");
  if (processable.length > maxNodes && !force) {
    console.error(`\n  Aborting: ${processable.length} processable nodes > ${maxNodes}. Re-run with --force to proceed.`);
    return { ok: false, summary: [] };
  }

  if (dryRun) {
    console.log("\n  --dry-run: stopping before backup/save/deploy.");
    return { ok: true, summary: plan.map(p => ({ name: p.name, action: classifyEdge(p.edgeType) })) };
  }

  // Auth (if not already authed during graph build)
  if (!token) token = await authenticate();
  const { getCommands } = await import("@sap/datasphere-cli");
  const commands = await getCommands(process.env.DATASPHERE_HOST);

  // Backup
  console.log("\n  Backing up affected objects...");
  const { dir: backupDir, snapshots } = await backupNodes(token, space, plan, action);
  console.log(`  ✓ Backup: ${backupDir}`);

  // Save phase — group by depth so items at the same depth run in parallel
  console.log("\n  Save phase:");
  const summary = [];
  const depths = [...new Set(plan.map(p => p.depth))].sort((a, b) => a - b);
  for (const depth of depths) {
    const group = plan.filter(p => p.depth === depth);
    await Promise.all(group.map(async (item) => {
      const cls = classifyEdge(item.edgeType);
      const row = { name: item.name, type: item.node.type, edge: item.edgeType, depth: item.depth, save: "-", verify: "-", deploy: "-" };
      if (cls === "skip") {
        row.save = "skipped (assoc)";
        summary.push(row);
        return;
      }
      if (cls === "warn") {
        row.save = "skipped (sql)";
        summary.push(row);
        return;
      }
      try {
        const r = await processNode(item, commands, token);
        row.save = r.ok ? "✓" : `✗ ${r.error || "fail"}`;
      } catch (err) {
        row.save = `✗ ${err.response?.data?.message || err.message}`;
      }
      summary.push(row);
    }));
  }

  // Verify phase — all independent reads, run in parallel
  console.log("\n  Verify phase:");
  await Promise.all(summary.map(async (row) => {
    if (row.save !== "✓") return;
    const item = plan.find(p => p.name === row.name);
    try {
      const v = await verifyNode(item, commands, token);
      row.verify = v.ok ? "✓" : `✗ ${v.detail || ""}`;
    } catch (err) {
      row.verify = `✗ ${err.response?.data?.message || err.message}`;
    }
  }));

  // Deploy phase — must run serially: the @sap/datasphere-cli `commands` object
  // is not safe for concurrent invocations of the same command (parameters like
  // --technical-name and --file-path are stored on shared state, so parallel
  // deploys clobber each other and DSP rejects with "unexpected name").
  //
  // CRITICAL: We deliberately DO NOT pass the pre-save backup snapshot to the
  // deploy step. The snapshot was captured before saves modified the CSN, so
  // re-saving it would undo every column add/rename/remove we just persisted.
  // deployNode must re-read the *current* (post-save) CSN and deploy that.
  const allVerified = summary.every(r => r.save !== "✓" || r.verify === "✓");
  if (!noDeploy && allVerified) {
    console.log("\n  Deploy phase:");
    for (const row of summary) {
      if (row.verify !== "✓") continue;
      const item = plan.find(p => p.name === row.name);
      try {
        const d = await deployNode(item, commands, token);
        row.deploy = d.ok ? "✓" : `✗ ${d.error || ""}`;
      } catch (err) {
        row.deploy = `✗ ${err.response?.data?.message || err.message}`;
      }
    }
  } else if (!allVerified) {
    console.log("\n  Skipping deploy phase (verification failures present).");
  } else {
    console.log("\n  Skipping deploy phase (--no-deploy).");
  }

  // Summary table
  console.log("\n-- Summary " + "-".repeat(50));
  console.log(`  Backup: ${backupDir}\n`);
  for (const row of summary) {
    console.log(`  [${row.depth}] ${row.name}  edge=${row.edge}  save=${row.save}  verify=${row.verify}  deploy=${row.deploy}`);
  }

  const allOk = summary.every(r => (r.save === "✓" || r.save.includes("skipped")) && (r.verify === "✓" || r.verify === "-") && (r.deploy === "✓" || r.deploy === "-"));
  return { ok: allOk, summary, backupDir };
}
