/**
 * Skill Implementation: remove-column
 * Removes a column from a view (definitions, query, uiModel) and cascades
 * the removal to dependent analytic models. Uses --allow-missing-dependencies
 * to break circular dependency deadlocks.
 */

import { getCommands } from "@sap/datasphere-cli";
import fs from "fs/promises";
import os from "os";
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
  const params = { object: null, column: null, space: process.env.SPACE };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--object" && args[i + 1])   { params.object = args[++i]; }
    else if (args[i] === "--column" && args[i + 1])  { params.column = args[++i]; }
    else if (args[i] === "--space" && args[i + 1])   { params.space = args[++i]; }
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

async function readView(commands, space, name) {
  const raw = await captureStdout(() =>
    commands["objects views read"]({ "--host": HOST, "--space": space, "--technical-name": name })
  );
  const data = parseJson(raw);
  if (!data) throw new Error(`Could not read view ${name}`);
  return data;
}

async function saveView(commands, space, name, payload) {
  const tmpFile = path.join(os.tmpdir(), `dsp_removecol_${name}.json`);
  await fs.writeFile(tmpFile, JSON.stringify(payload, null, 2), "utf8");
  const raw = await captureStdout(() =>
    commands["objects views update"]({
      "--host": HOST,
      "--space": space,
      "--technical-name": name,
      "--file-path": tmpFile,
      "--no-deploy": true,
      "--allow-missing-dependencies": true,
    })
  );
  const jsonStart = raw.indexOf("{");
  return jsonStart >= 0 ? JSON.parse(raw.slice(jsonStart)) : { message: raw.trim() };
}

async function readAnalyticModel(commands, space, name) {
  try {
    const raw = await captureStdout(() =>
      commands["objects analytic-models read"]({ "--host": HOST, "--space": space, "--technical-name": name })
    );
    return parseJson(raw);
  } catch { return null; }
}

async function saveAnalyticModel(commands, space, name, payload) {
  const tmpFile = path.join(os.tmpdir(), `dsp_removecol_am_${name}.json`);
  await fs.writeFile(tmpFile, JSON.stringify(payload, null, 2), "utf8");
  try {
    const raw = await captureStdout(() =>
      commands["objects analytic-models update"]({
        "--host": HOST,
        "--space": space,
        "--technical-name": name,
        "--file-path": tmpFile,
        "--no-deploy": true,
        "--allow-missing-dependencies": true,
      })
    );
    const jsonStart = raw.indexOf("{");
    return jsonStart >= 0 ? JSON.parse(raw.slice(jsonStart)) : { message: raw.trim() };
  } catch (err) {
    console.error(`  Warning: could not update analytic model ${name}: ${err.message}`);
    if (err.response?.data) console.error("  Details:", JSON.stringify(err.response.data, null, 2));
    return null;
  }
}

// ─── View removal helpers ─────────────────────────────────────────────────────

function removeFromViewDefinitions(view, viewName, column) {
  const def = view.definitions[viewName];
  if (!def) throw new Error(`No definition for ${viewName}`);
  if (!def.elements[column]) {
    throw new Error(`Column "${column}" not found in view ${viewName}. Available: ${Object.keys(def.elements).join(", ")}`);
  }
  delete def.elements[column];
  console.log(`  [definitions] Removed: ${column}`);
}

function removeFromViewQuery(view, viewName, column) {
  const def = view.definitions[viewName];
  const cols = def.query?.SELECT?.columns;
  if (!cols) return;
  const before = cols.length;
  def.query.SELECT.columns = cols.filter(c => {
    const last = c.ref?.[c.ref.length - 1];
    return last !== column && c.as !== column;
  });
  console.log(`  [query] Removed ${before - def.query.SELECT.columns.length} reference(s)`);
}

function removeFromUiModel(view, viewName, column) {
  const editorSettings = view.editorSettings?.[viewName];
  if (!editorSettings?.uiModel) {
    console.log("  [uiModel] No uiModel found — skipping");
    return;
  }

  const ui = JSON.parse(editorSettings.uiModel);
  let removedCount = 0;

  for (const obj of Object.values(ui.contents || {})) {
    if (obj.elements && typeof obj.elements === "object") {
      const before = Object.keys(obj.elements).length;
      for (const [uuid, elem] of Object.entries(obj.elements)) {
        if (elem.name === column || elem.newName === column) {
          delete obj.elements[uuid];
          removedCount++;
        }
      }
    }
    // Remove element mappings that reference the column
    if (obj.classDefinition === "sap.cdw.commonmodel.ElementMapping") {
      if (obj.sourceElement?.name === column || obj.targetElement?.name === column) {
        // Mark for deletion — collect UUIDs to remove from parent
        obj._remove = true;
        removedCount++;
      }
    }
  }

  // Clean up marked element mappings
  for (const uuid of Object.keys(ui.contents || {})) {
    if (ui.contents[uuid]._remove) delete ui.contents[uuid];
  }

  editorSettings.uiModel = JSON.stringify(ui);
  console.log(`  [uiModel] Removed ${removedCount} reference(s)`);
}

// ─── Analytic model cascade ────────────────────────────────────────────────────

function removeFromAnalyticModel(amData, amName, column) {
  const def = (amData.definitions || {})[amName];
  const bl = (amData.businessLayerDefinitions || {})[amName];
  let changed = false;

  // definitions.elements
  if (def?.elements?.[column]) {
    delete def.elements[column];
    changed = true;
  }

  // query.SELECT.columns
  const cols = def?.query?.SELECT?.columns || [];
  const before = cols.length;
  def.query.SELECT.columns = cols.filter(c => {
    const last = c.ref?.[c.ref.length - 1];
    return last !== column && c.as !== column;
  });
  if (def.query.SELECT.columns.length !== before) changed = true;

  // businessLayer attributes — remove any that map to this column
  if (bl?.attributes) {
    for (const [attrName, attr] of Object.entries(bl.attributes)) {
      for (const mapping of Object.values(attr.attributeMapping || {})) {
        if (mapping.key === column) {
          delete bl.attributes[attrName];
          changed = true;
          break;
        }
      }
    }
  }

  // businessLayer measures — remove any that map to this column
  if (bl?.measures) {
    for (const [measureName, measure] of Object.entries(bl.measures)) {
      for (const mapping of Object.values(measure.measureMapping || {})) {
        if (mapping.key === column) {
          delete bl.measures[measureName];
          changed = true;
          break;
        }
      }
    }
  }

  return changed;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function removeColumn(params) {
  const { object: viewName, column, space } = params;

  console.log(`\nRemoving column: ${column}`);
  console.log(`View: ${viewName}  Space: ${space}\n`);

  const commands = await authenticate();

  // Step 1: Read the view
  console.log("Step 1: Reading view...");
  const view = await readView(commands, space, viewName);

  // Step 2: Remove from view
  console.log("\nStep 2: Updating view definition...");
  removeFromViewDefinitions(view, viewName, column);
  removeFromViewQuery(view, viewName, column);
  removeFromUiModel(view, viewName, column);

  await saveView(commands, space, viewName, view);
  console.log("  View saved successfully");

  // Step 3: Cascade to analytic models
  console.log("\nStep 3: Checking for dependent analytic models...");

  let amListRaw;
  try {
    amListRaw = await captureStdout(() =>
      commands["objects analytic-models list"]({ "--host": HOST, "--space": space })
    );
  } catch {
    console.log("  Could not list analytic models — skipping cascade.");
    amListRaw = null;
  }

  let amNames = [];
  if (amListRaw) {
    const amListJson = parseJson(amListRaw);
    const items = Array.isArray(amListJson) ? amListJson : (amListJson?.value || []);
    amNames = items.map(i => i.technicalName || i.name || i.TechnicalName).filter(Boolean);
  }

  let cascadeCount = 0;
  for (const amName of amNames) {
    const amData = await readAnalyticModel(commands, space, amName);
    if (!amData) continue;

    const amDef = (amData.definitions || {})[amName] || Object.values(amData.definitions || {})[0];
    const amSource = amDef?.query?.SELECT?.from?.ref?.[0];
    if (amSource !== viewName) continue;

    console.log(`  Found dependent analytic model: ${amName}`);
    const changed = removeFromAnalyticModel(amData, amName, column);
    if (changed) {
      await saveAnalyticModel(commands, space, amName, amData);
      console.log(`  Updated analytic model: ${amName}`);
      cascadeCount++;
    } else {
      console.log(`  No references to ${column} found in ${amName} — skipped`);
    }
  }

  console.log(`\nDone. Column removed from view + ${cascadeCount} analytic model(s).`);
  console.log("Note: Objects were saved with --no-deploy. Deploy from the Datasphere UI when ready.");
}

async function main() {
  const params = parseArgs(process.argv.slice(2));

  if (!params.object || !params.column) {
    console.error("Error: --object and --column are required");
    console.error("Usage: node remove-column.js --object <view-name> --column <col-name> [--space <space>]");
    process.exit(1);
  }

  await removeColumn(params);
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/"))) {
  main().catch(err => { console.error("Fatal error:", err); process.exit(1); });
}

export { removeColumn };
