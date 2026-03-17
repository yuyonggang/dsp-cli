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
    "--authorization-url": AUTH_URL,
    "--token-url": TOKEN_URL,
    "--authorization-flow": "authorization_code",
    "--force": true,
  });

  await commands["config cache init"]({ "--host": HOST });

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
        associations: associations
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

  // Parse dimensions
  const dimensions = parseDimensions(params.dimensions);

  // Determine attributes and measures
  let attributeList = [];
  let measureList = [];

  if (params.attributes) {
    attributeList = params.attributes.split(",").map(c => c.trim());
  }

  if (params.measures) {
    measureList = params.measures.split(",").map(c => c.trim());
  }

  // If not specified, auto-detect
  if (attributeList.length === 0 && measureList.length === 0) {
    Object.keys(sourceElements).forEach(colName => {
      const element = sourceElements[colName];
      // Skip associations
      if (element.type === "cds.Association") return;

      if (isNumericType(element.type)) {
        measureList.push(colName);
      } else {
        attributeList.push(colName);
      }
    });
  }

  // Build elements for CDS definition
  const elements = {};
  const selectColumns = [];
  const mixinAssociations = {};
  let dimCounter = 0;

  // Add fact attributes and measures
  const allColumns = [...attributeList, ...measureList];
  allColumns.forEach(colName => {
    if (!sourceElements[colName] || sourceElements[colName].type === "cds.Association") {
      throw new Error(`Column '${colName}' not found in source '${params.source}' or is an association`);
    }

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

  // Process dimensions and add associations
  const dimensionSources = {};
  const dimensionAttributes = {};

  for (const dim of dimensions) {
    // Read dimension table structure
    console.log(`📋 Reading dimension: ${dim.dimensionTable}`);
    const dimInfo = await getSourceStructure(commands, params.space, dim.dimensionTable);
    const dimElements = dimInfo.elements;

    // Create association name (Datasphere format: _TABLE∞INDEX)
    const dimPrefix = dim.dimensionTable.replace(/[^A-Za-z0-9]/g, "_");
    const assocName = `_${dimPrefix}∞${dimCounter}`;
    const assocNameBase = `_${dimPrefix}`; // For associationSteps (without ∞INDEX)
    dimCounter++;

    // Add FK column to elements if not already there
    if (!elements[dim.fkColumn]) {
      elements[dim.fkColumn] = {
        "@EndUserText.label": dim.fkColumn,
        "@ObjectModel.foreignKey.association": {
          "=": assocName
        }
      };

      selectColumns.push({
        ref: [params.source, dim.fkColumn],
        as: dim.fkColumn
      });
    } else {
      // Add association reference to existing FK
      elements[dim.fkColumn]["@ObjectModel.foreignKey.association"] = {
        "=": assocName
      };
    }

    // Add association element
    elements[assocName] = {
      type: "cds.Association",
      on: [
        { ref: [dim.fkColumn] },
        "=",
        { ref: [assocName, dim.joinKey] }
      ],
      target: dim.dimensionTable,
      "@EndUserText.label": dim.fkColumn
    };

    // Add association to select columns
    selectColumns.push({ ref: [assocName] });

    // Add mixin association
    mixinAssociations[assocName] = {
      type: "cds.Association",
      on: [
        { ref: ["$projection", dim.fkColumn] },
        "=",
        { ref: [assocName, dim.joinKey] }
      ],
      target: dim.dimensionTable,
      "@EndUserText.label": dim.fkColumn
    };

    // Add dimension attributes (use original names, no prefix)
    dim.attributes.forEach(attrName => {
      if (!dimElements[attrName]) {
        console.warn(`⚠️  Warning: Attribute '${attrName}' not found in dimension '${dim.dimensionTable}'`);
        return;
      }

      elements[attrName] = {
        "@EndUserText.label": dimElements[attrName]["@EndUserText.label"] || attrName,
        "@Analytics.navigationAttributeRef": [assocName, attrName]
      };

      selectColumns.push({
        ref: [assocName, attrName],
        as: attrName
      });

      // Add to business layer dimension attributes
      dimensionAttributes[attrName] = {
        attributeType: "AnalyticModelAttributeType.DimensionSourceAttribute",
        sourceKey: String(Object.keys(dimensionSources).length),
        key: attrName,
        text: dimElements[attrName]["@EndUserText.label"] || attrName
      };
    });

    // Add dimension source to business layer
    const dimSourceKey = String(Object.keys(dimensionSources).length);
    dimensionSources[dimSourceKey] = {
      text: dim.fkColumn,
      dataEntity: {
        key: dim.dimensionTable
      },
      associationContexts: [
        {
          sourceKey: "0",
          sourceType: "AnalyticModelSourceType.Fact",
          associationSteps: [assocNameBase]
        }
      ]
    };
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

  attributeList.forEach(colName => {
    businessAttributes[colName] = {
      attributeType: "AnalyticModelAttributeType.FactSourceAttribute",
      attributeMapping: {
        "0": {
          key: colName
        }
      },
      text: sourceElements[colName]["@EndUserText.label"] || colName
    };
  });

  // Merge dimension attributes
  Object.assign(businessAttributes, dimensionAttributes);

  // Build business layer measures
  const businessMeasures = {};
  measureList.forEach(colName => {
    businessMeasures[colName] = {
      measureType: "AnalyticModelMeasureType.FactSourceMeasure",
      sourceKey: "0",
      text: sourceElements[colName]["@EndUserText.label"] || colName,
      key: colName,
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
          }
        ],
        "@DataWarehouse.editorType": {
          "#": "DWCQueryModelEditor"
        },
        "@DataWarehouse.hanaCatalog.viewType": {
          "#": "CALCULATION_VIEW"
        },
        "@DataWarehouse.consumption.external": true,
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
            "0": {
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
        "version": "1.2.0",
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

if (import.meta.url === `file://${process.argv[1].replace(/\\/g, "/")}`) {
  main().catch((error) => {
    console.error("Fatal error:", error);
    process.exit(1);
  });
}

export { createAnalyticModel, parseArgs, parseDimensions, authenticate, getSourceStructure };
