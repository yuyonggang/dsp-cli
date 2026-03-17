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
 * Create view
 */
async function createView(params) {
  console.log(`🚀 Creating View: ${params.name} from ${params.source} in space ${params.space}\n`);

  // Authenticate
  const commands = await authenticate();

  // Get source structure
  console.log(`📋 Reading source structure: ${params.source}`);
  const sourceElements = await getSourceStructure(commands, params.space, params.source);

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
    // Use all columns from source
    viewElements = { ...sourceElements };
    columnsToSelect = Object.keys(sourceElements);
  }

  // Build SELECT query
  const selectQuery = {
    SELECT: {
      from: {
        ref: [params.source]
      },
      columns: columnsToSelect.map(col => ({ ref: [col] }))
    }
  };

  // Add WHERE clause if provided
  if (params.where) {
    selectQuery.SELECT.where = [params.where];
  }

  // Generate view definition
  const viewDefinition = {
    "definitions": {
      [params.name]: {
        "kind": "entity",
        "elements": viewElements,
        "query": selectQuery,
        "@EndUserText.label": params.label || params.name
      }
    }
  };

  console.log("📝 View Definition:");
  console.log(JSON.stringify(viewDefinition, null, 2));
  console.log();

  // Save to temp file
  const tempFile = `/tmp/view-${params.name}.json`;
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
    console.log("\nUsage: node create-view.js --name VIEW_NAME --source SOURCE_TABLE [--space SPACE_ID] [--label LABEL] [--columns COLUMN_LIST] [--where CONDITION]");
    process.exit(1);
  }

  if (!params.source) {
    console.error("❌ Error: --source parameter is required");
    console.log("\nUsage: node create-view.js --name VIEW_NAME --source SOURCE_TABLE [--space SPACE_ID] [--label LABEL] [--columns COLUMN_LIST] [--where CONDITION]");
    process.exit(1);
  }

  await createView(params);
}

if (import.meta.url === `file://${process.argv[1].replace(/\\/g, "/")}`) {
  main().catch((error) => {
    console.error("Fatal error:", error);
    process.exit(1);
  });
}

export { createView, parseArgs, authenticate, getSourceStructure };
