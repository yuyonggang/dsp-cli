/**
 * Skill Implementation: add-columns-to-table
 * Adds columns to an existing local table in SAP Datasphere.
 * Updates definitions.elements and query.SELECT.columns. Idempotent.
 */

import { getCommands } from "@sap/datasphere-cli";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { parseColumnsFlag, columnExistsIn, buildCdsElement } from "../_lib/csn.js";

const HOST = process.env.DATASPHERE_HOST;
const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;

function validateEnvironment() {
  const missing = Object.entries({ DATASPHERE_HOST: HOST, CLIENT_ID, CLIENT_SECRET, SPACE: process.env.SPACE })
    .filter(([, v]) => !v).map(([k]) => k);
  if (missing.length > 0) {
    console.error("Missing required environment variables:", missing.join(", "));
    process.exit(1);
  }
}

function parseArgs(args) {
  const params = { name: null, space: process.env.SPACE, columns: null, noDeploy: false };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--name" && args[i + 1])         params.name = args[++i];
    else if (args[i] === "--space" && args[i + 1])   params.space = args[++i];
    else if (args[i] === "--columns" && args[i + 1]) params.columns = args[++i];
    else if (args[i] === "--no-deploy")              params.noDeploy = true;
  }
  return params;
}

async function captureStdout(fn) {
  const orig = process.stdout.write.bind(process.stdout);
  const chunks = [];
  process.stdout.write = (c) => { chunks.push(typeof c === "string" ? c : c.toString()); return true; };
  try { await fn(); } finally { process.stdout.write = orig; }
  return chunks.join("");
}

function parseObject(raw) {
  const start = raw.indexOf("{");
  if (start < 0) throw new Error(`No JSON in response:\n${raw}`);
  return JSON.parse(raw.slice(start));
}

async function readTable(commands, space, name) {
  const raw = await captureStdout(() =>
    commands["objects local-tables read"]({ "--host": HOST, "--space": space, "--technical-name": name })
  );
  return parseObject(raw);
}

async function saveTable(commands, space, name, payload, noDeploy) {
  const tmpFile = path.join(os.tmpdir(), `dsp_addcoltbl_${name}.json`);
  await fs.writeFile(tmpFile, JSON.stringify(payload, null, 2), "utf8");
  const opts = {
    "--host": HOST,
    "--space": space,
    "--technical-name": name,
    "--file-path": tmpFile,
    "--allow-missing-dependencies": true,
  };
  if (noDeploy) opts["--no-deploy"] = true;
  const raw = await captureStdout(() => commands["objects local-tables update"](opts));
  return parseObject(raw);
}

async function main() {
  validateEnvironment();
  const params = parseArgs(process.argv.slice(2));
  if (!params.name || !params.columns) {
    console.error("Usage: node add-columns-to-table.js --name <table> --columns \"NAME:TYPE:LEN:LABEL;...\" [--space <space>] [--no-deploy]");
    process.exit(1);
  }
  const cols = parseColumnsFlag(params.columns);

  const commands = await getCommands(HOST);
  await commands["login"]({
    "--host": HOST,
    "--client-id": CLIENT_ID,
    "--client-secret": CLIENT_SECRET,
    "--authorization-flow": "authorization_code",
    "--force": true,
  });
  try { await commands["config cache init"]({ "--host": HOST }); } catch { /* non-blocking */ }
  const freshCommands = await getCommands(HOST);

  console.log(`Reading table ${params.name}...`);
  const csn = await readTable(freshCommands, params.space, params.name);
  const defKey = Object.keys(csn.definitions || {}).find(k => k === params.name) || Object.keys(csn.definitions || {})[0];
  if (!defKey) { console.error("Table has no definition."); process.exit(1); }
  const def = csn.definitions[defKey];
  def.elements ||= {};
  // If the table has no query block, synthesize one that includes ALL existing elements
  // so we don't drop columns that were already there.
  if (!def.query) {
    def.query = {
      SELECT: {
        from: { ref: [defKey] },
        columns: Object.keys(def.elements).map(name => ({ ref: [name] })),
      },
    };
  }
  def.query.SELECT.columns ||= [];

  let added = 0, skipped = 0;
  for (const col of cols) {
    if (columnExistsIn(csn, defKey, col.name)) {
      console.log(`  - ${col.name}: already exists, skipping`);
      skipped++;
      continue;
    }
    def.elements[col.name] = buildCdsElement(col);
    def.query.SELECT.columns.push({ ref: [col.name] });
    console.log(`  + ${col.name}: added (${col.cdsType}${col.length ? `, length ${col.length}` : ""})`);
    added++;
  }

  if (added === 0) {
    console.log(`\nNo new columns to add (${skipped} already present).`);
    return;
  }

  console.log(`\nSaving table with ${added} new column(s)...`);
  try {
    await saveTable(freshCommands, params.space, params.name, csn, params.noDeploy);
    console.log(`✓ Table ${params.name} updated.`);
    if (params.noDeploy) console.log("  (saved but not deployed — deploy manually in DSP UI)");
  } catch (err) {
    console.error(`✗ Save failed:`, err.response?.data || err.message);
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/"))) {
  main().catch(err => { console.error("Fatal:", err); process.exit(1); });
}

export { main };
