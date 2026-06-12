/**
 * Skill Implementation: impact-analysis
 * Builds an in-memory dependency graph of all views and analytic models in a
 * space in a single scan, then traverses it to show the full impact chain of
 * any object. Optionally detects missing columns in downstream objects.
 */

import {
  authenticate,
  buildGraph,
  loadCache,
  saveCache,
  traceDownstream,
  traceUpstream,
} from "../_lib/graph.js";

// ─── Environment & Args ───────────────────────────────────────────────────────

function parseArgs(args) {
  const params = {
    name: null,
    space: process.env.SPACE,
    direction: "both",
    columns: [],
    cache: false,
    refresh: false,
  };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--name" && args[i + 1])        { params.name = args[++i]; }
    else if (args[i] === "--space" && args[i + 1])   { params.space = args[++i]; }
    else if (args[i] === "--direction" && args[i + 1]) { params.direction = args[++i]; }
    else if (args[i] === "--columns" && args[i + 1])   { params.columns = args[++i].split(",").map(c => c.trim()).filter(Boolean); }
    else if (args[i] === "--cache")   { params.cache = true; }
    else if (args[i] === "--refresh") { params.refresh = true; }
  }
  return params;
}

// ─── Output Formatting ───────────────────────────────────────────────────────

function typeTag(type) {
  if (type === "analyticModel") return "[AM]";
  if (type === "view") return "[view]";
  if (type === "table") return "[table]";
  return "[?]";
}

function printTree(items, header) {
  console.log(`\n-- ${header} ${"--".repeat(Math.max(1, 30 - header.length / 2))}\n`);

  if (items.length <= 1) {
    console.log("  (no dependencies found)\n");
    return;
  }

  // Build a display tree with proper indentation
  const maxDepth = Math.max(...items.map(i => i.depth));
  let viewCount = 0, amCount = 0;

  for (const item of items) {
    const indent = "  " + "   ".repeat(item.depth);
    const tag = typeTag(item.node.type);
    const label = item.node.label ? `  "${item.node.label}"` : "";
    const edge = item.edgeType ? `  (${item.edgeType})` : "";

    if (item.depth === 0) {
      console.log(`  ${item.name}`);
    } else {
      console.log(`${indent}${tag} ${item.name}${label}${edge}`);
      if (item.node.type === "view") viewCount++;
      if (item.node.type === "analyticModel") amCount++;
    }
  }

  const total = viewCount + amCount;
  console.log(`\n  Summary: ${total} downstream object(s) (${viewCount} view(s), ${amCount} AM(s)), max depth ${maxDepth}\n`);
}

// ─── Column Gap Analysis ──────────────────────────────────────────────────────

function analyzeColumnGaps(graph, downstreamTree, columns) {
  if (columns.length === 0) return;

  console.log(`\n-- Column Propagation: ${columns.join(", ")} ${"--".repeat(10)}\n`);

  const actionPlan = [];

  for (const item of downstreamTree) {
    const node = item.node;
    const nodeColumns = node.columns || {};
    const indent = "  " + "   ".repeat(item.depth);

    if (item.depth === 0) {
      console.log(`  ${item.name}`);
    } else {
      console.log(`${indent}${typeTag(node.type)} ${item.name}`);
    }

    const missingCols = [];
    for (const col of columns) {
      const pad = "  " + "   ".repeat(item.depth) + "   ";
      if (nodeColumns[col]) {
        const t = nodeColumns[col].type;
        const len = nodeColumns[col].length ? `(${nodeColumns[col].length})` : "";
        console.log(`${pad}${col}: EXISTS (${t}${len})`);
      } else if (item.edgeType === "association") {
        console.log(`${pad}${col}: (association only - auto-visible via navigation)`);
      } else {
        // Find the parent to give context on blocking
        const parent = item.parentName;
        const parentNode = graph.nodes.get(parent);
        const parentHas = parentNode?.columns?.[col];

        if (node.type === "analyticModel") {
          const inAttrs = (node.attributes || []).includes(col);
          const inMeasures = (node.measures || []).includes(col);
          if (!inAttrs && !inMeasures) {
            if (parentHas) {
              console.log(`${pad}${col}: MISSING - add as attribute after source has it`);
            } else {
              console.log(`${pad}${col}: MISSING - blocked until ${parent} has it`);
            }
            missingCols.push(col);
          }
        } else {
          if (parentHas) {
            console.log(`${pad}${col}: MISSING - add to view`);
          } else {
            console.log(`${pad}${col}: MISSING - blocked until ${parent} has it`);
          }
          missingCols.push(col);
        }
      }
    }

    if (missingCols.length > 0 && item.edgeType !== "association") {
      const action = node.type === "analyticModel"
        ? `add ${missingCols.length} attribute(s): ${missingCols.join(", ")}`
        : `add ${missingCols.length} column(s): ${missingCols.join(", ")}`;
      actionPlan.push({ name: item.name, type: node.type, action, depth: item.depth });
    }
  }

  // Print action plan
  if (actionPlan.length > 0) {
    console.log(`\n-- Action Plan ${"--".repeat(25)}\n`);
    // Sort by depth (closest to source first = update order)
    actionPlan.sort((a, b) => a.depth - b.depth);
    actionPlan.forEach((a, i) => {
      const tag = typeTag(a.type);
      console.log(`  ${i + 1}. ${tag} ${a.name} - ${a.action}`);
    });
    console.log();
  } else {
    console.log("\n  All downstream objects already have the specified columns.\n");
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function impactAnalysis(params) {
  const { name, space, direction, columns, cache, refresh } = params;

  console.log("=".repeat(55));
  console.log(`Impact Analysis: ${name}  (space: ${space})`);
  console.log("=".repeat(55));
  console.log();

  // Build or load graph
  let graph;
  if (cache && !refresh) {
    graph = await loadCache(space);
  }

  if (!graph) {
    console.log("  Scanning space to build dependency graph...");
    const token = await authenticate();
    graph = await buildGraph(token, space, name);
    if (cache) await saveCache(graph);
  }

  // Check start node exists in graph
  if (!graph.nodes.has(name)) {
    // Try reading the start object as a table if not in graph
    console.log(`  Note: ${name} not found in scanned views/AMs.`);
    console.log(`  It may be a table referenced by views but not itself a view.\n`);

    // Check if anything references it
    if (!graph.downstream.has(name)) {
      console.log(`  No objects reference ${name} in space ${space}.`);
      return;
    }
  }

  // Downstream traversal
  if (direction === "both" || direction === "downstream") {
    const downTree = traceDownstream(graph, name);
    printTree(downTree, `Downstream (consumers of ${name})`);

    // Column gap analysis on downstream tree
    if (columns.length > 0) {
      analyzeColumnGaps(graph, downTree, columns);
    }
  }

  // Upstream traversal
  if (direction === "both" || direction === "upstream") {
    const upTree = traceUpstream(graph, name);
    printTree(upTree, `Upstream (sources of ${name})`);
  }
}

async function main() {
  const params = parseArgs(process.argv.slice(2));

  if (!params.name) {
    console.error("Error: --name is required");
    console.error("Usage: node impact-analysis.js --name <object-name> [--space <space>] [--direction both|downstream|upstream] [--columns col1,col2] [--cache] [--refresh]");
    process.exit(1);
  }

  if (!["both", "downstream", "upstream"].includes(params.direction)) {
    console.error(`Error: --direction must be one of: both, downstream, upstream (got: ${params.direction})`);
    process.exit(1);
  }

  await impactAnalysis(params);
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/"))) {
  main().catch(err => { console.error("Fatal error:", err); process.exit(1); });
}

export { impactAnalysis };
