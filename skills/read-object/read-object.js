/**
 * Skill Implementation: read-object
 * Reads and displays the definition of an existing Datasphere object
 * in a human-readable format.
 */

import { getCommands } from "@sap/datasphere-cli";

const HOST = process.env.DATASPHERE_HOST;
const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;

const VALID_TYPES = ["table", "view", "analytic-model", "data-flow", "replication-flow", "transformation-flow"];

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
  const params = { name: null, type: null, space: process.env.SPACE, raw: false };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--name" && args[i + 1])   { params.name = args[++i]; }
    else if (args[i] === "--type" && args[i + 1])  { params.type = args[++i]; }
    else if (args[i] === "--space" && args[i + 1]) { params.space = args[++i]; }
    else if (args[i] === "--raw")              { params.raw = true; }
  }
  return params;
}

// ─── DSP helpers ──────────────────────────────────────────────────────────────

async function captureStdout(fn) {
  const orig = process.stdout.write.bind(process.stdout);
  const chunks = [];
  process.stdout.write = (chunk, ...rest) => { chunks.push(typeof chunk === "string" ? chunk : chunk.toString()); return true; };
  try { await fn(); } finally { process.stdout.write = orig; }
  return chunks.join("");
}

function parseJson(raw) {
  const i = raw.indexOf("{");
  if (i < 0) return null;
  try { return JSON.parse(raw.slice(i)); } catch { return null; }
}

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
  return getCommands(HOST);
}

// ─── Read commands per type ───────────────────────────────────────────────────

const READ_COMMANDS = {
  "table":               (cmds, space, name) => cmds["objects local-tables read"]({ "--host": HOST, "--space": space, "--technical-name": name }),
  "view":                (cmds, space, name) => cmds["objects views read"]({ "--host": HOST, "--space": space, "--technical-name": name }),
  "analytic-model":      (cmds, space, name) => cmds["objects analytic-models read"]({ "--host": HOST, "--space": space, "--technical-name": name }),
  "data-flow":           (cmds, space, name) => cmds["objects data-flows read"]({ "--host": HOST, "--space": space, "--technical-name": name }),
  "replication-flow":    (cmds, space, name) => cmds["objects replication-flows read"]({ "--host": HOST, "--space": space, "--technical-name": name }),
  "transformation-flow": (cmds, space, name) => cmds["objects transformation-flows read"]({ "--host": HOST, "--space": space, "--technical-name": name }),
};

// ─── Pretty printers ──────────────────────────────────────────────────────────

function printElements(elements) {
  if (!elements || Object.keys(elements).length === 0) { console.log("  (none)"); return; }
  const colW = 30;
  console.log(`  ${"Column".padEnd(colW)}  ${"Type".padEnd(20)}  ${"Flags"}`);
  console.log("  " + "-".repeat(colW) + "  " + "-".repeat(20) + "  " + "-".repeat(20));
  for (const [name, def] of Object.entries(elements)) {
    if (def.type === "cds.Association") continue; // handled separately
    const type = def.type || "?";
    const detail = def.length ? `(${def.length})`
      : (def.precision ? `(${def.precision}${def.scale != null ? `,${def.scale}` : ""})` : "");
    const flags = [
      def.key ? "KEY" : "",
      def.notNull ? "NOT NULL" : "",
      def["@Analytics.dimension"] ? "DIMENSION" : "",
      def["@AnalyticsDetails.measureType"] ? "MEASURE" : "",
    ].filter(Boolean).join(", ");
    console.log(`  ${name.padEnd(colW)}  ${(type + detail).padEnd(20)}  ${flags}`);
  }
}

function printAssociations(elements) {
  const assocs = Object.entries(elements || {}).filter(([, d]) => d.type === "cds.Association");
  if (assocs.length === 0) return;
  console.log("\n  Associations:");
  for (const [name, def] of assocs) {
    const target = def.target || "?";
    const on = (def.on || []).map(p => typeof p === "string" ? p : JSON.stringify(p)).join(" ");
    console.log(`    ${name}  →  ${target}  (${on})`);
  }
}

function printTable(def, name) {
  console.log(`\nLocal Table: ${name}`);
  console.log(`  Label   : ${def["@EndUserText.label"] || "-"}`);
  const pattern = def["@ObjectModel.modelingPattern"]?.["#"];
  if (pattern) console.log(`  Pattern : ${pattern}`);
  console.log("\n  Columns:");
  printElements(def.elements);
  printAssociations(def.elements);
}

function printView(def, name) {
  console.log(`\nView: ${name}`);
  console.log(`  Label   : ${def["@EndUserText.label"] || "-"}`);
  const pattern = def["@ObjectModel.modelingPattern"]?.["#"];
  if (pattern) console.log(`  Pattern : ${pattern}`);
  const source = def.query?.SELECT?.from?.ref?.[0] || def.query?.SELECT?.from?.ref?.join(".") || "-";
  console.log(`  Source  : ${source}`);
  console.log("\n  Columns:");
  printElements(def.elements);
  printAssociations(def.elements);
}

function printAnalyticModel(def, name, bl) {
  console.log(`\nAnalytic Model: ${name}`);
  console.log(`  Label   : ${def["@EndUserText.label"] || "-"}`);
  const source = def.query?.SELECT?.from?.ref?.[0] || "-";
  console.log(`  Source  : ${source}`);

  if (bl) {
    const measures = Object.entries(bl.measures || {});
    const attributes = Object.entries(bl.attributes || {});
    const dims = Object.entries(bl.sourceModel?.dimensionSources || {});

    if (dims.length > 0) {
      console.log("\n  Dimension Sources:");
      for (const [key, dim] of dims) {
        console.log(`    ${key}  →  ${dim.dataEntity?.key || "?"}`);
      }
    }
    if (measures.length > 0) {
      console.log("\n  Measures:");
      for (const [name] of measures) console.log(`    ${name}`);
    }
    if (attributes.length > 0) {
      console.log("\n  Attributes:");
      for (const [name] of attributes) console.log(`    ${name}`);
    }
  } else {
    console.log("\n  Columns:");
    printElements(def.elements);
  }
}

function printFlow(def, name, type) {
  const label = def["@EndUserText.label"] || def.label || "-";
  console.log(`\n${type}: ${name}`);
  console.log(`  Label   : ${label}`);
  const sources = Object.keys(def.sources || {});
  const targets = Object.keys(def.targets || {});
  if (sources.length > 0) console.log(`  Sources : ${sources.join(", ")}`);
  if (targets.length > 0) console.log(`  Targets : ${targets.join(", ")}`);
}

function prettyPrint(data, type, name) {
  // The CLI wraps the definition under the object's technical name
  const defs = data.definitions || {};
  const def = defs[name] || Object.values(defs)[0];

  if (!def) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  switch (type) {
    case "table":
      printTable(def, name);
      break;
    case "view":
      printView(def, name);
      break;
    case "analytic-model": {
      const bl = (data.businessLayerDefinitions || {})[name] || Object.values(data.businessLayerDefinitions || {})[0];
      printAnalyticModel(def, name, bl);
      break;
    }
    case "data-flow":
      printFlow(Object.values(data.dataflows || {})[0] || def, name, "Data Flow");
      break;
    case "replication-flow":
      printFlow(Object.values(data.replicationflows || {})[0] || def, name, "Replication Flow");
      break;
    case "transformation-flow":
      printFlow(def, name, "Transformation Flow");
      break;
    default:
      console.log(JSON.stringify(data, null, 2));
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function readObject(params) {
  const commands = await authenticate();

  const readFn = READ_COMMANDS[params.type];
  const raw = await captureStdout(() => readFn(commands, params.space, params.name));
  const data = parseJson(raw);

  if (!data) {
    console.error(`No data returned for ${params.name}. Raw output:\n${raw}`);
    process.exit(1);
  }

  if (params.raw) {
    console.log(JSON.stringify(data, null, 2));
  } else {
    prettyPrint(data, params.type, params.name);
    console.log("\n──────────────────────────────────────────");
    console.log("Run with --raw to see full CSN definition.");
  }
}

async function main() {
  const params = parseArgs(process.argv.slice(2));

  if (!params.name) {
    console.error("Error: --name is required");
    console.error(`Usage: node read-object.js --name <name> --type <type> [--space <space>] [--raw]`);
    console.error(`Types: ${VALID_TYPES.join(", ")}`);
    process.exit(1);
  }
  if (!params.type || !VALID_TYPES.includes(params.type)) {
    console.error(`Error: --type is required. Valid types: ${VALID_TYPES.join(", ")}`);
    process.exit(1);
  }

  await readObject(params);
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/"))) {
  main().catch(err => { console.error("Fatal error:", err); process.exit(1); });
}

export { readObject };
