/**
 * Skill Implementation: create-replication-flow
 * Creates a Replication Flow in SAP Datasphere
 *
 * Based on actual Datasphere Replication Flow structure learned from TEST_RL_TTG
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
    sourceConnection: "$DWC", // Default to internal connection
    targetConnection: null,
    targetContainer: "/DWC_GLOBAL",
    space: process.env.SPACE,
    label: null,
    loadType: "INITIAL", // INITIAL or DELTA
    truncate: false,
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
    } else if (args[i] === "--source-connection" && args[i + 1]) {
      params.sourceConnection = args[i + 1];
      i++;
    } else if (args[i] === "--target-connection" && args[i + 1]) {
      params.targetConnection = args[i + 1];
      i++;
    } else if (args[i] === "--target-container" && args[i + 1]) {
      params.targetContainer = args[i + 1];
      i++;
    } else if (args[i] === "--space" && args[i + 1]) {
      params.space = args[i + 1];
      i++;
    } else if (args[i] === "--label" && args[i + 1]) {
      params.label = args[i + 1];
      i++;
    } else if (args[i] === "--load-type" && args[i + 1]) {
      params.loadType = args[i + 1].toUpperCase();
      i++;
    } else if (args[i] === "--truncate") {
      params.truncate = true;
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
 * Read source object structure
 */
async function readSourceObject(commands, space, objectName, objectType) {
  const commandMap = {
    "TABLE": "objects local-tables read",
    "VIEW": "objects views read"
  };

  const command = commandMap[objectType] || "objects local-tables read";

  try {
    const result = await commands[command]({
      "--host": HOST,
      "--space": space,
      "--technical-name": objectName,
    });

    return result.definitions[objectName];
  } catch (error) {
    console.error(`⚠️  Warning: Could not read source object ${objectName}`);
    return null;
  }
}

/**
 * Map CDS type to vType
 */
function mapCdsTypeToVType(cdsType, length, precision, scale) {
  if (cdsType === "cds.String") {
    return `$DYNAMIC.string_${length || 255}`;
  } else if (cdsType === "cds.Decimal") {
    return `$DYNAMIC.decimal_${precision || 15}_${scale || 2}`;
  } else if (cdsType === "cds.Integer") {
    return "$DYNAMIC.integer";
  } else if (cdsType === "cds.Date") {
    return "com.sap.core.date";
  } else if (cdsType === "cds.DateTime") {
    return "com.sap.core.timestamp";
  } else {
    return "$DYNAMIC.string_255";
  }
}

/**
 * Generate vTypes definitions
 */
function generateVTypes(sourceObject) {
  const vTypes = { scalar: {} };

  if (sourceObject && sourceObject.elements) {
    Object.entries(sourceObject.elements).forEach(([colName, colDef]) => {
      const type = colDef.type || "cds.String";
      const length = colDef.length;
      const precision = colDef.precision;
      const scale = colDef.scale;

      if (type === "cds.String" && length) {
        const key = `string_${length}`;
        if (!vTypes.scalar[key]) {
          vTypes.scalar[key] = {
            "name": key,
            "description": `String(${length})`,
            "vflow.type": "scalar",
            "template": "string",
            "value.length": length
          };
        }
      } else if (type === "cds.Decimal" && precision && scale) {
        const key = `decimal_${precision}_${scale}`;
        if (!vTypes.scalar[key]) {
          vTypes.scalar[key] = {
            "name": key,
            "description": `Decimal(${precision},${scale})`,
            "vflow.type": "scalar",
            "template": "decimal",
            "value.precision": precision,
            "value.scale": scale
          };
        }
      }
    });
  }

  return vTypes;
}

/**
 * Generate column definitions from source object
 */
function generateColumns(sourceObject) {
  const columns = [];

  if (sourceObject && sourceObject.elements) {
    Object.entries(sourceObject.elements).forEach(([colName, colDef]) => {
      const type = colDef.type || "cds.String";
      const vtypeId = mapCdsTypeToVType(type, colDef.length, colDef.precision, colDef.scale);

      columns.push({
        "name": colName,
        "vflow.type": "scalar",
        "vtype-ID": vtypeId,
        "key": colDef.key || false,
        "businessName": colDef["@EndUserText.label"] || colName,
        "metadata": {}
      });
    });
  }

  return columns;
}

/**
 * Create replication flow
 */
async function createReplicationFlow(params) {
  console.log(`🚀 Creating Replication Flow: ${params.name} in space ${params.space}\n`);
  console.log(`   Source: ${params.source}`);
  console.log(`   Target: ${params.target}`);
  console.log(`   Load Type: ${params.loadType}`);
  console.log();

  // Authenticate
  const commands = await authenticate();

  // Read source object to get structure
  console.log(`📋 Reading source object: ${params.source}...`);
  const sourceObject = await readSourceObject(commands, params.space, params.source, "VIEW");

  if (!sourceObject) {
    console.log(`⚠️  Could not read source, will use simplified structure`);
  } else {
    console.log(`✅ Source object read successfully`);
  }

  // Generate vTypes and columns
  const vTypes = generateVTypes(sourceObject);
  const sourceColumns = generateColumns(sourceObject);
  const targetColumns = generateColumns(sourceObject); // Same structure for target

  // Generate source elements map
  const sourceElements = {};
  if (sourceObject && sourceObject.elements) {
    Object.keys(sourceObject.elements).forEach(colName => {
      sourceElements[colName] = {};
    });
  }

  // Generate replication flow definition (correct format based on TEST_RL_TTG)
  const flowDefinition = {
    "replicationflows": {
      [params.name]: {
        "kind": "sap.dis.replicationflow",
        "@EndUserText.label": params.label || params.name,
        "contents": {
          "description": params.name,
          "sourceSystem": [
            {
              "connectionId": params.sourceConnection,
              "connectionType": "HANA",
              "container": "",
              "maxConnections": 10,
              "metadata": {}
            }
          ],
          "targetSystem": [
            {
              "connectionId": params.targetConnection || params.sourceConnection,
              "connectionType": "HANA",
              "container": params.targetContainer,
              "maxConnections": 10,
              "metadata": {}
            }
          ],
          "vTypes": vTypes,
          "replicationTasks": [
            {
              "name": "replicationtask1",
              "loadType": params.loadType,
              "priority": 50,
              "truncate": params.truncate,
              "sourceObject": {
                "name": params.source,
                "definition": {
                  "columns": sourceColumns,
                  "keys": []
                },
                "metadata": {
                  "type": "VIEW",
                  "isDeltaDisabled": params.loadType !== "DELTA"
                },
                "businessName": params.source
              },
              "targetObject": {
                "name": params.target,
                "definition": {
                  "columns": targetColumns
                },
                "metadata": {
                  "isNew": false
                }
              }
            }
          ],
          "replicationTaskSetting": {
            "hasSkipMappingCapability": true
          },
          "replicationFlowSetting": {},
          "deltaLoadTrigger": "ON_DELTA_INTERVAL"
        },
        "sources": {
          [params.source]: {
            "elements": sourceElements
          }
        },
        "targets": {},
        "connections": {
          [params.targetConnection || params.sourceConnection]: {}
        }
      }
    }
  };

  console.log("\n📝 Replication Flow Definition:");
  console.log(JSON.stringify(flowDefinition, null, 2));
  console.log();

  // Save to temp file
  const tempDir = process.env.TEMP || process.env.TMP || "/tmp";
  const tempFile = `${tempDir}/replication-flow-${params.name}.json`;
  await fs.writeFile(tempFile, JSON.stringify(flowDefinition, null, 2));
  console.log(`💾 Saved definition to: ${tempFile}\n`);

  // Create replication flow
  try {
    const result = await commands["objects replication-flows create"]({
      "--host": HOST,
      "--space": params.space,
      "--file-path": tempFile,
    });

    console.log("✅ Replication Flow created successfully!");
    console.log(JSON.stringify(result, null, 2));
    console.log();

    // Verify
    const readResult = await commands["objects replication-flows read"]({
      "--host": HOST,
      "--space": params.space,
      "--technical-name": params.name,
    });

    console.log("✅ Verified - Replication Flow details:");
    console.log(JSON.stringify(readResult, null, 2));

    console.log("\n💡 To run the replication flow, use the Datasphere UI or appropriate CLI command.");

    return readResult;
  } catch (error) {
    console.error("❌ Failed to create replication flow:", error.message);

    if (error.response && error.response.data) {
      console.error("\n📋 Error details:");
      console.error(JSON.stringify(error.response.data, null, 2));
    }

    console.error("\n💡 Troubleshooting tips:");
    console.error("   1. Verify source object exists in the space");
    console.error("   2. Verify target connection exists and is accessible");
    console.error("   3. Ensure target table structure matches source");
    console.error("   4. Check if you have permissions to create replication flows");

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
    console.log("\nUsage:");
    console.log("  node create-replication-flow.js \\");
    console.log("    --name RF_NAME \\");
    console.log("    --source SOURCE_TABLE_OR_VIEW \\");
    console.log("    --target TARGET_TABLE \\");
    console.log("    [--target-connection CONNECTION_ID] \\");
    console.log("    [--load-type INITIAL|DELTA] \\");
    console.log("    [--truncate] \\");
    console.log("    [--space SPACE_ID]");
    process.exit(1);
  }

  if (!params.source) {
    console.error("❌ Error: --source parameter is required");
    process.exit(1);
  }

  if (!params.target) {
    console.error("❌ Error: --target parameter is required");
    process.exit(1);
  }

  await createReplicationFlow(params);
}

// Run main if this is the entry point
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/"))) {
  main().catch((error) => {
    console.error("Fatal error:", error);
    process.exit(1);
  });
}

export { createReplicationFlow, parseArgs, authenticate };
