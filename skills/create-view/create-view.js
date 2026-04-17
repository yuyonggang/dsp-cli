/**
 * Skill Implementation: create-view
 * Creates a View in SAP Datasphere
 *
 * FIX: Do NOT generate EntitySymbol/AssociationSymbol for dimensions
 *      Let SAP Datasphere auto-generate the visual symbols
 */

import { getCommands } from "@sap/datasphere-cli";
import fs from "fs/promises";

// Load credentials from environment variables
const HOST = process.env.DATASPHERE_HOST;
const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
// Validate required environment variables
function validateEnvironment() {
  const required = {
    DATASPHERE_HOST: HOST,
    CLIENT_ID: CLIENT_ID,
    CLIENT_SECRET: CLIENT_SECRET,
    SPACE: process.env.SPACE,
  };

  const missing = Object.entries(required)
    .filter(([key, value]) => !value)
    .map(([key]) => key);

  if (missing.length > 0) {
    console.error("❌ Missing required environment variables:");
    missing.forEach(key => console.error(`   - ${key}`));
    if (missing.includes("SPACE")) console.error("  → Set SPACE=<your-space-id> in .env");
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
    space: process.env.SPACE,
    label: null,
    columns: null,
    where: null,
    dimensions: null,
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
    const table = await commands["objects local-tables read"]({
      "--host": HOST,
      "--space": space,
      "--technical-name": sourceName,
    });
    return table.definitions[sourceName].elements;
  } catch (error) {
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
 */
function parseDimensions(dimensionsStr) {
  if (!dimensionsStr) return [];

  const dimensions = [];
  const dimDefs = dimensionsStr.split(";");

  dimDefs.forEach(dimDef => {
    const parts = dimDef.trim().split(":");
    if (parts.length >= 3) {
      dimensions.push({
        fkColumn: parts[0],
        dimensionTable: parts[1],
        joinKey: parts[2],
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
    "--authorization-flow": "authorization_code",
    "--force": true,
  });

  try { await commands["config cache init"]({ "--host": HOST }); } catch { /* non-blocking */ }

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
 * Check if a field name suggests it's a measure
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
 *
 * KEY FIX: Do NOT generate EntitySymbol/AssociationSymbol for dimensions!
 * Only generate the data structures (DimensionNode, Association, ElementMapping)
 * Let SAP Datasphere auto-generate the visual symbols.
 */
function generateUIModel(params, sourceElements, dimensions, dimensionElementsMap) {
  const modelId = generateUUID();
  const outputId = generateUUID();
  const sourceEntityId = generateUUID();
  const outputSymbolId = generateUUID();
  const sourceSymbolId = generateUUID();
  const diagramId = generateUUID();
  const sourceToOutputAssocSymbolId = generateUUID();

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
    // Diagram: ONLY source entity and output symbols, NO dimension symbols!
    [diagramId]: {
      classDefinition: "sap.cdw.querybuilder.ui.Diagram",
      symbols: {
        [outputSymbolId]: {},
        [sourceSymbolId]: { name: "Entity Symbol 1" },
        [sourceToOutputAssocSymbolId]: {}
      }
    },
    [outputSymbolId]: {
      classDefinition: "sap.cdw.querybuilder.ui.OutputSymbol",
      x: 47,
      y: 25,
      width: 140,
      height: 40,
      object: outputId
    },
    [sourceSymbolId]: {
      classDefinition: "sap.cdw.querybuilder.ui.EntitySymbol",
      name: "Entity Symbol 1",
      x: -163,
      y: 25,
      width: 160,
      displayName: "Entity Symbol 1",
      object: sourceEntityId
    },
    [sourceToOutputAssocSymbolId]: {
      classDefinition: "sap.cdw.querybuilder.ui.AssociationSymbol",
      points: "-3,45 47,45",
      contentOffsetX: 5,
      contentOffsetY: 5,
      sourceSymbol: sourceSymbolId,
      targetSymbol: outputSymbolId
    }
  };

  // Store dimension node info for association mappings
  const dimNodeInfoMap = {};

  // Add dimension nodes (data structure only, NO diagram symbols!)
  dimensions.forEach((dim) => {
    const dimNodeId = generateUUID();

    // Add to model nodes
    contents[modelId].nodes[dimNodeId] = { name: dim.dimensionTable };

    // Get dimension elements
    const dimElements = dimensionElementsMap[dim.dimensionTable] || {};
    const dimElementIds = {};

    // Generate element definitions for dimension table
    Object.keys(dimElements).forEach((dimColName) => {
      const dimElement = dimElements[dimColName];
      if (dimElement.type === "cds.Association") return;

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

    // Create DimensionNode
    contents[dimNodeId] = {
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

    // Store for later use
    dimNodeInfoMap[dim.dimensionTable] = {
      nodeId: dimNodeId,
      elementIds: dimElementIds
    };

    // NOTE: We do NOT add EntitySymbol or AssociationSymbol for dimensions!
    // SAP Datasphere will auto-generate them when the view is opened.
  });

  // Build set of FK columns
  const fkColumns = new Set(dimensions.map(d => d.fkColumn));

  // Add elements mapping
  let indexOrder = 0;
  Object.keys(sourceElements).forEach(colName => {
    const element = sourceElements[colName];
    if (element.type === "cds.Association") return;

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

    // Add foreign key reference
    dimensions.forEach(dim => {
      if (colName === dim.fkColumn) {
        const dimTableShort = dim.dimensionTable.replace(/^(LT_|DIM_)/i, "").substring(0, 10).toUpperCase();
        contents[outputElemId].foreignKey = `_${dimTableShort}`;
      }
    });
  });

  // Add associations
  dimensions.forEach(dim => {
    const assocId = generateUUID();
    const mappingId = generateUUID();
    const dimTableShort = dim.dimensionTable.replace(/^(LT_|DIM_)/i, "").substring(0, 10).toUpperCase();
    const assocName = `_${dimTableShort}`;

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

    if (!fkElemId || !joinKeyElemId) {
      console.warn(`Warning: Could not find element IDs for ${dim.fkColumn} -> ${dim.joinKey}`);
      return;
    }

    // Add association to model and output
    contents[modelId].associations[assocId] = { name: assocName };
    contents[outputId].associations[assocId] = { name: assocName };

    // Create association
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

    // Create element mapping
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

  const commands = await authenticate();

  console.log(`📋 Reading source structure: ${params.source}`);
  const sourceElements = await getSourceStructure(commands, params.space, params.source);

  const dimensions = parseDimensions(params.dimensions);

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

  let columnsToSelect;
  let viewElements = {};

  if (params.columns) {
    columnsToSelect = params.columns.split(",").map(c => c.trim());
    columnsToSelect.forEach(colName => {
      if (sourceElements[colName]) {
        viewElements[colName] = { ...sourceElements[colName] };
      } else {
        throw new Error(`Column '${colName}' not found in source '${params.source}'`);
      }
    });
  } else {
    Object.keys(sourceElements).forEach(colName => {
      if (sourceElements[colName].type !== "cds.Association") {
        viewElements[colName] = { ...sourceElements[colName] };
      }
    });
    columnsToSelect = Object.keys(viewElements);
  }

  const fkColumns = new Set(dimensions.map(d => d.fkColumn));
  Object.keys(viewElements).forEach(colName => {
    const element = viewElements[colName];
    if (element.type === "cds.Association") return;

    const isNumeric = element.type === "cds.Integer" || element.type === "cds.Decimal" || element.type === "cds.Double";
    const isMeasure = isNumeric && !element.key && !fkColumns.has(colName) && isMeasureField(colName);

    if (isMeasure) {
      element["@AnalyticsDetails.measureType"] = { "#": "BASE" };
      element["@Aggregation.default"] = { "#": "SUM" };
    }
  });

  const selectColumns = columnsToSelect.map(col => {
    const column = { ref: [col] };
    if (viewElements[col] && viewElements[col].key) {
      column.key = true;
    }
    return column;
  });

  const mixinAssociations = {};

  dimensions.forEach(dim => {
    const dimTableShort = dim.dimensionTable.replace(/^(LT_|DIM_)/i, "").substring(0, 10).toUpperCase();
    const assocName = `_${dimTableShort}`;

    if (viewElements[dim.fkColumn]) {
      viewElements[dim.fkColumn]["@ObjectModel.foreignKey.association"] = {
        "=": assocName
      };
    }

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

    selectColumns.push({ "ref": [assocName] });

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

  const selectQuery = {
    SELECT: {
      from: {
        ref: [params.source]
      },
      columns: selectColumns
    }
  };

  if (Object.keys(mixinAssociations).length > 0) {
    selectQuery.SELECT.mixin = mixinAssociations;
  }

  if (params.where) {
    selectQuery.SELECT.where = [params.where];
  }

  let modelingPattern = null;
  let supportedCapabilities = null;

  const hasMeasures = Object.values(viewElements).some(el => {
    if (el.type === "cds.Association") return false;
    if (el["@AnalyticsDetails.measureType"] || el["@Aggregation.default"]) return true;
    return el.type === "cds.Integer" || el.type === "cds.Decimal" || el.type === "cds.Double";
  });

  const hasDimensions = dimensions.length > 0;

  if (hasMeasures || hasDimensions) {
    modelingPattern = { "#": "ANALYTICAL_FACT" };
    supportedCapabilities = [{ "#": "DATA_STRUCTURE" }];
  }

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

  if (modelingPattern) {
    viewDefinition.definitions[params.name]["@ObjectModel.modelingPattern"] = modelingPattern;
    viewDefinition.definitions[params.name]["@ObjectModel.supportedCapabilities"] = supportedCapabilities;
  }

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

  const tempDir = process.env.TEMP || process.env.TMP || "/tmp";
  const tempFile = `${tempDir}/view-${params.name}.json`;
  await fs.writeFile(tempFile, JSON.stringify(viewDefinition, null, 2));

  try {
    const result = await commands["objects views create"]({
      "--host": HOST,
      "--space": params.space,
      "--file-path": tempFile,
    });

    console.log("✅ View created successfully!");
    console.log(JSON.stringify(result, null, 2));
    console.log();

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
    console.log("  --space         Space ID (default: $SPACE from .env)");
    console.log("  --label         User-friendly label");
    console.log("  --columns       Comma-separated column list");
    console.log("  --where         WHERE condition");
    console.log("  --dimensions    Dimension associations: FK_COL:DIM_TABLE:JOIN_KEY;...");
    process.exit(1);
  }

  if (!params.source) {
    console.error("❌ Error: --source parameter is required");
    process.exit(1);
  }

  await createView(params);
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/"))) {
  main().catch((error) => {
    console.error("Fatal error:", error);
    process.exit(1);
  });
}

export { createView, parseArgs, parseDimensions, authenticate, getSourceStructure };
