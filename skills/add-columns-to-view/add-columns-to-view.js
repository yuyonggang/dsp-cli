/**
 * Skill Implementation: add-columns-to-view
 * Adds columns to an existing graphical View in SAP Datasphere.
 *
 * Updates definitions.elements, query.SELECT.columns, and editorSettings.uiModel
 * in a single atomic operation. Safe to re-run: each node is checked independently
 * before adding, so duplicates are never created.
 */

import { getCommands } from "@sap/datasphere-cli";
import { randomUUID } from "crypto";
import fs from "fs/promises";
import os from "os";
import path from "path";

const HOST = process.env.DATASPHERE_HOST;

// ─── Argument parsing ─────────────────────────────────────────────────────────

function parseArgs(args) {
  const params = {
    name: null,
    space: "SAP_CONTENT",
    columns: null,
    insertBefore: null,
    noDeploy: false,
  };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--name" && args[i + 1])           { params.name = args[++i]; }
    else if (args[i] === "--space" && args[i + 1])     { params.space = args[++i]; }
    else if (args[i] === "--columns" && args[i + 1])   { params.columns = args[++i]; }
    else if (args[i] === "--insert-before" && args[i + 1]) { params.insertBefore = args[++i]; }
    else if (args[i] === "--no-deploy")                { params.noDeploy = true; }
  }
  return params;
}

/**
 * Parse column definitions from semicolon-separated string.
 * Format: NAME:TYPE:LENGTH:LABEL
 * Example: "OperatingConcern:cds.String:4:Operating Concern"
 */
function parseColumns(columnsStr) {
  return columnsStr.split(";").map(part => {
    const [name, rawType, lengthOrPrecision, ...labelParts] = part.trim().split(":");
    const label = labelParts.join(":") || name;
    let cdsType = rawType || "cds.String";
    if (!cdsType.startsWith("cds.")) cdsType = `cds.${cdsType}`;

    const length = parseInt(lengthOrPrecision) || 10;
    // Determine native data type for uiModel
    const nativeDataType = cdsType === "cds.Integer" ? "INTEGER"
      : cdsType === "cds.Decimal" ? "DECIMAL"
      : cdsType === "cds.Date" ? "DATE"
      : cdsType === "cds.Timestamp" ? "TIMESTAMP"
      : "NVARCHAR";

    return { name, cdsType, length, label, nativeDataType };
  });
}

// ─── DSP I/O helpers ─────────────────────────────────────────────────────────

async function captureStdout(fn) {
  const origWrite = process.stdout.write.bind(process.stdout);
  const chunks = [];
  process.stdout.write = (chunk, ...args) => {
    chunks.push(typeof chunk === "string" ? chunk : chunk.toString());
    return true;
  };
  try {
    await fn();
  } finally {
    process.stdout.write = origWrite;
  }
  return chunks.join("");
}

async function readView(commands, space, name) {
  const raw = await captureStdout(() =>
    commands["objects views read"]({ "--space": space, "--technical-name": name })
  );
  const jsonStart = raw.indexOf("{");
  if (jsonStart < 0) throw new Error(`No JSON in response for view ${name}:\n${raw}`);
  return JSON.parse(raw.slice(jsonStart));
}

async function saveView(commands, space, name, payload, noDeploy) {
  const tmpFile = path.join(os.tmpdir(), `dsp_addcols_${name}.json`);
  await fs.writeFile(tmpFile, JSON.stringify(payload, null, 2), "utf8");
  const opts = {
    "--space": space,
    "--technical-name": name,
    "--file-path": tmpFile,
  };
  if (noDeploy) opts["--no-deploy"] = true;
  const raw = await captureStdout(() => commands["objects views update"](opts));
  const jsonStart = raw.indexOf("{");
  return jsonStart >= 0 ? JSON.parse(raw.slice(jsonStart)) : { message: raw.trim() };
}

// ─── uiModel helpers ──────────────────────────────────────────────────────────

function maxIndexOrder(elementsMap) {
  let max = -1;
  for (const v of Object.values(elementsMap)) {
    if (typeof v.indexOrder === "number" && v.indexOrder > max) max = v.indexOrder;
  }
  return max;
}

/** Return set of column names already present in a node's elements map */
function nodeColNames(node) {
  return new Set(Object.values(node.elements).map(e => e.name));
}

// ─── Main logic ───────────────────────────────────────────────────────────────

async function addColumnsToView(params) {
  const newCols = parseColumns(params.columns);
  console.log(`\nAdding ${newCols.length} column(s) to ${params.name} in space ${params.space}`);
  console.log("Columns:", newCols.map(c => c.name).join(", "));

  const commands = await getCommands(HOST);

  // Read current view
  console.log("\nReading current view...");
  const view = await readView(commands, params.space, params.name);
  const def = view.definitions[params.name];
  if (!def) throw new Error(`No definition found for ${params.name}`);
  if (!view.editorSettings?.[params.name]?.uiModel) {
    throw new Error(`View ${params.name} has no uiModel — it may be in SQL mode (not supported)`);
  }

  const existingDefCols = Object.keys(def.elements);
  console.log(`Current columns (${existingDefCols.length}): ${existingDefCols.join(", ")}`);

  // ── 1. definitions.elements ──────────────────────────────────────────────
  let defAdded = 0;
  for (const col of newCols) {
    if (def.elements[col.name]) {
      console.log(`  [definitions] SKIP (exists): ${col.name}`);
      continue;
    }
    def.elements[col.name] = {
      "@DataWarehouse.native.dataType": col.nativeDataType,
      "@DataWarehouse.capabilities.filter.allowedExpressions": [
        { "#": "EQUAL" }, { "#": "LIKE" }, { "#": "BETWEEN" },
      ],
      "@EndUserText.label": col.label,
      type: col.cdsType,
      length: col.length,
    };
    defAdded++;
    console.log(`  [definitions] Added: ${col.name}`);
  }

  // ── 2. query.SELECT.columns ──────────────────────────────────────────────
  const existingSelectNames = new Set(
    def.query.SELECT.columns.map(c => c.ref?.[c.ref.length - 1]).filter(Boolean)
  );
  const colsToInsert = newCols.filter(c => !existingSelectNames.has(c.name));
  let selectInsertIdx = def.query.SELECT.columns.length; // default: append
  if (params.insertBefore) {
    const idx = def.query.SELECT.columns.findIndex(c =>
      c.ref && c.ref[c.ref.length - 1] === params.insertBefore
    );
    if (idx >= 0) {
      selectInsertIdx = idx;
      console.log(`  [query] Inserting before '${params.insertBefore}' at index ${idx}`);
    } else {
      console.warn(`  [query] WARNING: --insert-before '${params.insertBefore}' not found, appending`);
    }
  }
  if (colsToInsert.length > 0) {
    def.query.SELECT.columns.splice(selectInsertIdx, 0, ...colsToInsert.map(c => ({ ref: [c.name] })));
    console.log(`  [query] Added ${colsToInsert.length} column(s)`);
  } else {
    console.log("  [query] Nothing to add (all already present)");
  }

  // ── 3. uiModel ───────────────────────────────────────────────────────────
  const ui = JSON.parse(view.editorSettings[params.name].uiModel);

  // Find nodes
  let srcNodeId, prjNodeId, outNodeId;
  for (const [uuid, obj] of Object.entries(ui.contents)) {
    if (obj.classDefinition === "sap.cdw.querybuilder.Entity") srcNodeId = uuid;
    if (obj.classDefinition === "sap.cdw.querybuilder.RenameElements") prjNodeId = uuid;
    if (obj.classDefinition === "sap.cdw.querybuilder.Output") outNodeId = uuid;
  }
  if (!srcNodeId || !outNodeId) throw new Error("Could not find Entity or Output node in uiModel");
  const hasPrjNode = !!prjNodeId;

  const srcNode = ui.contents[srcNodeId];
  const prjNode = hasPrjNode ? ui.contents[prjNodeId] : null;
  const outNode = ui.contents[outNodeId];

  console.log(`  [uiModel] src: ${srcNode.name}, prj: ${prjNode?.name ?? "(none)"}, out: ${outNode.name}`);

  const srcExisting = nodeColNames(srcNode);
  const prjExisting = hasPrjNode ? nodeColNames(prjNode) : null;
  const outExisting = nodeColNames(outNode);

  let srcStart = maxIndexOrder(srcNode.elements) + 1;
  let prjStart = hasPrjNode ? maxIndexOrder(prjNode.elements) + 1 : 0;
  let outStart = maxIndexOrder(outNode.elements) + 1;
  let uiAdded = 0;

  for (let i = 0; i < newCols.length; i++) {
    const col = newCols[i];

    // Determine which nodes need this column
    const needsSrc = !srcExisting.has(col.name);
    const needsPrj = hasPrjNode && !prjExisting.has(col.name);
    const needsOut = !outExisting.has(col.name);

    if (!needsSrc && !needsPrj && !needsOut) {
      console.log(`  [uiModel] SKIP (exists in all nodes): ${col.name}`);
      continue;
    }

    // Generate UUIDs only for the nodes that need this column
    const srcUUID = needsSrc ? randomUUID() : null;
    const prjUUID = needsPrj ? randomUUID() : null;
    const outUUID = needsOut ? randomUUID() : null;

    // Determine the chain: src → (prj) → out
    // Each node's element successorElement points to the next node's UUID
    const srcSuccessor = hasPrjNode ? (prjUUID ?? findExistingUUID(prjNode, col.name)) : (outUUID ?? findExistingUUID(outNode, col.name));
    const prjSuccessor = outUUID ?? findExistingUUID(outNode, col.name);

    if (needsSrc) {
      srcNode.elements[srcUUID] = { name: col.name };
      ui.contents[srcUUID] = {
        classDefinition: "sap.cdw.querybuilder.Element",
        name: col.name, label: col.name, newName: col.name,
        indexOrder: srcStart + i,
        length: col.length, precision: 0, scale: 0,
        ...(srcSuccessor ? { successorElement: srcSuccessor } : {}),
      };
    }

    if (hasPrjNode && needsPrj) {
      prjNode.elements[prjUUID] = { name: col.name };
      ui.contents[prjUUID] = {
        classDefinition: "sap.cdw.querybuilder.Element",
        name: col.name, label: col.name, newName: col.name,
        indexOrder: prjStart + i,
        length: col.length, precision: 0, scale: 0,
        ...(prjSuccessor ? { successorElement: prjSuccessor } : {}),
      };
    }

    if (needsOut) {
      outNode.elements[outUUID] = { name: col.name };
      ui.contents[outUUID] = {
        classDefinition: "sap.cdw.querybuilder.Element",
        name: col.name, label: col.label, newName: col.name,
        indexOrder: outStart + i,
        length: col.length, precision: 0, scale: 0,
        nativeDataType: col.nativeDataType,
      };
    }

    console.log(`  [uiModel] Added: ${col.name} (src:${needsSrc}, prj:${needsPrj}, out:${needsOut})`);
    uiAdded++;
  }

  if (defAdded === 0 && colsToInsert.length === 0 && uiAdded === 0) {
    console.log("\n✓ Nothing to do — all columns already present.");
    return;
  }

  // Serialize uiModel back
  view.editorSettings[params.name].uiModel = JSON.stringify(ui);

  // Save
  console.log(`\nSaving ${params.name}...`);
  const resp = await saveView(commands, params.space, params.name, view, params.noDeploy);
  console.log(`✅ ${resp.message || JSON.stringify(resp)}`);
  if (params.noDeploy) {
    console.log("   (saved but not deployed — deploy manually in DSP UI)");
  }
}

/** Find the UUID in a node's elements map for a given column name */
function findExistingUUID(node, colName) {
  for (const [uuid, el] of Object.entries(node.elements)) {
    if (el.name === colName) return uuid;
  }
  return null;
}

// ─── Entry point ──────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const params = parseArgs(args);

  if (!params.name || !params.columns) {
    console.error("Usage: node add-columns-to-view.js --name <view-name> --columns \"COL1:type:len:Label;COL2:type:len:Label\" [--space <space>] [--insert-before <col>] [--no-deploy]");
    process.exit(1);
  }

  await addColumnsToView(params);
}

if (import.meta.url.endsWith(process.argv[1]?.replace(/\\/g, "/"))) {
  main().catch(err => {
    console.error("Fatal:", err.message || err);
    process.exit(1);
  });
}

export { addColumnsToView, parseColumns };
