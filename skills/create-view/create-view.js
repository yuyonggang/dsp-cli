/**
 * Skill Implementation: create-view
 * Creates a View in SAP Datasphere
 */

import { getCommands } from "@sap/datasphere-cli";
import fs from "fs/promises";

// Load credentials from environment variables
const HOST = process.env.DATASPHERE_HOST;
const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const AUTH_URL = process.env.AUTHORIZATION_URL;
const TOKEN_URL = process.env.TOKEN_URL;

// Validate required environment variables
function validateEnvironment() {
  const required = {
    DATASPHERE_HOST: HOST,
    CLIENT_ID: CLIENT_ID,
    CLIENT_SECRET: CLIENT_SECRET,
    AUTHORIZATION_URL: AUTH_URL,
    TOKEN_URL: TOKEN_URL,
  };

  const missing = Object.entries(required)
    .filter(([key, value]) => !value)
    .map(([key]) => key);

  if (missing.length > 0) {
    console.error("❌ Missing required environment variables:");
    missing.forEach(key => console.error(`   - ${key}`));
    console.error("\n💡 Please set these in your .env file or environment");
    process.exit(1);
  }
}

/**
 * Parse command line arguments
 */
function parseArgs(args) {
  const params = {
    name: null,
    source: null,
    space: "SAP_SCT",
    label: null,
    columns: null,
    where: null,
    dimensions: null,  // New: FK_COL:DIM_TABLE:JOIN_KEY format
  };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--name" && args[i + 1]) {
      params.name = args[i + 1];
      i++;
    } else if (args[i] === "--source" && args[i + 1]) {
      params.source = args[i + 1];
      i++;
    } else if (args[i] === "--space" && args[i + 1]) {
      params.space = args[i + 1];
      i++;
    } else if (args[i] === "--label" && args[i + 1]) {
      params.label = args[i + 1];
      i++;
    } else if (args[i] === "--columns" && args[i + 1]) {
      params.columns = args[i + 1];
      i++;
    } else if (args[i] === "--where" && args[i + 1]) {
      params.where = args[i + 1];
      i++;
    } else if (args[i] === "--dimensions" && args[i + 1]) {
      params.dimensions = args[i + 1];
      i++;
    }
  }

  return params;
}

/**
 * Read source table/view to get its structure
 */
async function getSourceStructure(commands, space, sourceName) {
  try {
    // Try to read as local table first
    const table = await commands["objects local-tables read"]({
      "--host": HOST,
      "--space": space,
      "--technical-name": sourceName,
    });
    return table.definitions[sourceName].elements;
  } catch (error) {
    // If not a table, try as view
    try {
      const view = await commands["objects views read"]({
        "--host": HOST,
        "--space": space,
        "--technical-name": sourceName,
      });
      return view.definitions[sourceName].elements;
    } catch (viewError) {
      throw new Error(`Source '${sourceName}' not found in space '${space}'`);
    }
  }
}

/**
 * Parse dimensions parameter
 * Format: "FK_COL:DIM_TABLE:JOIN_KEY;..."
 * Example: "CUSTOMER_ID:DIM_CUSTOMER:ID"
 */
function parseDimensions(dimensionsStr) {
  if (!dimensionsStr) return [];

  const dimensions = [];
  const dimDefs = dimensionsStr.split(";");

  dimDefs.forEach(dimDef => {
    const parts = dimDef.trim().split(":");
    if (parts.length >= 3) {
      dimensions.push({
        fkColumn: parts[0],        // Foreign key column in source
        dimensionTable: parts[1],   // Dimension table name
        joinKey: parts[2],          // Key column in dimension table
      });
    }
  });

  return dimensions;
}

/**
 * Authenticate to Datasphere
 */
async function authenticate() {
  validateEnvironment();

  const commands = await getCommands(HOST);

  await commands["login"]({
    "--host": HOST,
    "--client-id": CLIENT_ID,
    "--client-secret": CLIENT_SECRET,
    "--authorization-url": AUTH_URL,
    "--token-url": TOKEN_URL,
    "--authorization-flow": "authorization_code",
    "--force": true,
  });

  await commands["config cache init"]({ "--host": HOST });

  return await getCommands(HOST);
}

/**
 * Generate UUID for UI model objects
 */
function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

/**
 * Check if a field name suggests it's a measure based on common naming patterns
 */
function isMeasureField(fieldName) {
  const measureKeywords = [
    'AMOUNT', 'QUANTITY', 'QTY', 'PRICE', 'COUNT', 'SUM', 'TOTAL',
    'VALUE', 'COST', 'REVENUE', 'SALES', 'VOLUME', 'WEIGHT',
    'BALANCE', 'PROFIT', 'LOSS', 'RATE', 'PERCENT', 'SCORE', 'NUMBER'
  ];

  const upperName = fieldName.toUpperCase();
  return measureKeywords.some(keyword => upperName.includes(keyword));
}

/**
 * Generate uiModel for Graphical View
 * This is a synchronous function that builds the UI model structure
 * Note: Dimension elements need to be passed in from the async context
 */
function generateUIModel(params, sourceElements, dimensions, dimensionElementsMap) {
  const modelId = generateUUID();
  const outputId = generateUUID();
  const sourceEntityId = generateUUID();
  const outputSymbolId = generateUUID();
  const sourceSymbolId = generateUUID();
  const diagramId = generateUUID();

  const contents = {
    [modelId]: {
      classDefinition: "sap.cdw.querybuilder.Model",
      name: params.name,
      label: params.label || params.name,
      modificationDate: Date.now(),
      deploymentDate: 0,
      "#objectStatus": "0",
      output: outputId,
      nodes: {
        [outputId]: { name: params.name },
        [sourceEntityId]: { name: params.source }
      },
      associations: {},
      diagrams: {
        [diagramId]: {}
      }
    },
    [outputId]: {
      classDefinition: "sap.cdw.querybuilder.Output",
      name: params.name,
      type: "graphicView",
      isDeltaOutboundOn: false,
      isPinToMemoryEnabled: false,
      dataCategory: "SQLFACT",
      modificationDate: Date.now(),
      deploymentDate: 0,
      "#objectStatus": "0",
      elements: {},
      associations: {}
    },
    [sourceEntityId]: {
      classDefinition: "sap.cdw.querybuilder.Entity",
      name: params.source,
      label: params.source,
      type: 9,
      isDeltaOutboundOn: false,
      isPinToMemoryEnabled: false,
      dataCategory: "SQLFACT",
      isAllowConsumption: false,
      isHiddenInUi: false,
      modificationDate: Date.now(),
      deploymentDate: Date.now(),
      "#objectStatus": "1",
      elements: {},
      successorNode: outputId
    },
    [diagramId]: {
      classDefinition: "sap.cdw.querybuilder.ui.Diagram",
      symbols: {
        [outputSymbolId]: {},
        [sourceSymbolId]: { name: "Entity Symbol 1" }
      }
    },
    [outputSymbolId]: {
      classDefinition: "sap.cdw.querybuilder.ui.OutputSymbol",
      x: 47,
      y: -20,
      width: 140,
      height: 40,
      object: outputId
    },
    [sourceSymbolId]: {
      classDefinition: "sap.cdw.querybuilder.ui.EntitySymbol",
      name: "Entity Symbol 1",
      x: -163,
      y: -20,
      width: 160,
      displayName: "Entity Symbol 1",
      object: sourceEntityId
    }
  };

  // Add dimension nodes if any
  const dimNodes = {};
  const dimSymbols = {};
  const dimNodeInfoMap = {}; // Map dimension table name to its node and element IDs

  dimensions.forEach((dim, idx) => {
    const dimNodeId = generateUUID();
    const dimSymbolId = generateUUID();

    contents[modelId].nodes[dimNodeId] = { name: dim.dimensionTable };

    // Get dimension elements from the map passed in
    const dimElements = dimensionElementsMap[dim.dimensionTable] || {};
    const dimElementIds = {};

    // Generate element definitions for dimension table
    Object.keys(dimElements).forEach((dimColName) => {
      const dimElement = dimElements[dimColName];
      if (dimElement.type === "cds.Association") return; // Skip associations in dimension

      const dimElemId = generateUUID();
      dimElementIds[dimColName] = dimElemId;

      contents[dimElemId] = {
        classDefinition: "sap.cdw.querybuilder.Element",
        name: dimColName,
        label: dimElement["@EndUserText.label"] || dimColName,
        newName: dimColName,
        indexOrder: Object.keys(dimElementIds).length - 1,
        isKey: !!dimElement.key,
        length: dimElement.length || 0,
        precision: dimElement.precision || 0,
        scale: dimElement.scale || 0,
        isMeasureBeforeAI: false,
        isMeasureAI: false,
        isKeyBeforeAI: false,
        isKeyAI: false,
        isDimension: !!dimElement.key,
        isNotNull: !!dimElement.notNull
      };
    });

    dimNodes[dimNodeId] = {
      classDefinition: "sap.cdw.querybuilder.DimensionNode",
      name: dim.dimensionTable,
      label: dim.dimensionTable,
      type: "Local Table (Dimension)",
      isDeltaOutboundOn: false,
      isPinToMemoryEnabled: false,
      dataCategory: "DIMENSION",
      isAllowConsumption: false,
      modificationDate: Date.now(),
      deploymentDate: Date.now(),
      "#objectStatus": "1",
      elements: Object.fromEntries(
        Object.entries(dimElementIds).map(([name, id]) => [id, { name }])
      )
    };

    // Store mapping for later use in associations
    dimNodeInfoMap[dim.dimensionTable] = {
      nodeId: dimNodeId,
      elementIds: dimElementIds
    };

    dimSymbols[dimSymbolId] = {
      classDefinition: "sap.cdw.querybuilder.ui.EntitySymbol",
      name: `Dimension Symbol ${idx + 1}`,
      x: -163,
      y: 60 + idx * 80,
      width: 160,
      displayName: `Dimension Symbol ${idx + 1}`,
      object: dimNodeId
    };
  });

  Object.assign(contents, dimNodes);
  Object.assign(contents[diagramId].symbols, dimSymbols);

  // Build set of FK columns from dimensions
  const fkColumns = new Set(dimensions.map(d => d.fkColumn));

  // Add elements mapping
  let indexOrder = 0;
  Object.keys(sourceElements).forEach(colName => {
    const element = sourceElements[colName];
    if (element.type === "cds.Association") return; // Skip associations

    const sourceElemId = generateUUID();
    const outputElemId = generateUUID();

    // Source element
    contents[sourceEntityId].elements[sourceElemId] = { name: colName };
    contents[sourceElemId] = {
      classDefinition: "sap.cdw.querybuilder.Element",
      name: colName,
      label: element["@EndUserText.label"] || colName,
      newName: colName,
      indexOrder: indexOrder++,
      length: element.length || 0,
      precision: element.precision || 0,
      scale: element.scale || 0,
      isMeasureBeforeAI: false,
      isMeasureAI: false,
      isKeyBeforeAI: false,
      isKeyAI: false,
      successorElement: outputElemId
    };

    if (element.key) {
      contents[sourceElemId].isKey = true;
      contents[sourceElemId].isNotNull = true;
    }

    // Check if measure based on:
    // 1. Numeric type (Integer, Decimal, Double)
    // 2. Not a key field
    // 3. Not a FK column
    // 4. Field name suggests it's a measure (AMOUNT, QUANTITY, etc.)
    const isNumeric = element.type === "cds.Integer" || element.type === "cds.Decimal" || element.type === "cds.Double";
    const isMeasure = isNumeric && !element.key && !fkColumns.has(colName) && isMeasureField(colName);
    if (isMeasure) {
      contents[sourceElemId].isMeasure = true;
      contents[sourceElemId].defaultAggregation = "SUM";
      contents[sourceElemId].dataType = element.type;
    }

    // Output element
    contents[outputId].elements[outputElemId] = { name: colName };
    contents[outputElemId] = {
      classDefinition: "sap.cdw.querybuilder.Element",
      name: colName,
      label: element["@EndUserText.label"] || colName,
      newName: colName,
      indexOrder: contents[sourceElemId].indexOrder,
      length: element.length || 0,
      precision: element.precision || 0,
      scale: element.scale || 0,
      isMeasureBeforeAI: false,
      isMeasureAI: false,
      isKeyBeforeAI: false,
      isKeyAI: false
    };

    if (element.key) {
      contents[outputElemId].isKey = true;
      contents[outputElemId].isNotNull = true;
    }

    if (isNumeric && !element.key && !fkColumns.has(colName) && isMeasureField(colName)) {
      contents[outputElemId].isMeasure = true;
      contents[outputElemId].defaultAggregation = "SUM";
      contents[outputElemId].dataType = element.type;
    }

    // Add foreign key reference if this is a dimension FK
    dimensions.forEach(dim => {
      if (colName === dim.fkColumn) {
        contents[outputElemId].foreignKey = `_${dim.dimensionTable.replace(/^(LT_|DIM_)/i, "").substring(0, 10).toUpperCase()}`;
      }
    });
  });

  // Add association mappings
  dimensions.forEach(dim => {
    const assocId = generateUUID();
    const mappingId = generateUUID();
    const dimTableShort = dim.dimensionTable.replace(/^(LT_|DIM_)/i, "").substring(0, 10).toUpperCase();
    const assocName = `_${dimTableShort}`;

    // Get dimension node info
    const dimInfo = dimNodeInfoMap[dim.dimensionTable];
    if (!dimInfo) {
      console.warn(`Warning: No dimension info found for ${dim.dimensionTable}`);
      return;
    }

    const dimNodeId = dimInfo.nodeId;
    const dimElementIds = dimInfo.elementIds;

    // Find FK element ID in output
    const fkElemId = Object.keys(contents).find(id =>
      contents[id].classDefinition === "sap.cdw.querybuilder.Element" &&
      contents[id].name === dim.fkColumn &&
      contents[outputId].elements[id]
    );

    // Find join key element ID in dimension
    const joinKeyElemId = dimElementIds[dim.joinKey];

    if (!fkElemId) {
      console.warn(`Warning: Could not find FK element ID for ${dim.fkColumn} in output`);
      console.warn(`Available output elements:`, Object.keys(contents[outputId].elements));
      return;
    }

    if (!joinKeyElemId) {
      console.warn(`Warning: Could not find join key element ID for ${dim.joinKey} in dimension ${dim.dimensionTable}`);
      console.warn(`Available dimension element IDs:`, Object.keys(dimElementIds));
      return;
    }

    // Add association to model and output
    contents[modelId].associations[assocId] = { name: assocName };
    contents[outputId].associations[assocId] = { name: assocName };

    // Create association definition
    contents[assocId] = {
      classDefinition: "sap.cdw.querybuilder.Association",
      name: assocName,
      label: `${params.name} to ${dim.dimensionTable}`,
      source: outputId,
      target: dimNodeId,
      mappings: {
        [mappingId]: {}
      }
    };

    // Create element mapping with correct target
    contents[mappingId] = {
      classDefinition: "sap.cdw.commonmodel.ElementMapping",
      source: fkElemId,
      target: joinKeyElemId
    };
  });

  return JSON.stringify({ contents });
}

/**
 * Create view
 */
async function createView(params) {
  console.log(`🚀 Creating View: ${params.name} from ${params.source} in space ${params.space}\n`);

  // Authenticate
  const commands = await authenticate();

  // Get source structure
  console.log(`📋 Reading source structure: ${params.source}`);
  const sourceElements = await getSourceStructure(commands, params.space, params.source);

  // Parse dimensions
  const dimensions = parseDimensions(params.dimensions);

  // Read dimension table structures (needed for uiModel generation)
  const dimensionElementsMap = {};
  for (const dim of dimensions) {
    console.log(`📋 Reading dimension structure: ${dim.dimensionTable}`);
    try {
      const dimElements = await getSourceStructure(commands, params.space, dim.dimensionTable);
      dimensionElementsMap[dim.dimensionTable] = dimElements;
    } catch (error) {
      console.error(`❌ Failed to read dimension ${dim.dimensionTable}:`, error.message);
      throw new Error(`Dimension table '${dim.dimensionTable}' not found in space '${params.space}'`);
    }
  }

  // Determine columns to select
  let columnsToSelect;
  let viewElements = {};

  if (params.columns) {
    // Use specified columns
    columnsToSelect = params.columns.split(",").map(c => c.trim());

    // Build view elements from selected columns
    columnsToSelect.forEach(colName => {
      if (sourceElements[colName]) {
        viewElements[colName] = { ...sourceElements[colName] };
      } else {
        throw new Error(`Column '${colName}' not found in source '${params.source}'`);
      }
    });
  } else {
    // Use all columns from source (except associations)
    Object.keys(sourceElements).forEach(colName => {
      if (sourceElements[colName].type !== "cds.Association") {
        viewElements[colName] = { ...sourceElements[colName] };
      }
    });
    columnsToSelect = Object.keys(viewElements);
  }

  // Add measure annotations to CSN elements
  const fkColumns = new Set(dimensions.map(d => d.fkColumn));
  Object.keys(viewElements).forEach(colName => {
    const element = viewElements[colName];
    if (element.type === "cds.Association") return;

    // Check if this is a measure based on: numeric type, not key, not FK, field name pattern
    const isNumeric = element.type === "cds.Integer" || element.type === "cds.Decimal" || element.type === "cds.Double";
    const isMeasure = isNumeric && !element.key && !fkColumns.has(colName) && isMeasureField(colName);

    if (isMeasure) {
      element["@AnalyticsDetails.measureType"] = { "#": "BASE" };
      element["@Aggregation.default"] = { "#": "SUM" };
    }
  });

  // Build SELECT columns
  const selectColumns = columnsToSelect.map(col => {
    const column = { ref: [col] };
    // Mark key columns
    if (viewElements[col] && viewElements[col].key) {
      column.key = true;
    }
    return column;
  });

  // Build mixin for associations (if any)
  const mixinAssociations = {};

  // Add associations for dimensions
  dimensions.forEach(dim => {
    // Create association name (simple format: _DIM_TABLE without counter)
    const dimTableShort = dim.dimensionTable.replace(/^(LT_|DIM_)/i, "").substring(0, 10).toUpperCase();
    const assocName = `_${dimTableShort}`;

    // Add foreign key annotation to FK column
    if (viewElements[dim.fkColumn]) {
      viewElements[dim.fkColumn]["@ObjectModel.foreignKey.association"] = {
        "=": assocName
      };
    }

    // Add association element
    viewElements[assocName] = {
      "type": "cds.Association",
      "@EndUserText.label": `${params.name} to ${dim.dimensionTable}`,
      "on": [
        { "ref": [dim.fkColumn] },
        "=",
        { "ref": [assocName, dim.joinKey] }
      ],
      "target": dim.dimensionTable
    };

    // Add to select columns
    selectColumns.push({ "ref": [assocName] });

    // Add to mixin (using $projection)
    mixinAssociations[assocName] = {
      "type": "cds.Association",
      "@EndUserText.label": `${params.name} to ${dim.dimensionTable}`,
      "on": [
        { "ref": ["$projection", dim.fkColumn] },
        "=",
        { "ref": [assocName, dim.joinKey] }
      ],
      "target": dim.dimensionTable
    };
  });

  // Build SELECT query
  const selectQuery = {
    SELECT: {
      from: {
        ref: [params.source]
      },
      columns: selectColumns
    }
  };

  // Add mixin if there are associations
  if (Object.keys(mixinAssociations).length > 0) {
    selectQuery.SELECT.mixin = mixinAssociations;
  }

  // Add WHERE clause if provided
  if (params.where) {
    selectQuery.SELECT.where = [params.where];
  }

  // Determine modeling pattern based on source
  let modelingPattern = null;
  let supportedCapabilities = null;

  // Check if source or view has measure fields (numeric types that could be measures)
  const hasMeasures = Object.values(viewElements).some(el => {
    if (el.type === "cds.Association") return false;
    // Check for explicit measure annotations
    if (el["@AnalyticsDetails.measureType"] || el["@Aggregation.default"]) return true;
    // Check for numeric types that are typically measures
    return el.type === "cds.Integer" || el.type === "cds.Decimal" || el.type === "cds.Double";
  });

  // If view has dimensions (associations), it should be marked as ANALYTICAL_FACT
  const hasDimensions = dimensions.length > 0;

  if (hasMeasures || hasDimensions) {
    modelingPattern = { "#": "ANALYTICAL_FACT" };
    supportedCapabilities = [{ "#": "DATA_STRUCTURE" }];
  }

  // Generate view definition
  const viewDefinition = {
    "definitions": {
      [params.name]: {
        "kind": "entity",
        "elements": viewElements,
        "query": selectQuery,
        "@EndUserText.label": params.label || params.name,
        "@DataWarehouse.consumption.external": true
      }
    }
  };

  // Add modeling pattern if determined
  if (modelingPattern) {
    viewDefinition.definitions[params.name]["@ObjectModel.modelingPattern"] = modelingPattern;
    viewDefinition.definitions[params.name]["@ObjectModel.supportedCapabilities"] = supportedCapabilities;
  }

  // Add editorSettings for Graphical View
  viewDefinition.editorSettings = {
    [params.name]: {
      editor: {
        lastModifier: "GRAPHICALVIEWBUILDER",
        default: "GRAPHICALVIEWBUILDER"
      },
      uiModel: generateUIModel(params, sourceElements, dimensions, dimensionElementsMap)
    }
  };

  console.log("📝 View Definition:");
  console.log(JSON.stringify(viewDefinition, null, 2));
  console.log();

  // Save to temp file
  const tempDir = process.env.TEMP || process.env.TMP || "/tmp";
  const tempFile = `${tempDir}/view-${params.name}.json`;
  await fs.writeFile(tempFile, JSON.stringify(viewDefinition, null, 2));

  // Create view
  try {
    const result = await commands["objects views create"]({
      "--host": HOST,
      "--space": params.space,
      "--file-path": tempFile,
    });

    console.log("✅ View created successfully!");
    console.log(JSON.stringify(result, null, 2));
    console.log();

    // Verify
    const readResult = await commands["objects views read"]({
      "--host": HOST,
      "--space": params.space,
      "--technical-name": params.name,
    });

    console.log("✅ Verified - View details:");
    console.log(JSON.stringify(readResult, null, 2));

    return readResult;
  } catch (error) {
    console.error("❌ Failed to create view:", error.message);

    if (error.response && error.response.data) {
      console.error("Error details:", JSON.stringify(error.response.data, null, 2));
    }

    throw error;
  }
}

/**
 * Main entry point
 */
async function main() {
  const args = process.argv.slice(2);
  const params = parseArgs(args);

  if (!params.name) {
    console.error("❌ Error: --name parameter is required");
    console.log("\nUsage: node create-view.js --name VIEW_NAME --source SOURCE_TABLE [OPTIONS]");
    console.log("\nOptions:");
    console.log("  --space         Space ID (default: SAP_SCT)");
    console.log("  --label         User-friendly label");
    console.log("  --columns       Comma-separated column list");
    console.log("  --where         WHERE condition");
    console.log("  --dimensions    Dimension associations: FK_COL:DIM_TABLE:JOIN_KEY;...");
    console.log("\nExamples:");
    console.log("  # Simple view:");
    console.log("  node create-view.js --name ORDERS_VW --source LT_ORDERS");
    console.log("\n  # View with association to dimension:");
    console.log("  node create-view.js --name ORDERS_VW --source LT_ORDERS --dimensions \"CUSTOMER_ID:DIM_CUSTOMER:ID\"");
    process.exit(1);
  }

  if (!params.source) {
    console.error("❌ Error: --source parameter is required");
    console.log("\nUsage: node create-view.js --name VIEW_NAME --source SOURCE_TABLE [OPTIONS]");
    process.exit(1);
  }

  await createView(params);
}

// Run main if this is the entry point
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/"))) {
  main().catch((error) => {
    console.error("Fatal error:", error);
    process.exit(1);
  });
}

export { createView, parseArgs, parseDimensions, authenticate, getSourceStructure };
