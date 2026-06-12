/**
 * Skill Implementation: list-objects
 * Lists existing objects of a given type in a Datasphere space.
 * Uses direct REST API calls for reliable results with full pagination.
 */

import { getCommands } from "@sap/datasphere-cli";
import { get as getConfig } from "@sap/cli-core/config/index.js";
import axios from "axios";

const HOST = process.env.DATASPHERE_HOST;
const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;

const TYPES = ["table", "view", "analytic-model", "data-flow", "replication-flow", "transformation-flow"];

function validateEnvironment() {
  const missing = Object.entries({ DATASPHERE_HOST: HOST, CLIENT_ID, CLIENT_SECRET, SPACE: process.env.SPACE })
    .filter(([, v]) => !v).map(([k]) => k);
  if (missing.length > 0) {
    console.error("Missing required environment variables:", missing.join(", "));
    if (missing.includes("SPACE")) console.error("  → Set SPACE=<your-space-id> in .env");
    process.exit(1);
  }
}

function parseArgs(args) {
  const params = { type: "all", space: process.env.SPACE };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--type" && args[i + 1])  { params.type = args[++i]; }
    else if (args[i] === "--space" && args[i + 1]) { params.space = args[++i]; }
  }
  return params;
}

// ─── REST API helpers ──────────────────────────────────────────────────────────

const API_ENDPOINTS = {
  "table":               "localtables",
  "view":                "views",
  "analytic-model":      "analyticmodels",
  "data-flow":           "dataflows",
  "replication-flow":    "replicationflows",
  "transformation-flow": "transformationflows",
};

const TYPE_LABELS = {
  "table":               "Local Tables",
  "view":                "Views",
  "analytic-model":      "Analytic Models",
  "data-flow":           "Data Flows",
  "replication-flow":    "Replication Flows",
  "transformation-flow": "Transformation Flows",
};

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
  return getConfig().authorization?.authorization;
}

async function listType(token, space, type) {
  const endpoint = API_ENDPOINTS[type];
  if (!endpoint) return [];
  const items = [];
  let skip = 0;
  const top = 25;
  try {
    while (true) {
      const r = await axios.get(
        `${HOST}/dwaas-core/api/v1/spaces/${space}/${endpoint}?top=${top}&skip=${skip}`,
        { headers: { Authorization: token } }
      );
      const page = Array.isArray(r.data) ? r.data : Object.values(r.data || {});
      items.push(...page);
      if (page.length < top) break;
      skip += top;
      if (skip > 10000) break; // safety limit
    }
  } catch (err) {
    console.error(`  Warning: could not list ${type}: ${err.response?.data?.message || err.message}`);
  }
  return items;
}

function formatTable(items) {
  if (items.length === 0) { console.log("  (none)\n"); return; }
  const colW = 40;
  console.log(`  ${"Technical Name".padEnd(colW)}  Label`);
  console.log("  " + "-".repeat(colW) + "  " + "-".repeat(40));
  for (const item of items) {
    const name  = (item.technicalName || item.name || "?").padEnd(colW);
    const label = item.label || item.businessName || "";
    console.log(`  ${name}  ${label}`);
  }
  console.log();
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function listObjects(params) {
  const token = await authenticate();
  const typesToList = params.type === "all" ? TYPES : [params.type];

  console.log(`\nObjects in space: ${params.space}\n`);

  const summary = {};
  for (const type of typesToList) {
    console.log(`── ${TYPE_LABELS[type] || type} ──`);
    const items = await listType(token, params.space, type);
    summary[type] = items.length;
    formatTable(items);
  }

  console.log("Summary:");
  for (const [type, count] of Object.entries(summary)) {
    console.log(`  ${(TYPE_LABELS[type] || type).padEnd(25)}  ${count}`);
  }
}

async function main() {
  const params = parseArgs(process.argv.slice(2));

  if (params.type !== "all" && !TYPES.includes(params.type)) {
    console.error(`Unknown type: ${params.type}`);
    console.error(`Valid types: ${TYPES.join(", ")}, all`);
    process.exit(1);
  }

  await listObjects(params);
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/"))) {
  main().catch(err => { console.error("Fatal error:", err); process.exit(1); });
}

export { listObjects };
