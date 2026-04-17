/**
 * Skill Implementation: rename-column
 * Renames a column in a view, updating all three locations (definitions,
 * query, uiModel) and cascading the rename to any analytic models that
 * source from that view. Uses --allow-missing-dependencies to break the
 * circular dependency deadlock inherent in cross-object renames.
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
  const params = { object: null, oldName: null, newName: null, space: process.env.SPACE };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--object" && args[i + 1])    { params.object = args[++i]; }
    else if (args[i] === "--old-name" && args[i + 1]) { params.oldName = args[++i]; }
    else if (args[i] === "--new-name" && args[i + 1]) { params.newName = args[++i]; }
    else if (args[i] === "--space" && args[i + 1])    { params.space = args[++i]; }
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
  const tmpFile = path.join(os.tmpdir(), `dsp_rename_${name}.json`);
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
  const tmpFile = path.join(os.tmpdir(), `dsp_rename_am_${name}.json`);
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

// ─── View rename helpers ───────────────────────────────────────────────────────

function renameInViewDefinitions(view, viewName, oldName, newName) {
  const def = view.definitions[viewName];
  if (!def) throw new Error(`No definition for ${viewName}`);

  if (!def.elements[oldName]) {
    throw new Error(`Column "${oldName}" not found in view ${viewName}. Available: ${Object.keys(def.elements).join(", ")}`);
  }
  if (def.elements[newName]) {
    throw new Error(`Column "${newName}" already exists in view ${viewName}`);
  }

  // Rename in definitions.elements (preserve key order)
  const newElements = {};
  for (const [k, v] of Object.entries(def.elements)) {
    newElements[k === oldName ? newName : k] = v;
  }
  def.elements = newElements;

  // Update label if it was auto-generated from the old name
  if (def.elements[newName]["@EndUserText.label"] === oldName.replace(/_/g, " ")) {
    def.elements[newName]["@EndUserText.label"] = newName.replace(/_/g, " ");
  }

  console.log(`  [definitions] Renamed ${oldName} → ${newName}`);
}

function renameInViewQuery(view, viewName, oldName, newName) {
  const def = view.definitions[viewName];
  const cols = def.query?.SELECT?.columns;
  if (!cols) return;

  let renamed = 0;
  for (const col of cols) {
    if (!col.ref) continue;
    const last = col.ref[col.ref.length - 1];
    if (last === oldName) {
      col.ref[col.ref.length - 1] = newName;
      // If the column has an alias matching the old name, rename it too
      if (!col.as || col.as === oldName) col.as = newName;
      renamed++;
    }
    // Also rename if used as alias
    if (col.as === oldName) col.as = newName;
  }

  // Update mixin associations that might reference the column
  const mixin = def.query?.SELECT?.mixin || {};
  for (const mx of Object.values(mixin)) {
    for (const cond of mx.on || []) {
      if (cond.ref && cond.ref.includes(oldName)) {
        cond.ref = cond.ref.map(r => r === oldName ? newName : r);
      }
    }
  }

  console.log(`  [query] Renamed ${renamed} reference(s)`);
}

function renameInUiModel(view, viewName, oldName, newName) {
  const editorSettings = view.editorSettings?.[viewName];
  if (!editorSettings?.uiModel) {
    console.log("  [uiModel] No uiModel found — skipping (view may be in SQL mode)");
    return;
  }

  const ui = JSON.parse(editorSettings.uiModel);
  let renamedCount = 0;

  for (const obj of Object.values(ui.contents || {})) {
    // Rename in node elements maps
    if (obj.elements && typeof obj.elements === "object") {
      for (const elem of Object.values(obj.elements)) {
        if (elem.name === oldName) { elem.name = newName; renamedCount++; }
        if (elem.newName === oldName) { elem.newName = newName; renamedCount++; }
        if (elem.successorElement?.name === oldName) elem.successorElement.name = newName;
      }
    }
    // Rename in element mappings
    if (obj.classDefinition === "sap.cdw.commonmodel.ElementMapping") {
      if (obj.sourceElement?.name === oldName) { obj.sourceElement.name = newName; renamedCount++; }
      if (obj.targetElement?.name === oldName) { obj.targetElement.name = newName; renamedCount++; }
    }
  }

  editorSettings.uiModel = JSON.stringify(ui);
  console.log(`  [uiModel] Renamed ${renamedCount} reference(s)`);
}

// ─── Analytic model cascade ────────────────────────────────────────────────────

function renameInAnalyticModel(amData, amName, viewName, oldName, newName) {
  const def = (amData.definitions || {})[amName];
  const bl = (amData.businessLayerDefinitions || {})[amName];
  let changed = false;

  // definitions.elements
  if (def?.elements?.[oldName]) {
    const newElements = {};
    for (const [k, v] of Object.entries(def.elements)) {
      newElements[k === oldName ? newName : k] = v;
    }
    def.elements = newElements;
    changed = true;
  }

  // query.SELECT.columns — refs and aliases
  const cols = def?.query?.SELECT?.columns || [];
  for (const col of cols) {
    if (!col.ref) continue;
    if (col.ref[col.ref.length - 1] === oldName) {
      col.ref[col.ref.length - 1] = newName;
      if (!col.as || col.as === oldName) col.as = newName;
      changed = true;
    }
    if (col.as === oldName) { col.as = newName; changed = true; }
  }

  // businessLayer attributes
  if (bl?.attributes) {
    for (const attr of Object.values(bl.attributes)) {
      for (const mapping of Object.values(attr.attributeMapping || {})) {
        if (mapping.key === oldName) { mapping.key = newName; changed = true; }
      }
    }
  }

  // businessLayer measures
  if (bl?.measures) {
    for (const measure of Object.values(bl.measures)) {
      for (const mapping of Object.values(measure.measureMapping || {})) {
        if (mapping.key === oldName) { mapping.key = newName; changed = true; }
      }
    }
  }

  return changed;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function renameColumn(params) {
  const { object: viewName, oldName, newName, space } = params;

  console.log(`\nRenaming column: ${oldName} → ${newName}`);
  console.log(`View: ${viewName}  Space: ${space}\n`);

  const commands = await authenticate();

  // Step 1: Read the view
  console.log("Step 1: Reading view...");
  const view = await readView(commands, space, viewName);

  // Step 2: Rename in view
  console.log("\nStep 2: Updating view definition...");
  renameInViewDefinitions(view, viewName, oldName, newName);
  renameInViewQuery(view, viewName, oldName, newName);
  renameInUiModel(view, viewName, oldName, newName);

  const viewResult = await saveView(commands, space, viewName, view);
  console.log(`  View saved${viewResult?.message ? ": " + viewResult.message : " successfully"}`);

  // Step 3: Find and update analytic models that reference this view
  // We probe by trying to list analytic models and checking which ones source this view
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
    const changed = renameInAnalyticModel(amData, amName, viewName, oldName, newName);
    if (changed) {
      await saveAnalyticModel(commands, space, amName, amData);
      console.log(`  Updated analytic model: ${amName}`);
      cascadeCount++;
    } else {
      console.log(`  No references to ${oldName} found in ${amName} — skipped`);
    }
  }

  console.log(`\nDone. Column renamed in view + ${cascadeCount} analytic model(s).`);
  console.log("Note: Objects were saved with --no-deploy. Deploy from the Datasphere UI when ready.");
}

async function main() {
  const params = parseArgs(process.argv.slice(2));

  if (!params.object || !params.oldName || !params.newName) {
    console.error("Error: --object, --old-name, and --new-name are all required");
    console.error("Usage: node rename-column.js --object <view-name> --old-name <col> --new-name <col> [--space <space>]");
    process.exit(1);
  }

  await renameColumn(params);
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/"))) {
  main().catch(err => { console.error("Fatal error:", err); process.exit(1); });
}

export { renameColumn };
