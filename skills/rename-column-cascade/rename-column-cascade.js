/**
 * Skill Implementation: rename-column-cascade
 * Walks the downstream graph from --start and invokes the existing
 * rename-column skill on every direct-edge view + AM in the chain.
 *
 * The starting view IS included in the cascade (unlike propagate-columns).
 */

import { runCascade, deployObject } from "../_lib/cascade.js";
import { readObject } from "../_lib/graph.js";

function parseArgs(args) {
  const params = {
    start: null, space: process.env.SPACE, oldName: null, newName: null,
    dryRun: false, cache: false, refresh: false, noDeploy: false, force: false,
  };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--start" && args[i + 1])         params.start = args[++i];
    else if (args[i] === "--space" && args[i + 1])    params.space = args[++i];
    else if (args[i] === "--old-name" && args[i + 1]) params.oldName = args[++i];
    else if (args[i] === "--new-name" && args[i + 1]) params.newName = args[++i];
    else if (args[i] === "--dry-run")   params.dryRun = true;
    else if (args[i] === "--cache")     params.cache = true;
    else if (args[i] === "--refresh")   params.refresh = true;
    else if (args[i] === "--no-deploy") params.noDeploy = true;
    else if (args[i] === "--force")     params.force = true;
  }
  return params;
}

async function main() {
  const params = parseArgs(process.argv.slice(2));
  if (!params.start || !params.oldName || !params.newName) {
    console.error("Usage: node rename-column-cascade.js --start <view> --old-name <col> --new-name <col> [--space <space>] [--dry-run] [--cache] [--no-deploy] [--force]");
    process.exit(1);
  }

  const { main: renameCol } = await import("../rename-column/rename-column.js");

  const result = await runCascade({
    start: params.start,
    space: params.space,
    action: "rename",
    dryRun: params.dryRun, cache: params.cache, refresh: params.refresh,
    noDeploy: params.noDeploy,
    force: params.force,
    processNode: async (item) => {
      // rename-column only operates on views (it cascades to AMs internally for that view)
      if (item.node.type !== "view") return { ok: true, skipped: `${item.node.type} (handled by upstream view's rename)` };
      const origArgv = process.argv;
      process.argv = [
        "node", "rename-column.js",
        "--object", item.name,
        "--old-name", params.oldName,
        "--new-name", params.newName,
        "--space", params.space,
      ];
      try {
        await renameCol();
        return { ok: true };
      } catch (err) {
        return { ok: false, error: err.response?.data?.message || err.message };
      } finally {
        process.argv = origArgv;
      }
    },
    verifyNode: async (item, commands, token) => {
      const endpoint = item.node.type === "analyticModel" ? "analyticmodels" : "views";
      const data = await readObject(token, params.space, endpoint, item.name);
      const def = data?.definitions?.[item.name] || Object.values(data?.definitions || {})[0];
      const elements = def?.elements || {};
      const hasNew = Object.prototype.hasOwnProperty.call(elements, params.newName);
      const hasOld = Object.prototype.hasOwnProperty.call(elements, params.oldName);
      // For nodes that don't reference either column at all (e.g., AMs that don't expose the column),
      // verification passes if neither is present.
      if (!hasNew && !hasOld) return { ok: true, detail: "neither column present" };
      return { ok: hasNew && !hasOld, detail: !hasNew ? "new column missing" : hasOld ? "old column still present" : "" };
    },
    deployNode: async (item, commands, token, snapshotData) => {
      return deployObject(token, params.space, item.node.type, item.name, commands, snapshotData);
    },
  });

  process.exit(result.ok ? 0 : 1);
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/"))) {
  main().catch(err => { console.error("Fatal:", err); process.exit(1); });
}
