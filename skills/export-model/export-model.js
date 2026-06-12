/**
 * Skill Implementation: export-model
 * Exports the full CSN definitions of a model and all its dependencies
 * (view, fact table, dimension tables) to a local directory as JSON files.
 * Useful for backup, version control, or migrating between tenants/spaces.
 */

import { getCommands } from "@sap/datasphere-cli";
import fs from "fs/promises";
import path from "path";

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
  const params = { name: null, space: process.env.SPACE, outputDir: "./export" };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--name" && args[i + 1])        { params.name = args[++i]; }
    else if (args[i] === "--space" && args[i + 1])      { params.space = args[++i]; }
    else if (args[i] === "--output-dir" && args[i + 1]) { params.outputDir = args[++i]; }
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

async function tryRead(commands, cliCommand, space, name) {
  try {
    const raw = await captureStdout(() =>
      commands[cliCommand]({ "--host": HOST, "--space": space, "--technical-name": name })
    );
    return parseJson(raw);
  } catch {
    return null;
  }
}

function getDefinition(data, name) {
  if (!data) return null;
  const defs = data.definitions || {};
  return defs[name] || Object.values(defs)[0] || null;
}

function getAssociations(elements) {
  return Object.entries(elements || {})
    .filter(([, d]) => d.type === "cds.Association")
    .map(([, d]) => d.target)
    .filter(Boolean);
}

// ─── Export helpers ───────────────────────────────────────────────────────────

async function exportObject(outputDir, filename, data) {
  const filePath = path.join(outputDir, filename);
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), "utf8");
  return filePath;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function exportModel(params) {
  const { name, space, outputDir } = params;

  console.log(`\nExporting model: ${name}  (space: ${space})`);
  console.log(`Output directory: ${outputDir}\n`);

  await fs.mkdir(outputDir, { recursive: true });

  const commands = await authenticate();
  const exported = [];

  // Try analytic model first
  const amData = await tryRead(commands, "objects analytic-models read", space, name);
  let viewName = name;

  if (amData) {
    const amDef = getDefinition(amData, name);
    viewName = amDef?.query?.SELECT?.from?.ref?.[0] || name;
    const fp = await exportObject(outputDir, `analytic-model_${name}.json`, amData);
    exported.push({ type: "Analytic Model", name, file: fp });
    console.log(`  Exported analytic model: ${name}`);
  }

  // Try reading as a view (either the AM source or the named object itself)
  const viewData = await tryRead(commands, "objects views read", space, viewName);
  let factTableName = null;
  let dimTableNames = [];

  if (viewData) {
    const viewDef = getDefinition(viewData, viewName);
    factTableName = viewDef?.query?.SELECT?.from?.ref?.[0] || null;
    dimTableNames = getAssociations(viewDef?.elements);

    const fp = await exportObject(outputDir, `view_${viewName}.json`, viewData);
    exported.push({ type: "View", name: viewName, file: fp });
    console.log(`  Exported view: ${viewName}`);
  }

  // Export fact table
  if (factTableName) {
    const tableData = await tryRead(commands, "objects local-tables read", space, factTableName);
    if (tableData) {
      const fp = await exportObject(outputDir, `table_${factTableName}.json`, tableData);
      exported.push({ type: "Fact Table", name: factTableName, file: fp });
      console.log(`  Exported fact table: ${factTableName}`);
    }
  }

  // Export dimension tables
  for (const dimName of dimTableNames) {
    const dimData = await tryRead(commands, "objects local-tables read", space, dimName);
    if (dimData) {
      const fp = await exportObject(outputDir, `table_${dimName}.json`, dimData);
      exported.push({ type: "Dimension Table", name: dimName, file: fp });
      console.log(`  Exported dimension table: ${dimName}`);
    }
  }

  // Write an index file
  const index = {
    exportedAt: new Date().toISOString(),
    space,
    rootObject: name,
    objects: exported.map(e => ({ type: e.type, name: e.name, file: path.basename(e.file) })),
  };
  const indexPath = path.join(outputDir, "index.json");
  await fs.writeFile(indexPath, JSON.stringify(index, null, 2), "utf8");

  console.log(`\nExport complete. ${exported.length} object(s) written to: ${outputDir}`);
  console.log(`Index: ${indexPath}\n`);
  console.log("Files:");
  for (const e of exported) {
    console.log(`  [${e.type.padEnd(16)}]  ${path.basename(e.file)}`);
  }
}

async function main() {
  const params = parseArgs(process.argv.slice(2));

  if (!params.name) {
    console.error("Error: --name is required");
    console.error("Usage: node export-model.js --name <analytic-model-or-view-name> [--space <space>] [--output-dir <path>]");
    process.exit(1);
  }

  await exportModel(params);
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/"))) {
  main().catch(err => { console.error("Fatal error:", err); process.exit(1); });
}

export { exportModel };
