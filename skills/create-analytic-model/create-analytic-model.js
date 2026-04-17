/**
 * Skill Implementation: create-analytic-model
 * Creates an Analytic Model in SAP Datasphere
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
    attributes: null,
    measures: null,
    dimensions: null,  // New: support dimensions with associations
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
    } else if (args[i] === "--attributes" && args[i + 1]) {
      params.attributes = args[i + 1];
      i++;
    } else if (args[i] === "--measures" && args[i + 1]) {
      params.measures = args[i + 1];
      i++;
    } else if (args[i] === "--dimensions" && args[i + 1]) {
      params.dimensions = args[i + 1];
      i++;
    }
  }

  return params;
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
 * Read source to get its structure and associations
 */
async function getSourceStructure(commands, space, sourceName) {
  try {
    const table = await commands["objects local-tables read"]({
      "--host": HOST,
      "--space": space,
      "--technical-name": sourceName,
    });
    return {
      elements: table.definitions[sourceName].elements,
      associations: {}
    };
  } catch (error) {
    try {
      const view = await commands["objects views read"]({
        "--host": HOST,
        "--space": space,
        "--technical-name": sourceName,
      });

      const elements = view.definitions[sourceName].elements;
      const associations = {};

      // Extract associations from elements
      Object.keys(elements).forEach(key => {
        if (elements[key].type === "cds.Association") {
          associations[key] = elements[key];
        }
      });

      return {
        elements: elements,
        associations: associations,
        isView: true
      };
    } catch (viewError) {
      throw new Error(`Source '${sourceName}' not found in space '${space}'`);
    }
  }
}

/**
 * Determine if a column is numeric (should be a measure)
 */
function isNumericType(type) {
  return type === "cds.Integer" || type === "cds.Decimal" || type === "cds.Double";
}

/**
 * Parse dimensions parameter
 * Format: "FK_COLUMN:DIMENSION_TABLE:JOIN_KEY:ATTR1,ATTR2"
 * Example: "PRODUCT:LT_PRODUCT_DIM:PRODUCT_ID:PRODUCT_NAME,CATEGORY"
 */
function parseDimensions(dimensionsStr) {
  if (!dimensionsStr) return [];

  const dimensions = [];
  const dimDefs = dimensionsStr.split(";");

  dimDefs.forEach(dimDef => {
    const parts = dimDef.trim().split(":");
    if (parts.length >= 3) {
      dimensions.push({
        fkColumn: parts[0],           // Foreign key column in fact table
        dimensionTable: parts[1],      // Dimension table name
        joinKey: parts[2],             // Key column in dimension table
        attributes: parts[3] ? parts[3].split(",").map(a => a.trim()) : []
      });
    }
  });

  return dimensions;
}

/**
 * Create analytic model
 */
async function createAnalyticModel(params) {
  console.log(`🚀 Creating Analytic Model: ${params.name} from ${params.source} in space ${params.space}\n`);

  // Authenticate
  const commands = await authenticate();

  // Get source structure
  console.log(`📋 Reading source structure: ${params.source}`);
  const sourceInfo = await getSourceStructure(commands, params.space, params.source);
  const sourceElements = sourceInfo.elements;
  const sourceAssociations = sourceInfo.associations;
  const isView = sourceInfo.isView || false;

  console.log(`   Source type: ${isView ? 'View' : 'Table'}`);
  console.log(`   Found ${Object.keys(sourceAssociations).length} associations in source`);

  // Parse dimensions from --dimensions parameter
  const dimensionsParam = parseDimensions(params.dimensions);

  // Determine attributes and measures
  let attributeList = [];
  let measureList = [];

  if (params.attributes) {
    attributeList = params.attributes.split(",").map(c => c.trim());
  }

  if (params.measures) {
    // Parse measures format: COLUMN:aggregation or just COLUMN
    measureList = params.measures.split(",").map(c => {
      const parts = c.trim().split(":");
      return parts[0]; // Only take column name, ignore aggregation function
    });
  }

  // Auto-detect: if measures specified but no attributes, auto-detect attributes
  // If nothing specified, auto-detect both
  if (attributeList.length === 0) {
    Object.keys(sourceElements).forEach(colName => {
      const element = sourceElements[colName];
      // Skip associations
      if (element.type === "cds.Association") return;
      // Skip if already in measure list
      if (measureList.includes(colName)) return;

      if (measureList.length === 0 && isNumericType(element.type)) {
        // Only auto-detect measures if no measures were specified
        measureList.push(colName);
      } else if (!isNumericType(element.type) || measureList.length > 0) {
        // Add non-numeric columns as attributes, or all non-measure columns if measures were specified
        attributeList.push(colName);
      }
    });
  }

  // Build elements for CDS definition
  const elements = {};
  const selectColumns = [];
  const mixinAssociations = {};
  const dimensionSources = {};
  const dimensionAttributes = {};
  const dimensionSelectColumns = {};  // Store dimension columns to add after fact attributes

  // If source is a view with associations, use those associations
  if (isView && Object.keys(sourceAssociations).length > 0) {
    console.log(`📌 Using associations from view...`);

    // Process each association from the view
    for (const [assocName, assocDef] of Object.entries(sourceAssociations)) {
      const target = assocDef.target;
      console.log(`   - Association: ${assocName} → ${target}`);

      // Read dimension table to get its attributes
      const dimInfo = await getSourceStructure(commands, params.space, target);
      const dimElements = dimInfo.elements;

      // Find the FK column that uses this association
      let fkColumn = null;
      for (const [colName, colDef] of Object.entries(sourceElements)) {
        if (colDef["@ObjectModel.foreignKey.association"] &&
            colDef["@ObjectModel.foreignKey.association"]["="] === assocName) {
          fkColumn = colName;
          break;
        }
      }

      if (!fkColumn) {
        console.warn(`⚠️  Warning: Could not find FK column for association ${assocName}`);
        continue;
      }

      // Add FK column with association reference
      elements[fkColumn] = {
        "@EndUserText.label": sourceElements[fkColumn]["@EndUserText.label"] || fkColumn,
        "@ObjectModel.foreignKey.association": {
          "=": assocName
        }
      };

      selectColumns.push({
        ref: [params.source, fkColumn],
        as: fkColumn
      });

      // Add association element (using same name as in view)
      elements[assocName] = {
        type: "cds.Association",
        on: assocDef.on,
        target: target,
        "@EndUserText.label": fkColumn
      };

      selectColumns.push({ ref: [assocName] });

      // Add mixin association (no @EndUserText.label in mixin)
      mixinAssociations[assocName] = {
        type: "cds.Association",
        on: [
          { ref: ["$projection", fkColumn] },
          "=",
          { ref: [assocName, assocDef.on[2].ref[1]] }  // Join key from association definition
        ],
        target: target
      };

      // Add dimension attributes with suffix naming (ATTR_FK format)
      // Skip dimension's ID/key column - it's already represented by the FK column
      const suffix = `_${fkColumn}`;
      const joinKey = assocDef.on[2].ref[1];  // The key column in dimension (e.g., "ID")

      Object.keys(dimElements).forEach(attrName => {
        const dimEl = dimElements[attrName];
        if (dimEl.type === "cds.Association") return;  // Skip associations in dimension
        if (attrName === joinKey) return;  // Skip ID/key column - already represented by FK

        const amAttrName = `${attrName}${suffix}`;

        elements[amAttrName] = {
          "@EndUserText.label": dimEl["@EndUserText.label"] || attrName,
          "@Analytics.navigationAttributeRef": [assocName, attrName]
        };

        // Don't add to selectColumns here - will be added after fact attributes

        // Add to business layer
        dimensionAttributes[amAttrName] = {
          attributeType: "AnalyticModelAttributeType.DimensionSourceAttribute",
          sourceKey: assocName,
          key: attrName,
          text: dimEl["@EndUserText.label"] || attrName,
          duplicated: false
        };
      });

      // Store dimension attribute columns for later (after fact attributes)
      dimensionSelectColumns[assocName] = { suffix, joinKey, dimElements };

      // Add dimension source to business layer
      dimensionSources[assocName] = {
        text: fkColumn,
        dataEntity: {
          key: target
        },
        associationContexts: [
          {
            sourceKey: params.source,
            sourceType: "AnalyticModelSourceType.Fact",
            associationSteps: [assocName]  // Use the association name from view
          }
        ],
        technicalAffix: {
          text: suffix,
          type: "AnalyticModelDimensionAffixType.SUFFIX"
        }
      };
    }
  }

  // Add fact attributes and measures
  const allColumns = [...attributeList, ...measureList];
  allColumns.forEach(colName => {
    if (!sourceElements[colName] || sourceElements[colName].type === "cds.Association") {
      if (sourceElements[colName]?.type === "cds.Association") {
        return;  // Skip associations, already handled above
      }
      throw new Error(`Column '${colName}' not found in source '${params.source}' or is an association`);
    }

    // Skip if already added (e.g., FK columns)
    if (elements[colName]) return;

    elements[colName] = {
      "@EndUserText.label": sourceElements[colName]["@EndUserText.label"] || colName
    };

    // Add measure annotation
    if (measureList.includes(colName)) {
      elements[colName]["@AnalyticsDetails.measureType"] = { "#": "BASE" };
    }

    selectColumns.push({
      ref: [params.source, colName],
      as: colName
    });
  });

  // Add dimension attribute columns AFTER fact attributes (correct order)
  for (const [assocName, dimInfo] of Object.entries(dimensionSelectColumns)) {
    const { suffix, joinKey, dimElements } = dimInfo;
    Object.keys(dimElements).forEach(attrName => {
      const dimEl = dimElements[attrName];
      if (dimEl.type === "cds.Association") return;  // Skip associations
      if (attrName === joinKey) return;  // Skip ID/key column

      const amAttrName = `${attrName}${suffix}`;
      selectColumns.push({
        ref: [assocName, attrName],
        as: amAttrName
      });
    });
  }

  // Build SELECT query
  const selectQuery = {
    SELECT: {
      from: {
        ref: [params.source],
        as: params.source
      },
      columns: selectColumns
    }
  };

  // Add mixin if there are associations
  if (Object.keys(mixinAssociations).length > 0) {
    selectQuery.SELECT.mixin = mixinAssociations;
  }

  // Build business layer attributes
  const businessAttributes = {};

  // First, add FK columns that were processed for associations
  // These need to be added BEFORE other attributes with usedForDimensionSourceKey
  for (const [assocName, assocDef] of Object.entries(sourceAssociations)) {
    // Find the FK column for this association
    for (const [colName, colDef] of Object.entries(sourceElements)) {
      if (colDef["@ObjectModel.foreignKey.association"] &&
          colDef["@ObjectModel.foreignKey.association"]["="] === assocName) {
        businessAttributes[colName] = {
          attributeType: "AnalyticModelAttributeType.FactSourceAttribute",
          attributeMapping: {
            [params.source]: {
              key: colName
            }
          },
          text: sourceElements[colName]["@EndUserText.label"] || colName,
          duplicated: false,
          usedForDimensionSourceKey: assocName
        };
        break;
      }
    }
  }

  // Then add other fact attributes (non-FK columns)
  attributeList.forEach(colName => {
    // Skip if already added as FK column
    if (businessAttributes[colName]) return;

    // Skip associations
    if (sourceElements[colName]?.type === "cds.Association") return;

    businessAttributes[colName] = {
      attributeType: "AnalyticModelAttributeType.FactSourceAttribute",
      attributeMapping: {
        [params.source]: {
          key: colName
        }
      },
      text: sourceElements[colName]["@EndUserText.label"] || colName,
      duplicated: false
    };
  });

  // Merge dimension attributes
  Object.assign(businessAttributes, dimensionAttributes);

  // Build business layer measures
  const businessMeasures = {};
  measureList.forEach(colName => {
    businessMeasures[colName] = {
      measureType: "AnalyticModelMeasureType.FactSourceMeasure",
      measureMapping: {
        [params.source]: {
          key: colName
        }
      },
      text: sourceElements[colName]["@EndUserText.label"] || colName,
      isAuxiliary: false
    };
  });

  // Generate analytic model definition
  const modelDefinition = {
    "definitions": {
      [params.name]: {
        "kind": "entity",
        "@EndUserText.label": params.label || params.name,
        "elements": elements,
        "@ObjectModel.modelingPattern": {
          "#": "ANALYTICAL_CUBE"
        },
        "@ObjectModel.supportedCapabilities": [
          {
            "#": "ANALYTICAL_PROVIDER"
          },
          {
            "#": "_DWC_AM_EDITABLE_DIMENSION_NAMES"
          }
        ],
        "@DataWarehouse.editorType": {
          "#": "DWCQueryModelEditor"
        },
        "@DataWarehouse.hanaCatalog.viewType": {
          "#": "CALCULATION_VIEW"
        },
        "query": selectQuery
      }
    },
    "businessLayerDefinitions": {
      [params.name]: {
        "identifier": {
          "key": params.name
        },
        "text": params.label || params.name,
        "sourceModel": {
          "factSources": {
            [params.source]: {
              "text": params.source,
              "dataEntity": {
                "key": params.source
              }
            }
          },
          "dimensionSources": dimensionSources
        },
        "exposedAssociations": {},
        "attributes": businessAttributes,
        "measures": businessMeasures,
        "version": "1.7.0",
        "supportedCapabilities": {},
        "crossCalculations": {},
        "variables": {}
      }
    }
  };

  console.log("📝 Analytic Model Definition:");
  console.log(JSON.stringify(modelDefinition, null, 2));
  console.log();

  // Save to temp file
  const tempDir = process.env.TEMP || process.env.TMP || "/tmp";
  const tempFile = `${tempDir}/analytic-model-${params.name}.json`;
  await fs.writeFile(tempFile, JSON.stringify(modelDefinition, null, 2));

  // Create analytic model
  try {
    const result = await commands["objects analytic-models create"]({
      "--host": HOST,
      "--space": params.space,
      "--file-path": tempFile,
    });

    console.log("✅ Analytic Model created successfully!");
    console.log(JSON.stringify(result, null, 2));
    console.log();

    // Verify
    const readResult = await commands["objects analytic-models read"]({
      "--host": HOST,
      "--space": params.space,
      "--technical-name": params.name,
    });

    console.log("✅ Verified - Analytic Model details:");
    console.log(JSON.stringify(readResult, null, 2));

    return readResult;
  } catch (error) {
    console.error("❌ Failed to create analytic model:", error.message);

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
    console.log("\nUsage: node create-analytic-model.js --name MODEL_NAME --source SOURCE [--space SPACE_ID] [--label LABEL] [--attributes ATTRS] [--measures MEASURES] [--dimensions DIMS]");
    console.log("\nDimensions format: FK_COL:DIM_TABLE:JOIN_KEY:ATTR1,ATTR2;...");
    console.log("Example: --dimensions \"PRODUCT:LT_PRODUCT_DIM:PRODUCT_ID:PRODUCT_NAME,CATEGORY\"");
    process.exit(1);
  }

  if (!params.source) {
    console.error("❌ Error: --source parameter is required");
    console.log("\nUsage: node create-analytic-model.js --name MODEL_NAME --source SOURCE [--space SPACE_ID] [--label LABEL] [--attributes ATTRS] [--measures MEASURES] [--dimensions DIMS]");
    console.log("\nDimensions format: FK_COL:DIM_TABLE:JOIN_KEY:ATTR1,ATTR2;...");
    console.log("Example: --dimensions \"PRODUCT:LT_PRODUCT_DIM:PRODUCT_ID:PRODUCT_NAME,CATEGORY\"");
    process.exit(1);
  }

  await createAnalyticModel(params);
}

// Run main if this is the entry point
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/"))) {
  main().catch((error) => {
    console.error("Fatal error:", error);
    process.exit(1);
  });
}

export { createAnalyticModel, parseArgs, parseDimensions, authenticate, getSourceStructure };
