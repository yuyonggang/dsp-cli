/**
 * Skill Implementation: propagate-columns
 * Cascade-adds new columns from a start object to every direct/join-edge
 * downstream view. Skips the start node itself. Skips association edges.
 * Warns on SQL views.
 */

import { runCascade, deployObject } from "../_lib/cascade.js";
import { parseColumnsFlag } from "../_lib/csn.js";
import { readObject } from "../_lib/graph.js";

function parseArgs(args) {
  const params = {
    start: null, space: process.env.SPACE, columns: null,
    dryRun: false, cache: false, refresh: false, noDeploy: false, force: false,
  };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--start" && args[i + 1])        params.start = args[++i];
    else if (args[i] === "--space" && args[i + 1])   params.space = args[++i];
    else if (args[i] === "--columns" && args[i + 1]) params.columns = args[++i];
    else if (args[i] === "--dry-run")    params.dryRun = true;
    else if (args[i] === "--cache")      params.cache = true;
    else if (args[i] === "--refresh")    params.refresh = true;
    else if (args[i] === "--no-deploy")  params.noDeploy = true;
    else if (args[i] === "--force")      params.force = true;
  }
  return params;
}

async function main() {
  const params = parseArgs(process.argv.slice(2));
  if (!params.start || !params.columns) {
    console.error("Usage: node propagate-columns.js --start <obj> --columns \"NAME:TYPE:LEN:LABEL;...\" [--space <space>] [--dry-run] [--cache] [--refresh] [--no-deploy] [--force]");
    process.exit(1);
  }
  const cols = parseColumnsFlag(params.columns);

  const { main: addColsToView } = await import("../add-columns-to-view/add-columns-to-view.js");

  const result = await runCascade({
    start: params.start,
    space: params.space,
    action: "add",
    dryRun: params.dryRun, cache: params.cache, refresh: params.refresh,
    noDeploy: params.noDeploy,
    force: params.force,
    processNode: async (item) => {
      // Skip the start node itself (depth 0) — caller seeds the start
      if (item.depth === 0) return { ok: true, skipped: "start node" };
      // Only views are processable
      if (item.node.type !== "view") return { ok: true, skipped: `non-view (${item.node.type})` };

      const argv = [
        "node", "add-columns-to-view.js",
        "--name", item.name,
        "--space", params.space,
        "--columns", params.columns,
        "--no-deploy",
        "--allow-missing-dependencies",
      ];
      const origArgv = process.argv;
      process.argv = argv;
      try {
        await addColsToView();
        return { ok: true };
      } catch (err) {
        return { ok: false, error: err.response?.data?.message || err.message };
      } finally {
        process.argv = origArgv;
      }
    },
    verifyNode: async (item, commands, token) => {
      if (item.depth === 0 || item.node.type !== "view") return { ok: true };
      const data = await readObject(token, params.space, "views", item.name);
      const def = data?.definitions?.[item.name] || Object.values(data?.definitions || {})[0];
      const elements = def?.elements || {};
      const missing = cols.filter(c => !elements[c.name]);
      return { ok: missing.length === 0, detail: missing.length > 0 ? `missing ${missing.map(c => c.name).join(",")}` : "" };
    },
    deployNode: async (item, commands, token, snapshotData) => {
      if (item.depth === 0 || item.node.type !== "view") return { ok: true };
      return deployObject(token, params.space, item.node.type, item.name, commands, snapshotData);
    },
  });

  process.exit(result.ok ? 0 : 1);
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/"))) {
  main().catch(err => { console.error("Fatal:", err); process.exit(1); });
}
