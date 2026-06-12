/**
 * Skill Implementation: create-data-flow
 * Creates a Data Flow in SAP Datasphere
 *
 * This creates a simple source→target data flow based on the structure
 * learned from existing data flows in the system.
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
    target: null,
    space: process.env.SPACE,
    label: null,
    mode: "truncate",
  };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--name" && args[i + 1]) {
      params.name = args[i + 1];
      i++;
    } else if (args[i] === "--source" && args[i + 1]) {
      params.source = args[i + 1];
      i++;
    } else if (args[i] === "--target" && args[i + 1]) {
      params.target = args[i + 1];
      i++;
    } else if (args[i] === "--space" && args[i + 1]) {
      params.space = args[i + 1];
      i++;
    } else if (args[i] === "--label" && args[i + 1]) {
      params.label = args[i + 1];
      i++;
    } else if (args[i] === "--mode" && args[i + 1]) {
      params.mode = args[i + 1];
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
 * Read source structure
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
      type: "TABLE"
    };
  } catch (error) {
    try {
      const view = await commands["objects views read"]({
        "--host": HOST,
        "--space": space,
        "--technical-name": sourceName,
      });
      return {
        elements: view.definitions[sourceName].elements,
        type: "VIEW"
      };
    } catch (viewError) {
      throw new Error(`Source '${sourceName}' not found in space '${space}'`);
    }
  }
}

/**
 * Map CDS type to data flow template type
 */
function mapToTemplateType(cdsType) {
  if (cdsType === "cds.String") return "string";
  if (cdsType === "cds.Integer") return "integer";
  if (cdsType === "cds.Decimal") return "decimal";
  if (cdsType === "cds.Date") return "date";
  if (cdsType === "cds.DateTime" || cdsType === "cds.Timestamp") return "timestamp";
  if (cdsType === "cds.Boolean") return "boolean";
  return "string";
}

/**
 * Create data flow
 */
async function createDataFlow(params) {
  console.log(`🚀 Creating Data Flow: ${params.name} in space ${params.space}\n`);
  console.log(`   Source: ${params.source}`);
  console.log(`   Target: ${params.target}`);
  console.log(`   Mode: ${params.mode}`);
  console.log();

  // Authenticate
  const commands = await authenticate();

  // Get source structure
  console.log(`📋 Reading source structure: ${params.source}`);
  const sourceInfo = await getSourceStructure(commands, params.space, params.source);
  const sourceElements = sourceInfo.elements;

  // Build vTypes and attribute mappings
  const scalarTypes = {};
  const tableColumns = [];
  const attributeMappings = [];
  const targetAttributes = [];

  let typeCounter = 0;
  Object.keys(sourceElements).forEach(colName => {
    const element = sourceElements[colName];

    // Skip associations
    if (element.type === "cds.Association") return;

    const templateType = mapToTemplateType(element.type);
    const typeName = `${templateType}_${typeCounter}`;
    typeCounter++;

    // Add scalar type
    const scalarType = {
      name: typeName,
      description: `${colName} type`,
      "vflow.type": "scalar",
      template: templateType
    };

    if (element.length) scalarType["value.length"] = element.length;
    if (element.precision) scalarType.precision = element.precision;
    if (element.scale) scalarType.scale = element.scale;

    scalarTypes[typeName] = scalarType;

    // Add to table columns
    tableColumns.push({
      [colName]: {
        "vflow.type": "scalar",
        "vtype-ID": `$INLINE.${typeName}`
      }
    });

    // Add attribute mapping
    attributeMappings.push({
      expression: `"${colName}"`,
      target: colName
    });

    // Add target attribute
    const targetAttr = {
      name: colName,
      templateType: templateType
    };
    if (element.length) targetAttr.length = element.length;
    if (element.precision) targetAttr.precision = element.precision;
    if (element.scale) targetAttr.scale = element.scale;

    targetAttributes.push(targetAttr);
  });

  // Build sources and targets sections
  const sources = {};
  sources[params.source] = {
    elements: Object.keys(sourceElements).reduce((acc, key) => {
      if (sourceElements[key].type !== "cds.Association") {
        acc[key] = {};
      }
      return acc;
    }, {})
  };

  const targets = {};
  targets[params.target] = {
    elements: Object.keys(sourceElements).reduce((acc, key) => {
      if (sourceElements[key].type !== "cds.Association") {
        acc[key] = {};
      }
      return acc;
    }, {})
  };

  // Generate data flow definition
  const flowDefinition = {
    "dataflows": {
      [params.name]: {
        "kind": "sap.dis.dataflow",
        "@EndUserText.label": params.label || params.name,
        "contents": {
          "properties": {},
          "metadata": {
            "dwc-restartOnFail": false
          },
          "description": params.name,
          "processes": {
            "target1": {
              "component": "com.sap.database.table.producer",
              "metadata": {
                "label": params.target,
                "x": 431,
                "y": 274,
                "height": 60,
                "width": 120,
                "config": {
                  "service": "HANA",
                  "hanaConnection": {
                    "configurationType": "Configuration Manager",
                    "connectionID": "$DWC"
                  },
                  "qualifiedName": params.target,
                  "dwcEntity": params.target,
                  "mode": params.mode,
                  "remoteObjectType": "TABLE",
                  "fetchSize": 1000,
                  "forceFetchSize": false,
                  "upsert": params.mode === "upsert",
                  "batchSize": 1000,
                  "forceBatchSize": false,
                  "deleteModeMappingType": "",
                  "attributeMappings": attributeMappings,
                  "hanaAdaptedDataset": {
                    "schema": {
                      "genericType": "TABLE",
                      "tableBasedRepresentation": {
                        "attributes": targetAttributes,
                        "uniqueKeys": []
                      }
                    }
                  }
                },
                "inports": [
                  {
                    "name": "inTable",
                    "type": "table",
                    "vtype-ID": "$INLINE.source_outTable"
                  }
                ]
              }
            },
            "source1": {
              "component": "com.sap.database.table.consumer",
              "metadata": {
                "label": params.source,
                "x": 146,
                "y": 274,
                "height": 60,
                "width": 120,
                "config": {
                  "service": "HANA",
                  "hanaConnection": {
                    "configurationType": "Configuration Manager",
                    "connectionID": "$DWC"
                  },
                  "qualifiedName": params.source,
                  "dwcEntity": params.source,
                  "mode": "append",
                  "remoteObjectType": sourceInfo.type,
                  "fetchSize": 1000,
                  "forceFetchSize": false
                },
                "outports": [
                  {
                    "name": "outTable",
                    "type": "table",
                    "vtype-ID": "$INLINE.source_outTable"
                  }
                ]
              }
            }
          },
          "groups": [],
          "connections": [
            {
              "metadata": {
                "points": "266,304 427.5,304"
              },
              "src": {
                "port": "outTable",
                "process": "source1"
              },
              "tgt": {
                "port": "inTable",
                "process": "target1"
              }
            }
          ],
          "inports": {},
          "outports": {},
          "vTypes": {
            "scalar": scalarTypes,
            "structure": {},
            "table": {
              "source_outTable": {
                "name": "source_outTable",
                "vflow.type": "table",
                "rows": {
                  "components": tableColumns
                }
              }
            }
          }
        },
        "sources": sources,
        "targets": targets,
        "connections": {}
      }
    }
  };

  console.log("\n📝 Data Flow Definition:");
  console.log(JSON.stringify(flowDefinition, null, 2));
  console.log();

  // Save to temp file
  const tempDir = process.env.TEMP || process.env.TMP || "/tmp";
  const tempFile = `${tempDir}/data-flow-${params.name}.json`;
  await fs.writeFile(tempFile, JSON.stringify(flowDefinition, null, 2));

  // Create data flow
  try {
    const result = await commands["objects data-flows create"]({
      "--host": HOST,
      "--space": params.space,
      "--file-path": tempFile,
    });

    console.log("✅ Data Flow created successfully!");
    console.log(JSON.stringify(result, null, 2));
    console.log();

    // Verify
    const readResult = await commands["objects data-flows read"]({
      "--host": HOST,
      "--space": params.space,
      "--technical-name": params.name,
    });

    console.log("✅ Verified - Data Flow details:");
    console.log(JSON.stringify(readResult, null, 2));

    console.log("\n💡 To run the data flow, use the Datasphere UI or appropriate CLI command.");

    return readResult;
  } catch (error) {
    console.error("❌ Failed to create data flow:", error.message);

    if (error.response && error.response.data) {
      console.error("\n📋 Error details:");
      console.error(JSON.stringify(error.response.data, null, 2));
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
    console.log("\nUsage: node create-data-flow.js --name FLOW_NAME --source SOURCE --target TARGET [OPTIONS]");
    process.exit(1);
  }

  if (!params.source) {
    console.error("❌ Error: --source parameter is required");
    console.log("\nUsage: node create-data-flow.js --name FLOW_NAME --source SOURCE --target TARGET [OPTIONS]");
    process.exit(1);
  }

  if (!params.target) {
    console.error("❌ Error: --target parameter is required");
    console.log("\nUsage: node create-data-flow.js --name FLOW_NAME --source SOURCE --target TARGET [OPTIONS]");
    process.exit(1);
  }

  await createDataFlow(params);
}

// Run main if this is the entry point
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/"))) {
  main().catch((error) => {
    console.error("Fatal error:", error);
    process.exit(1);
  });
}

export { createDataFlow, parseArgs, authenticate, getSourceStructure };
