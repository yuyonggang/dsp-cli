/**
 * Skill Implementation: create-model
 * Orchestrates the full data model creation sequence:
 *   1. Dimension tables
 *   2. Fact table
 *   3. View with dimension associations
 *   4. Analytic model
 *
 * Wraps the existing individual skills in the correct order using the
 * same series number for all generated object names.
 */

import { createLocalTable } from "../create-local-table/create-local-table.js";
import { createView }       from "../create-view/create-view.js";
import { createAnalyticModel } from "../create-analytic-model/create-analytic-model.js";

// ─── Argument parsing ─────────────────────────────────────────────────────────

function parseArgs(args) {
  const params = {
    series: null,
    factName: null,
    factColumns: null,
    dimensions: null,   // "DIM_NAME:FK_COL:JOIN_KEY:col1,col2;..."
    viewName: null,
    modelName: null,
    space: process.env.SPACE,
    label: null,
  };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--series" && args[i + 1])       { params.series = args[++i]; }
    else if (args[i] === "--fact-name" && args[i + 1])   { params.factName = args[++i]; }
    else if (args[i] === "--fact-columns" && args[i + 1]){ params.factColumns = args[++i]; }
    else if (args[i] === "--dimensions" && args[i + 1])  { params.dimensions = args[++i]; }
    else if (args[i] === "--view-name" && args[i + 1])   { params.viewName = args[++i]; }
    else if (args[i] === "--model-name" && args[i + 1])  { params.modelName = args[++i]; }
    else if (args[i] === "--space" && args[i + 1])       { params.space = args[++i]; }
    else if (args[i] === "--label" && args[i + 1])       { params.label = args[++i]; }
  }
  return params;
}

/**
 * Parse dimension specs.
 * Format: "DIM_TABLE_NAME:FK_COLUMN:JOIN_KEY:ATTR1,ATTR2;..."
 * Example: "DIM_CUSTOMER_001:CUSTOMER_ID:ID:NAME,CITY;DIM_PRODUCT_001:PRODUCT_ID:ID:NAME,CATEGORY"
 *
 * Returns array of { tableName, fkColumn, joinKey, columns }
 */
function parseDimensionSpecs(dimensionsStr) {
  if (!dimensionsStr) return [];
  return dimensionsStr.split(";").map(part => {
    const [tableName, fkColumn, joinKey, colStr] = part.trim().split(":");
    const columns = colStr ? colStr.split(",").map(c => c.trim()) : [];
    return { tableName, fkColumn, joinKey, columns };
  }).filter(d => d.tableName && d.fkColumn && d.joinKey);
}

// ─── Step builders ────────────────────────────────────────────────────────────

function sep(label) {
  console.log(`\n${"─".repeat(60)}`);
  console.log(`  ${label}`);
  console.log(`${"─".repeat(60)}\n`);
}

/**
 * Build the --columns string for a dimension table from its column list.
 * Each dimension always needs at least an ID key column.
 * If no columns are provided for a dimension, uses ID:String:10:key and NAME:String:100.
 */
function buildDimensionColumns(dimSpec) {
  if (!dimSpec.columns || dimSpec.columns.length === 0) {
    return `${dimSpec.joinKey}:String:10:key,NAME:String:100`;
  }
  // First column is always the join key (primary key)
  const keyCols = [`${dimSpec.joinKey}:String:10:key`];
  const attrCols = dimSpec.columns
    .filter(c => c !== dimSpec.joinKey)
    .map(c => `${c}:String:100`);
  return [...keyCols, ...attrCols].join(",");
}

// ─── Main orchestrator ────────────────────────────────────────────────────────

async function createModel(params) {
  const { series, factName, factColumns, dimensions, viewName, modelName, space, label } = params;
  const dimSpecs = parseDimensionSpecs(dimensions);

  // Derive names using series if specific names not provided
  const resolvedFactName  = factName  || `FACT_${series}`;
  const resolvedViewName  = viewName  || `VW_${series}`;
  const resolvedModelName = modelName || `AM_${series}`;

  console.log(`\n${"═".repeat(60)}`);
  console.log("  CREATE MODEL — Full Data Model Orchestration");
  console.log(`${"═".repeat(60)}`);
  console.log(`  Series      : ${series}`);
  console.log(`  Fact table  : ${resolvedFactName}`);
  console.log(`  View        : ${resolvedViewName}`);
  console.log(`  Model       : ${resolvedModelName}`);
  console.log(`  Space       : ${space}`);
  console.log(`  Dimensions  : ${dimSpecs.length > 0 ? dimSpecs.map(d => d.tableName).join(", ") : "(none)"}`);
  console.log(`${"═".repeat(60)}\n`);

  // ── Step 1: Create dimension tables ───────────────────────────────────────
  if (dimSpecs.length > 0) {
    sep(`Step 1 of 4 — Creating ${dimSpecs.length} dimension table(s)`);
    for (const dim of dimSpecs) {
      console.log(`Creating dimension table: ${dim.tableName}`);
      await createLocalTable({
        name: dim.tableName,
        space,
        label: label ? `${label} - ${dim.tableName}` : dim.tableName,
        columns: buildDimensionColumns(dim),
        dimension: true,
      });
    }
  } else {
    console.log("No dimension tables specified — skipping Step 1.\n");
  }

  // ── Step 2: Create fact table ──────────────────────────────────────────────
  sep("Step 2 of 4 — Creating fact table");
  await createLocalTable({
    name: resolvedFactName,
    space,
    label: label ? `${label} - Fact` : resolvedFactName,
    columns: factColumns || null,
    dimension: false,
  });

  // ── Step 3: Create view with associations ─────────────────────────────────
  sep("Step 3 of 4 — Creating view with dimension associations");

  // Build --dimensions string for create-view from dimSpecs
  // create-view format: "FK_COL:DIM_TABLE:JOIN_KEY;..."
  const viewDimensions = dimSpecs.length > 0
    ? dimSpecs.map(d => `${d.fkColumn}:${d.tableName}:${d.joinKey}`).join(";")
    : null;

  await createView({
    name: resolvedViewName,
    source: resolvedFactName,
    space,
    label: label ? `${label} - View` : resolvedViewName,
    columns: null,
    where: null,
    dimensions: viewDimensions,
  });

  // ── Step 4: Create analytic model ─────────────────────────────────────────
  sep("Step 4 of 4 — Creating analytic model");
  await createAnalyticModel({
    name: resolvedModelName,
    source: resolvedViewName,
    space,
    label: label ? `${label} - Analytic Model` : resolvedModelName,
    attributes: null,
    measures: null,
    dimensions: null, // auto-detected from view associations
  });

  console.log(`\n${"═".repeat(60)}`);
  console.log("  Model creation complete!");
  console.log(`${"═".repeat(60)}`);
  console.log(`  Fact table  : ${resolvedFactName}`);
  if (dimSpecs.length > 0) console.log(`  Dimensions  : ${dimSpecs.map(d => d.tableName).join(", ")}`);
  console.log(`  View        : ${resolvedViewName}`);
  console.log(`  Model       : ${resolvedModelName}`);
  console.log(`\n  All objects created in space: ${space}\n`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const params = parseArgs(process.argv.slice(2));

  if (!params.series) {
    console.error("Error: --series is required (e.g. --series 001)");
    console.error(`
Usage: node create-model.js --series <NNN> [options]

Required:
  --series <NNN>              Series number suffix for all generated object names (e.g. 001)

Optional:
  --fact-name <name>          Override fact table name (default: FACT_<series>)
  --fact-columns <cols>       Comma-separated column definitions for the fact table
  --dimensions <spec>         Semicolon-separated dimension specs:
                              DIM_TABLE:FK_COLUMN:JOIN_KEY:ATTR1,ATTR2;...
  --view-name <name>          Override view name (default: VW_<series>)
  --model-name <name>         Override analytic model name (default: AM_<series>)
  --label <label>             Base label applied to all objects
  --space <space>             Space ID (default: $SPACE from .env)

Example:
  node create-model.js \\
    --series 001 \\
    --fact-name SALES_FACT_001 \\
    --fact-columns "ORDER_ID:String:10:key,CUSTOMER_ID:String:10,PRODUCT_ID:String:10,AMOUNT:Decimal:15:2" \\
    --dimensions "DIM_CUSTOMER_001:CUSTOMER_ID:ID:NAME,CITY;DIM_PRODUCT_001:PRODUCT_ID:ID:NAME,CATEGORY" \\
    --view-name SALES_VW_001 \\
    --model-name AM_SALES_001 \\
    --label "Sales Analysis"
`);
    process.exit(1);
  }

  await createModel(params);
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/"))) {
  main().catch(err => { console.error("Fatal error:", err); process.exit(1); });
}

export { createModel, parseDimensionSpecs };
