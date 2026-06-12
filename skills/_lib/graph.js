/**
 * Shared graph library for SAP Datasphere dependency analysis.
 * Extracted from impact-analysis.js so cascade skills can reuse the
 * graph builder, BFS, and cache without duplicating code.
 */

import { getCommands } from "@sap/datasphere-cli";
import { get as getConfig } from "@sap/cli-core/config/index.js";
import axios from "axios";
import fs from "fs/promises";
import path from "path";

export const HOST = process.env.DATASPHERE_HOST;
export const CLIENT_ID = process.env.CLIENT_ID;
export const CLIENT_SECRET = process.env.CLIENT_SECRET;
export const DSP_ACCEPT = "application/vnd.sap.datasphere.object.content.design-time+json";

// ─── Environment & Args ───────────────────────────────────────────────────────

export function validateEnvironment() {
  const missing = Object.entries({ DATASPHERE_HOST: HOST, CLIENT_ID, CLIENT_SECRET, SPACE: process.env.SPACE })
    .filter(([, v]) => !v).map(([k]) => k);
  if (missing.length > 0) {
    console.error("Missing required environment variables:", missing.join(", "));
    if (missing.includes("SPACE")) console.error("  -> Set SPACE=<your-space-id> in .env");
    process.exit(1);
  }
}

// ─── REST API helpers ─────────────────────────────────────────────────────────

export async function authenticate() {
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

export async function listAll(token, space, endpoint) {
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

export async function readObject(token, space, endpoint, name) {
  return axios.get(
    `${HOST}/dwaas-core/api/v1/spaces/${space}/${endpoint}/${name}`,
    { headers: { Authorization: token, Accept: DSP_ACCEPT } }
  ).then(r => r.data).catch(() => null);
}

export async function readObjectsBatch(token, space, endpoint, names, concurrency = 20, label = "") {
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
export function extractSqlDependencies(script) {
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
export function extractFromRefs(from) {
  const refs = new Set();
  if (!from) return [];

  function walk(node) {
    if (!node || typeof node !== "object") return;
    // Simple ref: {ref: ["TableName"]} or {ref: ["TableName"], as: "alias"}
    // Parameterized ref: {ref: [{id: "TableName", args: {...}}]} (table-function call)
    if (node.ref && Array.isArray(node.ref)) {
      const head = node.ref[0];
      const name = typeof head === "string" ? head : head?.id;
      if (name) refs.add(name);
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

/**
 * Collect every CSN `from` clause from a view/AM `query`, including those
 * nested inside SET operators (UNION / INTERSECT / EXCEPT).
 * Shapes handled:
 *   - { SELECT: { from: ... } }
 *   - { SET: { op: "union", args: [{ SELECT: { from: ... } }, ...] } }
 *   - Nested SETs of SETs
 * Returns an array of `from` clause objects (may be empty).
 */
export function collectQueryFromClauses(query) {
  const out = [];
  function walk(q) {
    if (!q || typeof q !== "object") return;
    if (q.SELECT?.from) {
      const f = q.SELECT.from;
      // A `from` may itself be a SET (UNION of sub-selects). Recurse into it
      // so we collect the inner SELECTs' from clauses, not the SET wrapper.
      if (f.SET?.args && Array.isArray(f.SET.args)) {
        for (const arg of f.SET.args) walk(arg);
      } else {
        out.push(f);
      }
    }
    if (q.SET?.args && Array.isArray(q.SET.args)) {
      for (const arg of q.SET.args) walk(arg);
    }
  }
  walk(query);
  return out;
}

/**
 * Extract all source object names from a CSN `query` (SELECT or SET).
 * Returns deduplicated array.
 */
export function extractQuerySources(query) {
  const refs = new Set();
  for (const from of collectQueryFromClauses(query)) {
    for (const r of extractFromRefs(from)) refs.add(r);
  }
  return [...refs];
}

// ─── Graph Construction ───────────────────────────────────────────────────────

export function parseViewNode(name, data) {
  const defs = data.definitions || {};
  const key = Object.keys(defs).find(k => k === name) || Object.keys(defs)[0];
  const def = defs[key];
  if (!def) return null;

  const query = def?.query;
  const fromClauses = collectQueryFromClauses(query);
  // Treat the view as having a single "primary" source only when there is
  // exactly one SELECT (no SET), exactly one from clause, and that clause is
  // a bare ref (no join). All other cases go through joinSources.
  const onlyFrom = fromClauses.length === 1 ? fromClauses[0] : null;
  const source = onlyFrom && onlyFrom.ref?.[0] && !onlyFrom.args && !onlyFrom.SELECT
    ? onlyFrom.ref[0]
    : null;
  const joinSources = source ? [] : extractQuerySources(query);
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

  // For SQL/table-function views, extract dependencies from the script.
  // DSP stores SQL in different fields depending on view type:
  //   @DataWarehouse.tableFunction.script  — table function views
  //   @DataWarehouse.sqlDefinition.script  — some SQL definition views
  //   @DataWarehouse.sqlEditor.query       — standard SQL views (sqlEditor mode)
  const sqlScript = def["@DataWarehouse.tableFunction.script"]
    || def["@DataWarehouse.sqlDefinition.script"]
    || def["@DataWarehouse.sqlEditor.query"];
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

export function parseAMNode(name, data) {
  const defs = data.definitions || {};
  const key = Object.keys(defs).find(k => k === name) || Object.keys(defs)[0];
  const def = defs[key];
  if (!def) return null;

  const query = def?.query;
  const fromClauses = collectQueryFromClauses(query);
  const onlyFrom = fromClauses.length === 1 ? fromClauses[0] : null;
  let source = null;
  if (onlyFrom && !onlyFrom.args && !onlyFrom.SELECT) {
    source = onlyFrom.ref?.[0] ?? (typeof onlyFrom === "string" ? onlyFrom : null);
  } else if (typeof query?.SELECT?.from === "string") {
    source = query.SELECT.from;
  }
  const joinSources = source ? [] : extractQuerySources(query);

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

export async function buildGraph(token, space, startName) {
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

export function cachePath(space) {
  return path.join(process.cwd(), ".cache", `graph-${space}.json`);
}

export function serializeGraph(graph) {
  return JSON.stringify({
    builtAt: graph.builtAt,
    space: graph.space,
    nodes: Object.fromEntries(graph.nodes),
    downstream: Object.fromEntries([...graph.downstream].map(([k, v]) => [k, v])),
    upstream: Object.fromEntries([...graph.upstream].map(([k, v]) => [k, v])),
  }, null, 2);
}

export function deserializeGraph(json) {
  const d = JSON.parse(json);
  return {
    builtAt: d.builtAt,
    space: d.space,
    nodes: new Map(Object.entries(d.nodes)),
    downstream: new Map(Object.entries(d.downstream)),
    upstream: new Map(Object.entries(d.upstream)),
  };
}

export async function loadCache(space) {
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

export async function saveCache(graph) {
  const dir = path.dirname(cachePath(graph.space));
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(cachePath(graph.space), serializeGraph(graph), "utf8");
  console.log(`  Graph cached to ${cachePath(graph.space)}`);
}

// ─── Graph Traversal ──────────────────────────────────────────────────────────

export function traceDownstream(graph, startName) {
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

export function traceUpstream(graph, startName) {
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
