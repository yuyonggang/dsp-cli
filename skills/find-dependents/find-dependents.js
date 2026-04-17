/**
 * Skill Implementation: find-dependents
 * Finds all views and analytic models in a space that reference a given
 * table or view. Uses direct REST API calls with full pagination.
 */

import { getCommands } from "@sap/datasphere-cli";
import { get as getConfig } from "@sap/cli-core/config/index.js";
import axios from "axios";

const HOST = process.env.DATASPHERE_HOST;
const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;

const DSP_ACCEPT = "application/vnd.sap.datasphere.object.content.design-time+json";

function validateEnvironment() {
  const missing = Object.entries({ DATASPHERE_HOST: HOST, CLIENT_ID, CLIENT_SECRET, SPACE: process.env.SPACE })
    .filter(([, v]) => !v).map(([k]) => k);
  if (missing.length > 0) {
    console.error("Missing required environment variables:", missing.join(", "));
    if (missing.includes("SPACE")) console.error("  → Set SPACE=<your-space-id> in .env");
    process.exit(1);
  }
}

function parseArgs(args) {
  const params = { name: null, space: process.env.SPACE };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--name" && args[i + 1])        { params.name = args[++i]; }
    else if (args[i] === "--space" && args[i + 1])  { params.space = args[++i]; }
  }
  return params;
}

// ─── REST API helpers ──────────────────────────────────────────────────────────

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

async function getAll(token, space, endpoint) {
  const items = [];
  let skip = 0;
  const top = 25;
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
  // Deduplicate by technical name
  const seen = new Set();
  return items.filter(i => {
    const n = i.technicalName || i.name;
    if (seen.has(n)) return false;
    seen.add(n);
    return true;
  });
}

async function readObject(token, space, endpoint, name) {
  const r = await axios.get(
    `${HOST}/dwaas-core/api/v1/spaces/${space}/${endpoint}/${name}`,
    { headers: { Authorization: token, Accept: DSP_ACCEPT } }
  ).catch(() => null);
  return r?.data || null;
}

// ─── Dependency analysis ───────────────────────────────────────────────────────

/**
 * Recursively extract all source refs from a CSN `from` clause.
 * Handles simple refs, joins ({join, args}), and nested sub-selects.
 */
function extractFromRefs(from) {
  const refs = new Set();
  if (!from) return [];
  function walk(node) {
    if (!node || typeof node !== "object") return;
    if (node.ref && Array.isArray(node.ref)) refs.add(node.ref[0]);
    if (node.args && Array.isArray(node.args)) for (const arg of node.args) walk(arg);
    if (node.SELECT?.from) walk(node.SELECT.from);
  }
  walk(from);
  return [...refs];
}

function analyzeViewDependency(data, name, targetName) {
  const defs = data.definitions || {};
  const key = Object.keys(defs)[0];
  const def = defs[key];
  if (!def) return null;

  const fromClause = def?.query?.SELECT?.from;
  const source = fromClause?.ref?.[0] || null;
  const assocTargets = Object.values(def?.elements || {})
    .filter(d => d.type === "cds.Association")
    .map(d => d.target);

  // Nested JOIN sources from CSN from-clause (when from is a join tree)
  const joinRefs = source ? [] : extractFromRefs(fromClause);
  const isJoinSource = joinRefs.includes(targetName);

  // SQL table function / SQL view: extract FROM/JOIN references from script
  const sqlScript = def["@DataWarehouse.tableFunction.script"]
    || def["@DataWarehouse.sqlDefinition.script"];
  const sqlRefs = [];
  if (sqlScript) {
    const pattern = /(?:FROM|JOIN)\s+"([^"]+)"/gi;
    let m;
    while ((m = pattern.exec(sqlScript)) !== null) {
      if (!sqlRefs.includes(m[1])) sqlRefs.push(m[1]);
    }
  }
  const isSqlSource = sqlRefs.includes(targetName);

  const isDirectSource = source === targetName;
  const isAssocTarget = assocTargets.includes(targetName);

  if (!isDirectSource && !isAssocTarget && !isSqlSource && !isJoinSource) return null;

  const columns = Object.keys(def?.elements || {})
    .filter(k => def.elements[k].type !== "cds.Association");
  const label = def["@EndUserText.label"] || "";

  return { name, label, source, assocTargets, columns, isDirectSource, isAssocTarget, isSqlSource, isJoinSource };
}

function analyzeAMDependency(data, name, targetName) {
  const defs = data.definitions || {};
  const key = Object.keys(defs)[0];
  const def = defs[key];
  if (!def) return null;

  const fromRef = def?.query?.SELECT?.from;
  const source = fromRef?.ref?.[0] ?? (typeof fromRef === "string" ? fromRef : null);
  const bl = data.businessLayerDefinitions?.[key]
    || Object.values(data.businessLayerDefinitions || {})[0];

  if (source !== targetName) return null;

  const label = def["@EndUserText.label"] || "";
  const measures = Object.keys(bl?.measures || {});
  const attributes = Object.keys(bl?.attributes || {});

  return { name, label, source, measures, attributes };
}

// ─── Output formatting ────────────────────────────────────────────────────────

function printViewResult(v) {
  console.log(`  ${v.name}`);
  if (v.label) console.log(`    Label  : ${v.label}`);
  if (v.isDirectSource) console.log(`    Source : ${v.source} (direct source table)`);
  if (v.isJoinSource)   console.log(`    Via    : JOIN source (nested join in from-clause)`);
  if (v.isSqlSource)    console.log(`    Via    : SQL script (FROM/JOIN in table function)`);
  if (v.isAssocTarget)  console.log(`    Via    : association target`);
  console.log(`    Columns: ${v.columns.join(", ")}`);
}

function printAMResult(a) {
  console.log(`  ${a.name}`);
  if (a.label) console.log(`    Label     : ${a.label}`);
  console.log(`    Source    : ${a.source}`);
  if (a.measures.length)   console.log(`    Measures  : ${a.measures.join(", ")}`);
  if (a.attributes.length) console.log(`    Attributes: ${a.attributes.join(", ")}`);
}

// ─── Concurrent scanning with rate limiting ────────────────────────────────────

async function scanObjects(token, space, endpoint, items, targetName, analyzeFn) {
  const CONCURRENCY = 10;
  const results = [];
  for (let i = 0; i < items.length; i += CONCURRENCY) {
    const batch = items.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.all(batch.map(async (item) => {
      const itemName = item.technicalName || item.name;
      const data = await readObject(token, space, endpoint, itemName);
      if (!data) return null;
      if (!JSON.stringify(data).includes(targetName)) return null;
      return analyzeFn(data, itemName, targetName);
    }));
    results.push(...batchResults.filter(Boolean));
  }
  return results;
}

// ─── Main ──────────────────────────────────────────────────────────────────────

async function findDependents(params) {
  const { name, space } = params;
  const token = await authenticate();

  console.log(`\nFinding dependents of: ${name}  (space: ${space})\n`);

  // Collect all objects
  const [views, ams] = await Promise.all([
    getAll(token, space, "views"),
    getAll(token, space, "analyticmodels"),
  ]);

  console.log(`Scanning ${views.length} views and ${ams.length} analytic models...\n`);

  const [viewResults, amResults] = await Promise.all([
    scanObjects(token, space, "views", views, name, analyzeViewDependency),
    scanObjects(token, space, "analyticmodels", ams, name, analyzeAMDependency),
  ]);

  // Print results
  console.log(`── Views referencing ${name} (${viewResults.length}) ──`);
  if (viewResults.length === 0) {
    console.log("  (none)");
  } else {
    viewResults.forEach(printViewResult);
  }

  console.log(`\n── Analytic Models referencing ${name} (${amResults.length}) ──`);
  if (amResults.length === 0) {
    console.log("  (none)");
  } else {
    amResults.forEach(printAMResult);
  }

  const total = viewResults.length + amResults.length;
  console.log(`\nSummary: ${viewResults.length} view(s), ${amResults.length} analytic model(s) — ${total} total dependent(s)\n`);
}

async function main() {
  const params = parseArgs(process.argv.slice(2));

  if (!params.name) {
    console.error("Error: --name is required");
    console.error("Usage: node find-dependents.js --name <table-or-view-name> [--space <space>]");
    process.exit(1);
  }

  await findDependents(params);
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/"))) {
  main().catch(err => { console.error("Fatal error:", err); process.exit(1); });
}

export { findDependents };
