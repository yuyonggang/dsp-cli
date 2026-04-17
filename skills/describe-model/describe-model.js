/**
 * Skill Implementation: describe-model
 * Traverses the full dependency chain of an analytic model or view and prints
 * a human-readable summary: analytic model → view → fact table → dimension tables.
 */

import { getCommands } from "@sap/datasphere-cli";

const HOST = process.env.DATASPHERE_HOST;
const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;

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
    if (args[i] === "--name" && args[i + 1])   { params.name = args[++i]; }
    else if (args[i] === "--space" && args[i + 1]) { params.space = args[++i]; }
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

async function readRaw(commands, cliCommand, space, name) {
  try {
    const raw = await captureStdout(() =>
      commands[cliCommand]({ "--host": HOST, "--space": space, "--technical-name": name })
    );
    return parseJson(raw);
  } catch (err) {
    if (err?.response?.status === 404) return null;
    console.warn(`  Warning: could not read "${name}" (${cliCommand}): ${err.message}`);
    return null;
  }
}

// ─── Traversal helpers ────────────────────────────────────────────────────────

function getDefinition(data, name) {
  if (!data) return null;
  const defs = data.definitions || {};
  return defs[name] || Object.values(defs)[0] || null;
}

function getAssociations(elements) {
  return Object.entries(elements || {})
    .filter(([, d]) => d.type === "cds.Association")
    .map(([assocName, d]) => ({ assocName, target: d.target }));
}

function columnSummary(elements, indent = "    ") {
  const lines = [];
  for (const [name, def] of Object.entries(elements || {})) {
    if (def.type === "cds.Association") continue;
    const type = def.type || "?";
    const detail = def.length ? `(${def.length})`
      : def.precision ? `(${def.precision}${def.scale != null ? `,${def.scale}` : ""})` : "";
    const flags = [
      def.key ? "KEY" : "",
      def["@Analytics.dimension"] ? "dim" : "",
      def["@AnalyticsDetails.measureType"] ? "measure" : "",
    ].filter(Boolean).join(", ");
    lines.push(`${indent}${name.padEnd(35)} ${(type + detail).padEnd(22)} ${flags}`);
  }
  return lines.join("\n");
}

// ─── Main describe logic ──────────────────────────────────────────────────────

async function describeModel(params) {
  const commands = await authenticate();
  const { name, space } = params;

  console.log(`\n${"═".repeat(60)}`);
  console.log(`Model Description: ${name}  (space: ${space})`);
  console.log(`${"═".repeat(60)}`);

  // Try analytic model first
  const amData = await readRaw(commands, "objects analytic-models read", space, name);
  let sourceName = name;
  let isAM = false;

  if (amData) {
    isAM = true;
    const amDef = getDefinition(amData, name);
    const bl = (amData.businessLayerDefinitions || {})[name] || Object.values(amData.businessLayerDefinitions || {})[0];
    const label = amDef?.["@EndUserText.label"] || "-";
    sourceName = amDef?.query?.SELECT?.from?.ref?.[0] || name;

    console.log(`\n[ Analytic Model ]  ${name}`);
    console.log(`  Label  : ${label}`);
    console.log(`  Source : ${sourceName}`);

    if (bl) {
      const measures = Object.keys(bl.measures || {});
      const attributes = Object.keys(bl.attributes || {});
      const dims = Object.entries(bl.sourceModel?.dimensionSources || {});

      if (measures.length > 0) {
        console.log(`\n  Measures (${measures.length}):`);
        measures.forEach(m => console.log(`    • ${m}`));
      }
      if (attributes.length > 0) {
        console.log(`\n  Attributes (${attributes.length}):`);
        attributes.forEach(a => console.log(`    • ${a}`));
      }
      if (dims.length > 0) {
        console.log(`\n  Dimension Sources (${dims.length}):`);
        dims.forEach(([key, d]) => console.log(`    • ${key}  →  ${d.dataEntity?.key || "?"}`));
      }
    }
  } else {
    console.log(`\n  (No analytic model found with name ${name} — trying as view)`);
  }

  // Read the view (either the AM's source or the named object itself)
  const viewName = isAM ? sourceName : name;
  const viewData = await readRaw(commands, "objects views read", space, viewName);

  if (viewData) {
    const viewDef = getDefinition(viewData, viewName);
    const label = viewDef?.["@EndUserText.label"] || "-";
    const pattern = viewDef?.["@ObjectModel.modelingPattern"]?.["#"] || "-";
    const factSource = viewDef?.query?.SELECT?.from?.ref?.[0] || "-";
    const assocs = getAssociations(viewDef?.elements);

    console.log(`\n${"─".repeat(60)}`);
    console.log(`[ View ]  ${viewName}`);
    console.log(`  Label   : ${label}`);
    console.log(`  Pattern : ${pattern}`);
    console.log(`  Source  : ${factSource}`);

    if (assocs.length > 0) {
      console.log(`\n  Associations (${assocs.length}):`);
      assocs.forEach(({ assocName, target }) => console.log(`    • ${assocName}  →  ${target}`));
    }

    const nonAssocCols = Object.entries(viewDef?.elements || {}).filter(([, d]) => d.type !== "cds.Association");
    console.log(`\n  Columns (${nonAssocCols.length}):`);
    console.log(`    ${"Name".padEnd(35)} ${"Type".padEnd(22)} Flags`);
    console.log(`    ${"-".repeat(35)} ${"-".repeat(22)} ${"-".repeat(15)}`);
    console.log(columnSummary(viewDef?.elements));

    // Read the fact table
    if (factSource && factSource !== "-") {
      const tableData = await readRaw(commands, "objects local-tables read", space, factSource);
      if (tableData) {
        const tableDef = getDefinition(tableData, factSource);
        const tLabel = tableDef?.["@EndUserText.label"] || "-";
        const tPattern = tableDef?.["@ObjectModel.modelingPattern"]?.["#"] || "-";
        const tCols = Object.entries(tableDef?.elements || {}).filter(([, d]) => d.type !== "cds.Association");

        console.log(`\n${"─".repeat(60)}`);
        console.log(`[ Fact Table ]  ${factSource}`);
        console.log(`  Label   : ${tLabel}`);
        if (tPattern !== "-") console.log(`  Pattern : ${tPattern}`);
        console.log(`\n  Columns (${tCols.length}):`);
        console.log(`    ${"Name".padEnd(35)} ${"Type".padEnd(22)} Flags`);
        console.log(`    ${"-".repeat(35)} ${"-".repeat(22)} ${"-".repeat(15)}`);
        console.log(columnSummary(tableDef?.elements));
      }
    }

    // Read each dimension table
    if (assocs.length > 0) {
      for (const { assocName, target } of assocs) {
        if (!target) continue;
        const dimData = await readRaw(commands, "objects local-tables read", space, target);
        if (!dimData) continue;
        const dimDef = getDefinition(dimData, target);
        const dLabel = dimDef?.["@EndUserText.label"] || "-";
        const dCols = Object.entries(dimDef?.elements || {}).filter(([, d]) => d.type !== "cds.Association");

        console.log(`\n${"─".repeat(60)}`);
        console.log(`[ Dimension Table ]  ${target}  (via association: ${assocName})`);
        console.log(`  Label   : ${dLabel}`);
        console.log(`\n  Columns (${dCols.length}):`);
        console.log(`    ${"Name".padEnd(35)} ${"Type".padEnd(22)} Flags`);
        console.log(`    ${"-".repeat(35)} ${"-".repeat(22)} ${"-".repeat(15)}`);
        console.log(columnSummary(dimDef?.elements));
      }
    }
  } else if (!isAM) {
    console.log(`\n  Could not read object "${name}" as a view or analytic model.`);
    console.log("  Check the name and that it exists in the specified space.");
  }

  console.log(`\n${"═".repeat(60)}\n`);
}

async function main() {
  const params = parseArgs(process.argv.slice(2));

  if (!params.name) {
    console.error("Error: --name is required");
    console.error("Usage: node describe-model.js --name <analytic-model-or-view-name> [--space <space>]");
    process.exit(1);
  }

  await describeModel(params);
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/"))) {
  main().catch(err => { console.error("Fatal error:", err); process.exit(1); });
}

export { describeModel };
