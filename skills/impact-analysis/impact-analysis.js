/**
 * Skill Implementation: impact-analysis
 * Builds an in-memory dependency graph of all views and analytic models in a
 * space in a single scan, then traverses it to show the full impact chain of
 * any object. Optionally detects missing columns in downstream objects.
 *
 * Key optimization: one scan (~2-3 min) replaces N sequential full scans
 * that find-dependents would need for an N-level chain.
 */

import { getCommands } from "@sap/datasphere-cli";
import { get as getConfig } from "@sap/cli-core/config/index.js";
import axios from "axios";
import fs from "fs/promises";
import path from "path";

const HOST = process.env.DATASPHERE_HOST;
const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;

const DSP_ACCEPT = "application/vnd.sap.datasphere.object.content.design-time+json";

// ─── Environment & Args ───────────────────────────────────────────────────────

function validateEnvironment() {
  const missing = Object.entries({ DATASPHERE_HOST: HOST, CLIENT_ID, CLIENT_SECRET, SPACE: process.env.SPACE })
    .filter(([, v]) => !v).map(([k]) => k);
  if (missing.length > 0) {
    console.error("Missing required environment variables:", missing.join(", "));
    if (missing.includes("SPACE")) console.error("  -> Set SPACE=<your-space-id> in .env");
    process.exit(1);
  }
}

function parseArgs(args) {
  const params = {
    name: null,
    space: process.env.SPACE,
    direction: "both",
    columns: [],
    cache: false,
    refresh: false,
  };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--name" && args[i + 1])        { params.name = args[++i]; }
    else if (args[i] === "--space" && args[i + 1])   { params.space = args[++i]; }
    else if (args[i] === "--direction" && args[i + 1]) { params.direction = args[++i]; }
    else if (args[i] === "--columns" && args[i + 1])   { params.columns = args[++i].split(",").map(c => c.trim()).filter(Boolean); }
    else if (args[i] === "--cache")   { params.cache = true; }
    else if (args[i] === "--refresh") { params.refresh = true; }
  }
  return params;
}

// ─── REST API helpers ─────────────────────────────────────────────────────────

async function authenticate() {
  validateEnvironment();
  const commands = await getCommands(HOST);
  await commands["login"]({
    "--host": HOST,
    "--client-id": CLIENT_ID,
    "--client-secret": CLIENT_SECRET,
    "--authorization-flow": "authorization_code",
    "--force": true,
  });
  try { await commands["config cache init"]({ "--host": HOST }); } catch { /* non-blocking */ }
  return getConfig().authorization?.authorization;
}

async function listAll(token, space, endpoint) {
  const items = [];
  let skip = 0;
  let top = 100;
  try {
    while (true) {
      const r = await axios.get(
        `${HOST}/dwaas-core/api/v1/spaces/${space}/${endpoint}?top=${top}&skip=${skip}`,
        { headers: { Authorization: token } }
      );
      const page = Array.isArray(r.data) ? r.data : Object.values(r.data || {});
      items.push(...page);
      if (page.length < top) break;
      skip += top;
      if (skip > 10000) break;
    }
  } catch (err) {
    // Fall back to smaller page size if API rejects top=100
    if (top === 100 && items.length === 0) {
      top = 25;
      return listAll(token, space, endpoint);
    }
    console.error(`Warning: error listing ${endpoint}: ${err.response?.data?.message || err.message}`);
  }
  // Deduplicate
  const seen = new Set();
  return items.filter(i => {
    const n = i.technicalName || i.name;
    if (seen.has(n)) return false;
    seen.add(n);
    return true;
  });
}

async function readObject(token, space, endpoint, name) {
  return axios.get(
    `${HOST}/dwaas-core/api/v1/spaces/${space}/${endpoint}/${name}`,
    { headers: { Authorization: token, Accept: DSP_ACCEPT } }
  ).then(r => r.data).catch(() => null);
}

async function readObjectsBatch(token, space, endpoint, names, concurrency = 20, label = "") {
  const results = new Map();
  let done = 0;
  for (let i = 0; i < names.length; i += concurrency) {
    const batch = names.slice(i, i + concurrency);
    const batchResults = await Promise.all(batch.map(async (name) => {
      const data = await readObject(token, space, endpoint, name);
      return { name, data };
    }));
    for (const { name, data } of batchResults) {
      if (data) results.set(name, data);
    }
    done += batch.length;
    if (names.length > 20) {
      process.stderr.write(`\r  Reading ${label}... ${done}/${names.length}`);
    }
  }
  if (names.length > 20) process.stderr.write("\n");
  return results;
}

// ─── SQL Script Parsing ───────────────────────────────────────────────────────

/**
 * Extract table/view references from a SQL table function script.
 * Looks for FROM "TableName" and JOIN "TableName" patterns.
 * Returns deduplicated array of referenced object names.
 */
function extractSqlDependencies(script) {
  if (!script) return [];
  const pattern = /(?:FROM|JOIN)\s+"([^"]+)"/gi;
  const refs = new Set();
  let m;
  while ((m = pattern.exec(script)) !== null) {
    refs.add(m[1]);
  }
  return [...refs];
}

/**
 * Recursively extract all source refs from a CSN `from` clause.
 * Handles simple refs ({ref:[...]}), joins ({join, args:[...]}),
 * and nested sub-selects ({SELECT:{from:...}}).
 * Returns deduplicated array of source object names.
 */
function extractFromRefs(from) {
  const refs = new Set();
  if (!from) return [];

  function walk(node) {
    if (!node || typeof node !== "object") return;
    // Simple ref: {ref: ["TableName"]} or {ref: ["TableName"], as: "alias"}
    if (node.ref && Array.isArray(node.ref)) {
      refs.add(node.ref[0]);
    }
    // Join: {join: "left", args: [...], on: [...]}
    if (node.args && Array.isArray(node.args)) {
      for (const arg of node.args) walk(arg);
    }
    // Sub-select: {SELECT: {from: ...}}
    if (node.SELECT?.from) {
      walk(node.SELECT.from);
    }
  }

  walk(from);
  return [...refs];
}

// ─── Graph Construction ───────────────────────────────────────────────────────

function parseViewNode(name, data) {
  const defs = data.definitions || {};
  const key = Object.keys(defs).find(k => k === name) || Object.keys(defs)[0];
  const def = defs[key];
  if (!def) return null;

  const fromClause = def?.query?.SELECT?.from;
  const source = fromClause?.ref?.[0] || null;
  const joinSources = source ? [] : extractFromRefs(fromClause);
  const elements = def?.elements || {};
  const columns = {};
  const associationTargets = [];

  for (const [colName, colDef] of Object.entries(elements)) {
    if (colDef.type === "cds.Association") {
      if (colDef.target) associationTargets.push(colDef.target);
    } else {
      const flags = [];
      if (colDef.key) flags.push("KEY");
      if (colDef.notNull) flags.push("NOT NULL");
      columns[colName] = {
        type: colDef.type || "unknown",
        length: colDef.length || null,
        flags,
      };
    }
  }

  // For SQL/table-function views, extract dependencies from the script
  const sqlScript = def["@DataWarehouse.tableFunction.script"]
    || def["@DataWarehouse.sqlDefinition.script"];
  const sqlSources = extractSqlDependencies(sqlScript);

  return {
    name,
    type: "view",
    label: def["@EndUserText.label"] || "",
    source,
    joinSources,
    associationTargets,
    sqlSources,
    columns,
    measures: null,
    attributes: null,
  };
}

function parseAMNode(name, data) {
  const defs = data.definitions || {};
  const key = Object.keys(defs).find(k => k === name) || Object.keys(defs)[0];
  const def = defs[key];
  if (!def) return null;

  const fromRef = def?.query?.SELECT?.from;
  const source = fromRef?.ref?.[0] ?? (typeof fromRef === "string" ? fromRef : null);
  const joinSources = source ? [] : extractFromRefs(fromRef);

  const elements = def?.elements || {};
  const columns = {};
  for (const [colName, colDef] of Object.entries(elements)) {
    if (colDef.type !== "cds.Association") {
      columns[colName] = { type: colDef.type || "unknown", length: colDef.length || null, flags: [] };
    }
  }

  const bl = data.businessLayerDefinitions?.[key]
    || Object.values(data.businessLayerDefinitions || {})[0];

  return {
    name,
    type: "analyticModel",
    label: def["@EndUserText.label"] || "",
    source,
    associationTargets: [],
    columns,
    measures: Object.keys(bl?.measures || {}),
    attributes: Object.keys(bl?.attributes || {}),
  };
}

async function buildGraph(token, space, startName) {
  const t0 = Date.now();

  // Phase 1: List all objects
  const [viewList, amList] = await Promise.all([
    listAll(token, space, "views"),
    listAll(token, space, "analyticmodels"),
  ]);

  const viewNames = viewList.map(v => v.technicalName || v.name);
  const amNames = amList.map(a => a.technicalName || a.name);

  console.log(`  Listed ${viewNames.length} views, ${amNames.length} analytic models`);

  // Phase 2: Read all definitions
  const [viewDefs, amDefs] = await Promise.all([
    readObjectsBatch(token, space, "views", viewNames, 20, "views"),
    readObjectsBatch(token, space, "analyticmodels", amNames, 20, "analytic models"),
  ]);

  // Phase 3: Parse into nodes and build edge maps
  const nodes = new Map();
  const downstream = new Map(); // source -> set of consumers
  const upstream = new Map();   // consumer -> set of sources

  function addEdge(sourceName, consumerName, edgeType) {
    if (!downstream.has(sourceName)) downstream.set(sourceName, []);
    downstream.get(sourceName).push({ target: consumerName, edgeType });
    if (!upstream.has(consumerName)) upstream.set(consumerName, []);
    upstream.get(consumerName).push({ target: sourceName, edgeType });
  }

  for (const [name, data] of viewDefs) {
    const node = parseViewNode(name, data);
    if (!node) continue;
    nodes.set(name, node);
    if (node.source) addEdge(node.source, name, "direct");
    for (const assocTarget of node.associationTargets) {
      addEdge(assocTarget, name, "association");
    }
    // Nested JOIN sources from CSN from-clause
    for (const joinRef of (node.joinSources || [])) {
      addEdge(joinRef, name, "join");
    }
    // SQL table function dependencies (FROM/JOIN inside script)
    for (const sqlRef of (node.sqlSources || [])) {
      addEdge(sqlRef, name, "sql");
    }
  }

  for (const [name, data] of amDefs) {
    const node = parseAMNode(name, data);
    if (!node) continue;
    nodes.set(name, node);
    if (node.source) addEdge(node.source, name, "direct");
    for (const joinRef of (node.joinSources || [])) {
      addEdge(joinRef, name, "join");
    }
  }

  // If the start object is a table (not in views/AMs), try reading it as a table
  if (!nodes.has(startName)) {
    const tableData = await readObject(token, space, "localtables", startName);
    if (tableData) {
      const defs = tableData.definitions || {};
      const key = Object.keys(defs).find(k => k === startName) || Object.keys(defs)[0];
      const def = defs[key];
      if (def) {
        const columns = {};
        for (const [colName, colDef] of Object.entries(def.elements || {})) {
          if (colDef.type !== "cds.Association") {
            columns[colName] = { type: colDef.type || "unknown", length: colDef.length || null, flags: [] };
          }
        }
        nodes.set(startName, {
          name: startName,
          type: "table",
          label: def["@EndUserText.label"] || "",
          source: null,
          associationTargets: [],
          columns,
          measures: null,
          attributes: null,
        });
      }
    }
  }

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  const edgeCount = [...downstream.values()].reduce((sum, edges) => sum + edges.length, 0);
  console.log(`  Graph built in ${elapsed}s: ${nodes.size} nodes, ${edgeCount} edges\n`);

  return { nodes, downstream, upstream, builtAt: new Date().toISOString(), space };
}

// ─── Cache ────────────────────────────────────────────────────────────────────

function cachePath(space) {
  return path.join(process.cwd(), ".cache", `graph-${space}.json`);
}

function serializeGraph(graph) {
  return JSON.stringify({
    builtAt: graph.builtAt,
    space: graph.space,
    nodes: Object.fromEntries(graph.nodes),
    downstream: Object.fromEntries([...graph.downstream].map(([k, v]) => [k, v])),
    upstream: Object.fromEntries([...graph.upstream].map(([k, v]) => [k, v])),
  }, null, 2);
}

function deserializeGraph(json) {
  const d = JSON.parse(json);
  return {
    builtAt: d.builtAt,
    space: d.space,
    nodes: new Map(Object.entries(d.nodes)),
    downstream: new Map(Object.entries(d.downstream)),
    upstream: new Map(Object.entries(d.upstream)),
  };
}

async function loadCache(space) {
  try {
    const json = await fs.readFile(cachePath(space), "utf8");
    const graph = deserializeGraph(json);
    console.log(`  Loaded cached graph from ${cachePath(space)}`);
    console.log(`  Built at: ${graph.builtAt}  (use --refresh to rebuild)\n`);
    return graph;
  } catch {
    return null;
  }
}

async function saveCache(graph) {
  const dir = path.dirname(cachePath(graph.space));
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(cachePath(graph.space), serializeGraph(graph), "utf8");
  console.log(`  Graph cached to ${cachePath(graph.space)}`);
}

// ─── Graph Traversal ──────────────────────────────────────────────────────────

function traceDownstream(graph, startName) {
  const tree = [];
  const visited = new Set();

  function bfs(name, depth, parentName, edgeType) {
    if (visited.has(name) && depth > 0) return;
    visited.add(name);

    const node = graph.nodes.get(name) || { name, type: "unknown", label: "" };
    tree.push({ name, node, depth, parentName, edgeType });

    const edges = graph.downstream.get(name) || [];
    for (const edge of edges) {
      bfs(edge.target, depth + 1, name, edge.edgeType);
    }
  }

  bfs(startName, 0, null, null);
  return tree;
}

function traceUpstream(graph, startName) {
  const tree = [];
  const visited = new Set();

  function bfs(name, depth, childName, edgeType) {
    if (visited.has(name) && depth > 0) return;
    visited.add(name);

    const node = graph.nodes.get(name) || { name, type: "unknown", label: "" };
    tree.push({ name, node, depth, childName, edgeType });

    const edges = graph.upstream.get(name) || [];
    for (const edge of edges) {
      bfs(edge.target, depth + 1, name, edge.edgeType);
    }
  }

  bfs(startName, 0, null, null);
  return tree;
}

// ─── Output Formatting ───────────────────────────────────────────────────────

function typeTag(type) {
  if (type === "analyticModel") return "[AM]";
  if (type === "view") return "[view]";
  if (type === "table") return "[table]";
  return "[?]";
}

function printTree(items, header) {
  console.log(`\n-- ${header} ${"--".repeat(Math.max(1, 30 - header.length / 2))}\n`);

  if (items.length <= 1) {
    console.log("  (no dependencies found)\n");
    return;
  }

  // Build a display tree with proper indentation
  const maxDepth = Math.max(...items.map(i => i.depth));
  let viewCount = 0, amCount = 0;

  for (const item of items) {
    const indent = "  " + "   ".repeat(item.depth);
    const tag = typeTag(item.node.type);
    const label = item.node.label ? `  "${item.node.label}"` : "";
    const edge = item.edgeType ? `  (${item.edgeType})` : "";

    if (item.depth === 0) {
      console.log(`  ${item.name}`);
    } else {
      console.log(`${indent}${tag} ${item.name}${label}${edge}`);
      if (item.node.type === "view") viewCount++;
      if (item.node.type === "analyticModel") amCount++;
    }
  }

  const total = viewCount + amCount;
  console.log(`\n  Summary: ${total} downstream object(s) (${viewCount} view(s), ${amCount} AM(s)), max depth ${maxDepth}\n`);
}

// ─── Column Gap Analysis ──────────────────────────────────────────────────────

function analyzeColumnGaps(graph, downstreamTree, columns) {
  if (columns.length === 0) return;

  console.log(`\n-- Column Propagation: ${columns.join(", ")} ${"--".repeat(10)}\n`);

  const actionPlan = [];

  for (const item of downstreamTree) {
    const node = item.node;
    const nodeColumns = node.columns || {};
    const indent = "  " + "   ".repeat(item.depth);

    if (item.depth === 0) {
      console.log(`  ${item.name}`);
    } else {
      console.log(`${indent}${typeTag(node.type)} ${item.name}`);
    }

    const missingCols = [];
    for (const col of columns) {
      const pad = "  " + "   ".repeat(item.depth) + "   ";
      if (nodeColumns[col]) {
        const t = nodeColumns[col].type;
        const len = nodeColumns[col].length ? `(${nodeColumns[col].length})` : "";
        console.log(`${pad}${col}: EXISTS (${t}${len})`);
      } else if (item.edgeType === "association") {
        console.log(`${pad}${col}: (association only - auto-visible via navigation)`);
      } else {
        // Find the parent to give context on blocking
        const parent = item.parentName;
        const parentNode = graph.nodes.get(parent);
        const parentHas = parentNode?.columns?.[col];

        if (node.type === "analyticModel") {
          const inAttrs = (node.attributes || []).includes(col);
          const inMeasures = (node.measures || []).includes(col);
          if (!inAttrs && !inMeasures) {
            if (parentHas) {
              console.log(`${pad}${col}: MISSING - add as attribute after source has it`);
            } else {
              console.log(`${pad}${col}: MISSING - blocked until ${parent} has it`);
            }
            missingCols.push(col);
          }
        } else {
          if (parentHas) {
            console.log(`${pad}${col}: MISSING - add to view`);
          } else {
            console.log(`${pad}${col}: MISSING - blocked until ${parent} has it`);
          }
          missingCols.push(col);
        }
      }
    }

    if (missingCols.length > 0 && item.edgeType !== "association") {
      const action = node.type === "analyticModel"
        ? `add ${missingCols.length} attribute(s): ${missingCols.join(", ")}`
        : `add ${missingCols.length} column(s): ${missingCols.join(", ")}`;
      actionPlan.push({ name: item.name, type: node.type, action, depth: item.depth });
    }
  }

  // Print action plan
  if (actionPlan.length > 0) {
    console.log(`\n-- Action Plan ${"--".repeat(25)}\n`);
    // Sort by depth (closest to source first = update order)
    actionPlan.sort((a, b) => a.depth - b.depth);
    actionPlan.forEach((a, i) => {
      const tag = typeTag(a.type);
      console.log(`  ${i + 1}. ${tag} ${a.name} - ${a.action}`);
    });
    console.log();
  } else {
    console.log("\n  All downstream objects already have the specified columns.\n");
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function impactAnalysis(params) {
  const { name, space, direction, columns, cache, refresh } = params;

  console.log("=".repeat(55));
  console.log(`Impact Analysis: ${name}  (space: ${space})`);
  console.log("=".repeat(55));
  console.log();

  // Build or load graph
  let graph;
  if (cache && !refresh) {
    graph = await loadCache(space);
  }

  if (!graph) {
    console.log("  Scanning space to build dependency graph...");
    const token = await authenticate();
    graph = await buildGraph(token, space, name);
    if (cache) await saveCache(graph);
  }

  // Check start node exists in graph
  if (!graph.nodes.has(name)) {
    // Try reading the start object as a table if not in graph
    console.log(`  Note: ${name} not found in scanned views/AMs.`);
    console.log(`  It may be a table referenced by views but not itself a view.\n`);

    // Check if anything references it
    if (!graph.downstream.has(name)) {
      console.log(`  No objects reference ${name} in space ${space}.`);
      return;
    }
  }

  // Downstream traversal
  if (direction === "both" || direction === "downstream") {
    const downTree = traceDownstream(graph, name);
    printTree(downTree, `Downstream (consumers of ${name})`);

    // Column gap analysis on downstream tree
    if (columns.length > 0) {
      analyzeColumnGaps(graph, downTree, columns);
    }
  }

  // Upstream traversal
  if (direction === "both" || direction === "upstream") {
    const upTree = traceUpstream(graph, name);
    printTree(upTree, `Upstream (sources of ${name})`);
  }
}

async function main() {
  const params = parseArgs(process.argv.slice(2));

  if (!params.name) {
    console.error("Error: --name is required");
    console.error("Usage: node impact-analysis.js --name <object-name> [--space <space>] [--direction both|downstream|upstream] [--columns col1,col2] [--cache] [--refresh]");
    process.exit(1);
  }

  if (!["both", "downstream", "upstream"].includes(params.direction)) {
    console.error(`Error: --direction must be one of: both, downstream, upstream (got: ${params.direction})`);
    process.exit(1);
  }

  await impactAnalysis(params);
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/"))) {
  main().catch(err => { console.error("Fatal error:", err); process.exit(1); });
}

export { impactAnalysis };
