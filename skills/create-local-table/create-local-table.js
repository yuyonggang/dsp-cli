/**
 * Skill Implementation: create-local-table
 * Creates a Local Table in SAP Datasphere
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
    space: "SAP_SCT",
    label: null,
    columns: null,
    dimension: false,
  };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--name" && args[i + 1]) {
      params.name = args[i + 1];
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
    } else if (args[i] === "--dimension") {
      params.dimension = true;
    }
  }

  return params;
}

/**
 * Parse column definitions
 * Format: COLUMN_NAME:type:length:modifiers
 * Example: ID:cds.String:10:key:required
 */
function parseColumns(columnsStr) {
  if (!columnsStr) {
    // Default columns
    return {
      "ID": {
        "@EndUserText.label": "ID",
        "type": "cds.String",
        "length": 10,
        "key": true,
        "notNull": true
      },
      "NAME": {
        "@EndUserText.label": "Name",
        "type": "cds.String",
        "length": 100,
        "notNull": true
      },
      "DESCRIPTION": {
        "@EndUserText.label": "Description",
        "type": "cds.String",
        "length": 255
      },
      "AMOUNT": {
        "@EndUserText.label": "Amount",
        "type": "cds.Decimal",
        "precision": 15,
        "scale": 2
      },
      "CREATED_DATE": {
        "@EndUserText.label": "Created Date",
        "type": "cds.Date",
        "notNull": true
      }
    };
  }

  const elements = {};
  const columnDefs = columnsStr.split(",");

  columnDefs.forEach((colDef) => {
    const parts = colDef.trim().split(":");
    const name = parts[0];
    let type = parts[1] || "cds.String";

    // Add cds. prefix if not present
    if (type && !type.startsWith("cds.")) {
      type = `cds.${type}`;
    }

    const param1 = parts[2] ? parseInt(parts[2]) : undefined;
    const param2 = parts[3] ? parseInt(parts[3]) : undefined;
    const hasKey = parts.includes("key");
    const hasRequired = parts.includes("required");

    const element = {
      "@EndUserText.label": name.replace(/_/g, " "),
      "type": type,
    };

    // For Decimal type: precision and scale
    if (type === "cds.Decimal") {
      if (param1) element.precision = param1;
      if (param2) element.scale = param2;
    } else {
      // For String and other types: length
      if (param1) element.length = param1;
      if (param2) element.precision = param2; // For legacy compatibility
    }

    if (hasKey) element.key = true;
    if (hasRequired || hasKey) element.notNull = true;

    elements[name] = element;
  });

  return elements;
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
 * Create local table
 */
async function createLocalTable(params) {
  console.log(`🚀 Creating Local Table: ${params.name} in space ${params.space}\n`);

  // Authenticate
  const commands = await authenticate();

  // Parse columns
  const elements = parseColumns(params.columns);

  // Generate table definition
  const tableDefinition = {
    "definitions": {
      [params.name]: {
        "kind": "entity",
        "elements": elements,
        "@EndUserText.label": params.label || params.name
      }
    }
  };

  // Add dimension annotations if --dimension flag is set
  if (params.dimension) {
    tableDefinition.definitions[params.name]["@ObjectModel.supportedCapabilities"] = [
      { "#": "ANALYTICAL_DIMENSION" }
    ];
    tableDefinition.definitions[params.name]["@ObjectModel.modelingPattern"] = {
      "#": "ANALYTICAL_DIMENSION"
    };

    // Mark key columns as dimensions
    Object.keys(elements).forEach(colName => {
      if (elements[colName].key) {
        elements[colName]["@Analytics.dimension"] = true;
      }
    });
  }

  console.log("📝 Table Definition:");
  console.log(JSON.stringify(tableDefinition, null, 2));
  console.log();

  // Save to temp file
  const tempDir = process.env.TEMP || process.env.TMP || "/tmp";
  const tempFile = `${tempDir}/table-${params.name}.json`;
  await fs.writeFile(tempFile, JSON.stringify(tableDefinition, null, 2));

  // Create table
  try {
    const result = await commands["objects local-tables create"]({
      "--host": HOST,
      "--space": params.space,
      "--file-path": tempFile,
    });

    console.log("✅ Table created successfully!");
    console.log(JSON.stringify(result, null, 2));
    console.log();

    // Verify
    const readResult = await commands["objects local-tables read"]({
      "--host": HOST,
      "--space": params.space,
      "--technical-name": params.name,
    });

    console.log("✅ Verified - Table details:");
    console.log(JSON.stringify(readResult, null, 2));

    return readResult;
  } catch (error) {
    console.error("❌ Failed to create table:", error.message);

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
    console.log("\nUsage: node create-local-table.js --name TABLE_NAME [--space SPACE_ID] [--label LABEL] [--columns COLUMN_DEFS] [--dimension]");
    console.log("\nOptions:");
    console.log("  --name          Table name (required)");
    console.log("  --space         Space ID (default: SAP_SCT)");
    console.log("  --label         User-friendly label");
    console.log("  --columns       Column definitions: NAME:TYPE:LENGTH[:key]");
    console.log("  --dimension     Mark as analytical dimension table");
    console.log("\nExamples:");
    console.log("  # Create regular table (for fact data):");
    console.log("  node create-local-table.js --name ORDERS --columns ORDER_ID:String:10:key,CUSTOMER_ID:String:10,AMOUNT:Decimal:15:2");
    console.log("\n  # Create dimension table:");
    console.log("  node create-local-table.js --name DIM_CUSTOMER --columns ID:String:10:key,NAME:String:100 --dimension");
    process.exit(1);
  }

  await createLocalTable(params);
}

// Run main if this is the entry point
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/"))) {
  main().catch((error) => {
    console.error("Fatal error:", error);
    process.exit(1);
  });
}

export { createLocalTable, parseColumns, authenticate };
