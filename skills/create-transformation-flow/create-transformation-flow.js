/**
 * Skill Implementation: create-transformation-flow
 * Creates a Transformation Flow in SAP Datasphere
 *
 * Note: This is a simplified implementation based on SAP Datasphere patterns.
 * Transformation flows typically involve SQL-based transformations.
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
    target: null,
    space: "SAP_SCT",
    label: null,
    sql: null,
    sqlFile: null,
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
    } else if (args[i] === "--sql" && args[i + 1]) {
      params.sql = args[i + 1];
      i++;
    } else if (args[i] === "--sql-file" && args[i + 1]) {
      params.sqlFile = args[i + 1];
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

  await commands["config cache init"]({ "--host": HOST });

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
 * Create transformation flow
 */
async function createTransformationFlow(params) {
  console.log(`🚀 Creating Transformation Flow: ${params.name} in space ${params.space}\n`);
  console.log(`   Source: ${params.source}`);
  console.log(`   Target: ${params.target}`);
  console.log();

  // Authenticate
  const commands = await authenticate();

  // Get source structure
  console.log(`📋 Reading source structure: ${params.source}`);
  const sourceElements = await getSourceStructure(commands, params.space, params.source);

  // Determine SQL transformation
  let transformationSQL = params.sql;

  if (params.sqlFile) {
    console.log(`📄 Reading SQL from file: ${params.sqlFile}`);
    transformationSQL = await fs.readFile(params.sqlFile, 'utf-8');
  }

  if (!transformationSQL) {
    // Default: SELECT all columns from source
    const columns = Object.keys(sourceElements)
      .filter(col => sourceElements[col].type !== "cds.Association")
      .join(", ");
    transformationSQL = `SELECT ${columns} FROM ${params.source}`;
    console.log(`ℹ️  No transformation specified, using: ${transformationSQL}`);
  }

  // Build elements for target (same as source for simplicity)
  const targetElements = {};
  Object.keys(sourceElements).forEach(colName => {
    if (sourceElements[colName].type !== "cds.Association") {
      targetElements[colName] = sourceElements[colName];
    }
  });

  // Generate transformation flow definition
  // Note: Transformation flows are similar to views but may have additional processing logic
  const flowDefinition = {
    "definitions": {
      [params.name]: {
        "kind": "entity",
        "@EndUserText.label": params.label || params.name,
        "elements": targetElements,
        "query": {
          "SELECT": {
            "from": {
              "ref": [params.source]
            }
          }
        },
        "@DataWarehouse.transformation": {
          "sql": transformationSQL,
          "target": params.target
        }
      }
    }
  };

  console.log("\n📝 Transformation Flow Definition:");
  console.log(JSON.stringify(flowDefinition, null, 2));
  console.log();

  console.log("⚠️  Note: Transformation Flow structure may need adjustment based on your");
  console.log("   Datasphere version. If creation fails, please check the Datasphere");
  console.log("   documentation or create a sample flow in the UI and export it to");
  console.log("   learn the correct format.");
  console.log();

  // Save to temp file
  const tempDir = process.env.TEMP || process.env.TMP || "/tmp";
  const tempFile = `${tempDir}/transformation-flow-${params.name}.json`;
  await fs.writeFile(tempFile, JSON.stringify(flowDefinition, null, 2));

  // Create transformation flow
  try {
    const result = await commands["objects transformation-flows create"]({
      "--host": HOST,
      "--space": params.space,
      "--file-path": tempFile,
    });

    console.log("✅ Transformation Flow created successfully!");
    console.log(JSON.stringify(result, null, 2));
    console.log();

    // Verify
    const readResult = await commands["objects transformation-flows read"]({
      "--host": HOST,
      "--space": params.space,
      "--technical-name": params.name,
    });

    console.log("✅ Verified - Transformation Flow details:");
    console.log(JSON.stringify(readResult, null, 2));

    console.log("\n💡 To run the transformation flow, use the Datasphere UI or appropriate CLI command.");

    return readResult;
  } catch (error) {
    console.error("❌ Failed to create transformation flow:", error.message);

    if (error.response && error.response.data) {
      console.error("\n📋 Error details:");
      console.error(JSON.stringify(error.response.data, null, 2));
    }

    console.error("\n💡 Troubleshooting tips:");
    console.error("   1. Verify source exists and is accessible");
    console.error("   2. Check SQL syntax is valid SAP HANA SQL");
    console.error("   3. Ensure you have permissions to create transformation flows");
    console.error("   4. Try creating a sample flow in the UI and exporting it");
    console.error("      to learn the exact format required");

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
    console.log("\nUsage: node create-transformation-flow.js --name FLOW_NAME --source SOURCE --target TARGET [OPTIONS]");
    process.exit(1);
  }

  if (!params.source) {
    console.error("❌ Error: --source parameter is required");
    console.log("\nUsage: node create-transformation-flow.js --name FLOW_NAME --source SOURCE --target TARGET [OPTIONS]");
    process.exit(1);
  }

  if (!params.target) {
    console.error("❌ Error: --target parameter is required");
    console.log("\nUsage: node create-transformation-flow.js --name FLOW_NAME --source SOURCE --target TARGET [OPTIONS]");
    process.exit(1);
  }

  await createTransformationFlow(params);
}

// Run main if this is the entry point
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/"))) {
  main().catch((error) => {
    console.error("Fatal error:", error);
    process.exit(1);
  });
}

export { createTransformationFlow, parseArgs, authenticate, getSourceStructure };
