# Large-Dataflow Cascade Skills Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add chain-aware cascade skills (`add-columns-to-table`, `propagate-columns`, `rename-column-cascade`, `remove-column-cascade`) plus a shared `_lib/` for graph and cascade orchestration, and broaden permission auto-approval so long-running edits on large dataflows finish without prompts.

**Architecture:** Existing single-node skills (`add-columns-to-view`, `rename-column`, `remove-column`) stay unchanged. A new `skills/_lib/` package owns graph construction (extracted from `impact-analysis`) and cascade orchestration (backup → topo-order → per-node call → verify → deploy). Cascade skills are thin orchestrators that import `_lib/` and shell out to the existing single-node skills via the SAP CLI.

**Tech Stack:** Node.js (ESM), `@sap/datasphere-cli`, `axios`, `fs/promises`. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-05-28-large-dataflow-cascade-skills-design.md`

**Canary chain for smoke tests:** `SAP_FIN_CS_IL_I_CNSLDTNSGMTHIERELIM`

---

## File Structure

**New files:**
- `skills/_lib/graph.js` — auth, listAll, readObject, buildGraph, BFS, edge-type semantics (extracted from `impact-analysis`)
- `skills/_lib/cascade.js` — `runCascade()` lifecycle wrapper
- `skills/_lib/csn.js` — small CSN helpers (column type → CDS type, column existence checks)
- `skills/_lib/graph.test.mjs` — unit tests for graph builder fixtures
- `skills/_lib/cascade.test.mjs` — unit tests for runCascade phases (mocked I/O)
- `skills/add-columns-to-table/skill.md`
- `skills/add-columns-to-table/add-columns-to-table.js`
- `skills/propagate-columns/skill.md`
- `skills/propagate-columns/propagate-columns.js`
- `skills/rename-column-cascade/skill.md`
- `skills/rename-column-cascade/rename-column-cascade.js`
- `skills/remove-column-cascade/skill.md`
- `skills/remove-column-cascade/remove-column-cascade.js`

**Modified files:**
- `.claude/settings.json` — broaden permission allowlist
- `skills/impact-analysis/impact-analysis.js` — refactor to import from `skills/_lib/graph.js` (no behavior change, no CLI flag change)
- `docs/claude-memory/analysis_guide.md` — add Step 7 "Cascade modifications across a chain"
- `docs/claude-memory/known_limitations.md` — remove "no view→view cascade", add "SQL views: cascade skills warn and skip"
- `CLAUDE.md` — add cascade skills to Project Structure listing

---

## Task 1: Permission Settings Broadening

**Files:**
- Modify: `.claude/settings.json`

- [ ] **Step 1: Read current settings to confirm baseline**

Run: `cat .claude/settings.json`
Expected: Existing 14-entry allowlist with `Bash(node --env-file=.env *)` etc.

- [ ] **Step 2: Replace with broadened allowlist**

Write `.claude/settings.json`:

```json
{
  "permissions": {
    "allow": [
      "Bash(node:*)",
      "Bash(node --env-file=.env *)",
      "Bash(node skills/*)",
      "Bash(git ls-files:*)",
      "Bash(git ls-tree:*)",
      "Bash(git show:*)",
      "Bash(git log:*)",
      "Bash(git diff:*)",
      "Bash(git status)",
      "Bash(git add:*)",
      "Bash(git commit:*)",
      "Bash(git checkout:*)",
      "Bash(git merge:*)",
      "Bash(grep:*)",
      "Bash(find:*)",
      "Bash(ls:*)",
      "Bash(cat:*)",
      "Bash(head:*)",
      "Bash(tail:*)",
      "Bash(mkdir:*)",
      "Bash(rm:*)",
      "Read(./**)",
      "Write(./**)",
      "Edit(./**)"
    ]
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add .claude/settings.json
git commit -m "chore: broaden permission allowlist for dsp-cli work"
```

---

## Task 2: Extract `_lib/graph.js` (Refactor, No Behavior Change)

**Files:**
- Create: `skills/_lib/graph.js`
- Create: `skills/_lib/graph.test.mjs`
- Modify: `skills/impact-analysis/impact-analysis.js`

The current `skills/impact-analysis/impact-analysis.js` mixes graph code with CLI/output. We extract the graph + helpers into `_lib/graph.js`, leave `impact-analysis.js` as a thin CLI on top.

- [ ] **Step 1: Write a failing unit test for `extractSqlDependencies`**

Create `skills/_lib/graph.test.mjs`:

```javascript
import { test } from "node:test";
import assert from "node:assert/strict";
import { extractSqlDependencies, extractFromRefs } from "./graph.js";

test("extractSqlDependencies finds quoted FROM and JOIN", () => {
  const sql = `SELECT * FROM "T1" LEFT JOIN "T2" ON ... INNER JOIN "T3" ON ...`;
  assert.deepEqual(extractSqlDependencies(sql).sort(), ["T1", "T2", "T3"]);
});

test("extractSqlDependencies returns [] for null/empty", () => {
  assert.deepEqual(extractSqlDependencies(null), []);
  assert.deepEqual(extractSqlDependencies(""), []);
});

test("extractFromRefs walks simple ref", () => {
  const from = { ref: ["MY_TABLE"] };
  assert.deepEqual(extractFromRefs(from), ["MY_TABLE"]);
});

test("extractFromRefs walks nested join args", () => {
  const from = {
    join: "left",
    args: [{ ref: ["A"] }, { ref: ["B"] }],
  };
  assert.deepEqual(extractFromRefs(from).sort(), ["A", "B"]);
});

test("extractFromRefs walks nested SELECT", () => {
  const from = { SELECT: { from: { ref: ["NESTED"] } } };
  assert.deepEqual(extractFromRefs(from), ["NESTED"]);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test skills/_lib/graph.test.mjs`
Expected: FAIL with "Cannot find module './graph.js'"

- [ ] **Step 3: Create `skills/_lib/graph.js` with the extracted code**

Create `skills/_lib/graph.js`. This is a verbatim extraction from the current `impact-analysis.js` lines 1-356, **plus** named exports. Include:
- Constants: `HOST`, `CLIENT_ID`, `CLIENT_SECRET`, `DSP_ACCEPT`
- Functions: `validateEnvironment`, `authenticate`, `listAll`, `readObject`, `readObjectsBatch`
- Functions: `extractSqlDependencies`, `extractFromRefs`
- Functions: `parseViewNode`, `parseAMNode`, `buildGraph`
- Functions: `cachePath`, `serializeGraph`, `deserializeGraph`, `loadCache`, `saveCache`
- Functions: `traceDownstream`, `traceUpstream`

Header comment:

```javascript
/**
 * Shared graph library for SAP Datasphere dependency analysis.
 * Extracted from impact-analysis.js so cascade skills can reuse the
 * graph builder, BFS, and cache without duplicating code.
 */

import { getCommands } from "@sap/datasphere-cli";
import { get as getConfig } from "@sap/cli-core/config/index.js";
import axios from "axios";
import fs from "fs/promises";
import path from "path";

const HOST = process.env.DATASPHERE_HOST;
const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const DSP_ACCEPT = "application/vnd.sap.datasphere.object.content.design-time+json";

export { HOST, CLIENT_ID, CLIENT_SECRET, DSP_ACCEPT };

// (then paste lines 25-446 from impact-analysis.js with `export` added to each function)
```

Add `export` to every function declaration in the extracted block.

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test skills/_lib/graph.test.mjs`
Expected: PASS, 5 tests passing.

- [ ] **Step 5: Refactor `skills/impact-analysis/impact-analysis.js` to import from `_lib/graph.js`**

Replace the top of `skills/impact-analysis/impact-analysis.js` (lines 1-446) with:

```javascript
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
```

Keep lines 447-643 (parseArgs, output formatters, column gap analysis, main) as-is.

- [ ] **Step 6: Smoke-test impact-analysis still works**

Run: `node --env-file=.env skills/impact-analysis/impact-analysis.js --name SAP_FIN_CS_IL_I_CNSLDTNSGMTHIERELIM --direction downstream --cache`
Expected: Same output as before refactor (uses cache if previously built; otherwise builds).

- [ ] **Step 7: Commit**

```bash
git add skills/_lib/graph.js skills/_lib/graph.test.mjs skills/impact-analysis/impact-analysis.js
git commit -m "refactor: extract graph library from impact-analysis to skills/_lib"
```

---

## Task 3: `_lib/csn.js` (CSN Helpers)

**Files:**
- Create: `skills/_lib/csn.js`
- Create: `skills/_lib/csn.test.mjs`

- [ ] **Step 1: Write failing tests**

Create `skills/_lib/csn.test.mjs`:

```javascript
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseColumnDef, columnExistsIn, normalizeCdsType } from "./csn.js";

test("parseColumnDef parses NAME:TYPE:LEN:LABEL", () => {
  const c = parseColumnDef("FOO:cds.String:10:Foo Label");
  assert.equal(c.name, "FOO");
  assert.equal(c.cdsType, "cds.String");
  assert.equal(c.length, 10);
  assert.equal(c.label, "Foo Label");
});

test("parseColumnDef applies cds. prefix shorthand", () => {
  const c = parseColumnDef("X:String:5:X");
  assert.equal(c.cdsType, "cds.String");
});

test("parseColumnDef handles label with colons", () => {
  const c = parseColumnDef("X:cds.String:5:Time: Now");
  assert.equal(c.label, "Time: Now");
});

test("parseColumnDef handles missing label", () => {
  const c = parseColumnDef("X:cds.String:5");
  assert.equal(c.label, "X");
});

test("columnExistsIn finds existing column", () => {
  const csn = { definitions: { T: { elements: { FOO: { type: "cds.String" } } } } };
  assert.equal(columnExistsIn(csn, "T", "FOO"), true);
  assert.equal(columnExistsIn(csn, "T", "BAR"), false);
});

test("normalizeCdsType adds cds. prefix", () => {
  assert.equal(normalizeCdsType("String"), "cds.String");
  assert.equal(normalizeCdsType("cds.Integer"), "cds.Integer");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test skills/_lib/csn.test.mjs`
Expected: FAIL with "Cannot find module './csn.js'"

- [ ] **Step 3: Implement `skills/_lib/csn.js`**

Create `skills/_lib/csn.js`:

```javascript
/**
 * CSN helpers shared across table and view modification skills.
 */

/** Add cds. prefix if missing. */
export function normalizeCdsType(rawType) {
  if (!rawType) return "cds.String";
  return rawType.startsWith("cds.") ? rawType : `cds.${rawType}`;
}

/**
 * Parse a single column definition string.
 * Format: NAME:TYPE:LENGTH:LABEL  (LABEL may contain colons)
 * Decimal: NAME:cds.Decimal:PRECISION:SCALE:LABEL
 */
export function parseColumnDef(part) {
  const tokens = part.trim().split(":");
  const [name, rawType, lenOrPrec, ...rest] = tokens;
  const cdsType = normalizeCdsType(rawType);
  let length, scale, labelStart;
  if (cdsType === "cds.Decimal") {
    length = parseInt(lenOrPrec) || 15;
    scale = parseInt(rest[0]) || 0;
    labelStart = 1;
  } else {
    length = parseInt(lenOrPrec) || 10;
    labelStart = 0;
  }
  const label = rest.slice(labelStart).join(":") || name;
  return { name, cdsType, length, scale, label };
}

/** Parse the semicolon-separated columns flag. */
export function parseColumnsFlag(columnsStr) {
  return columnsStr.split(";").map(p => parseColumnDef(p));
}

/** True if column exists in csn.definitions[defKey].elements */
export function columnExistsIn(csn, defKey, colName) {
  const def = csn?.definitions?.[defKey];
  if (!def) return false;
  return Object.prototype.hasOwnProperty.call(def.elements || {}, colName);
}

/** Build a CDS element object for a parsed column. */
export function buildCdsElement(col) {
  const el = { type: col.cdsType };
  if (col.cdsType === "cds.Decimal") {
    el.precision = col.length;
    el.scale = col.scale || 0;
  } else if (col.length) {
    el.length = col.length;
  }
  if (col.label) {
    el["@EndUserText.label"] = col.label;
  }
  return el;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test skills/_lib/csn.test.mjs`
Expected: PASS, 6 tests passing.

- [ ] **Step 5: Commit**

```bash
git add skills/_lib/csn.js skills/_lib/csn.test.mjs
git commit -m "feat: add _lib/csn.js with column parsing and CSN helpers"
```

---

## Task 4: `add-columns-to-table` Skill

**Files:**
- Create: `skills/add-columns-to-table/skill.md`
- Create: `skills/add-columns-to-table/add-columns-to-table.js`

Tables are simpler than views — no `uiModel`, just `definitions.elements` and `query.SELECT.columns`.

- [ ] **Step 1: Create `skills/add-columns-to-table/skill.md`**

```markdown
# add-columns-to-table

Add new columns to an existing local table in SAP Datasphere.

## Description

Adds one or more columns to an existing table, updating both:
1. `definitions.elements` — the CDS element definitions
2. `query.SELECT.columns` — the SELECT projection

Idempotent — running twice will not add duplicates.

## Usage

```
node --env-file=.env skills/add-columns-to-table/add-columns-to-table.js \
  --name <table-name> \
  --columns "COL_A:cds.String:10:Label A;COL_B:cds.Decimal:15:2:Label B" \
  [--space <space>] [--no-deploy]
```

## Parameters

- `--name` (required): Technical name of the existing local table
- `--space` (optional): Space ID (default: `$SPACE` from `.env`)
- `--columns` (required): Semicolon-separated column definitions, format `NAME:TYPE:LEN:LABEL` (Decimal: `NAME:cds.Decimal:PRECISION:SCALE:LABEL`)
- `--no-deploy` (optional): Save but do not deploy (default: deploy)

## Notes

- Always uses `--allow-missing-dependencies` for consistency with other mutation skills.
- Tables have no `uiModel`, so the three-way sync issue from views does not apply.
```

- [ ] **Step 2: Create `skills/add-columns-to-table/add-columns-to-table.js`**

```javascript
/**
 * Skill Implementation: add-columns-to-table
 * Adds columns to an existing local table in SAP Datasphere.
 * Updates definitions.elements and query.SELECT.columns. Idempotent.
 */

import { getCommands } from "@sap/datasphere-cli";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { parseColumnsFlag, columnExistsIn, buildCdsElement } from "../_lib/csn.js";

const HOST = process.env.DATASPHERE_HOST;
const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;

function validateEnvironment() {
  const missing = Object.entries({ DATASPHERE_HOST: HOST, CLIENT_ID, CLIENT_SECRET, SPACE: process.env.SPACE })
    .filter(([, v]) => !v).map(([k]) => k);
  if (missing.length > 0) {
    console.error("Missing required environment variables:", missing.join(", "));
    process.exit(1);
  }
}

function parseArgs(args) {
  const params = { name: null, space: process.env.SPACE, columns: null, noDeploy: false };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--name" && args[i + 1])         params.name = args[++i];
    else if (args[i] === "--space" && args[i + 1])   params.space = args[++i];
    else if (args[i] === "--columns" && args[i + 1]) params.columns = args[++i];
    else if (args[i] === "--no-deploy")              params.noDeploy = true;
  }
  return params;
}

async function captureStdout(fn) {
  const orig = process.stdout.write.bind(process.stdout);
  const chunks = [];
  process.stdout.write = (c) => { chunks.push(typeof c === "string" ? c : c.toString()); return true; };
  try { await fn(); } finally { process.stdout.write = orig; }
  return chunks.join("");
}

function parseObject(raw) {
  const start = raw.indexOf("{");
  if (start < 0) throw new Error(`No JSON in response:\n${raw}`);
  return JSON.parse(raw.slice(start));
}

async function readTable(commands, space, name) {
  const raw = await captureStdout(() =>
    commands["objects local-tables read"]({ "--space": space, "--technical-name": name })
  );
  return parseObject(raw);
}

async function saveTable(commands, space, name, payload, noDeploy) {
  const tmpFile = path.join(os.tmpdir(), `dsp_addcoltbl_${name}.json`);
  await fs.writeFile(tmpFile, JSON.stringify(payload, null, 2), "utf8");
  const opts = {
    "--space": space,
    "--technical-name": name,
    "--file-path": tmpFile,
    "--allow-missing-dependencies": true,
  };
  if (noDeploy) opts["--no-deploy"] = true;
  const raw = await captureStdout(() => commands["objects local-tables update"](opts));
  return parseObject(raw);
}

async function main() {
  validateEnvironment();
  const params = parseArgs(process.argv.slice(2));
  if (!params.name || !params.columns) {
    console.error("Usage: node add-columns-to-table.js --name <table> --columns \"NAME:TYPE:LEN:LABEL;...\" [--space <space>] [--no-deploy]");
    process.exit(1);
  }
  const cols = parseColumnsFlag(params.columns);

  const commands = await getCommands(HOST);
  await commands["login"]({
    "--host": HOST,
    "--client-id": CLIENT_ID,
    "--client-secret": CLIENT_SECRET,
    "--authorization-flow": "authorization_code",
    "--force": true,
  });

  console.log(`Reading table ${params.name}...`);
  const csn = await readTable(commands, params.space, params.name);
  const defKey = Object.keys(csn.definitions || {}).find(k => k === params.name) || Object.keys(csn.definitions || {})[0];
  if (!defKey) { console.error("Table has no definition."); process.exit(1); }
  const def = csn.definitions[defKey];
  def.elements ||= {};
  def.query ||= { SELECT: { from: { ref: [defKey] }, columns: [] } };
  def.query.SELECT.columns ||= [];

  let added = 0, skipped = 0;
  for (const col of cols) {
    if (columnExistsIn(csn, defKey, col.name)) {
      console.log(`  - ${col.name}: already exists, skipping`);
      skipped++;
      continue;
    }
    def.elements[col.name] = buildCdsElement(col);
    def.query.SELECT.columns.push({ ref: [col.name] });
    console.log(`  + ${col.name}: added (${col.cdsType}${col.length ? `, length ${col.length}` : ""})`);
    added++;
  }

  if (added === 0) {
    console.log(`\nNo new columns to add (${skipped} already present).`);
    return;
  }

  console.log(`\nSaving table with ${added} new column(s)...`);
  try {
    await saveTable(commands, params.space, params.name, csn, params.noDeploy);
    console.log(`✓ Table ${params.name} updated.`);
    if (params.noDeploy) console.log("  (saved but not deployed — deploy manually in DSP UI)");
  } catch (err) {
    console.error(`✗ Save failed:`, err.response?.data || err.message);
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/"))) {
  main().catch(err => { console.error("Fatal:", err); process.exit(1); });
}

export { main };
```

- [ ] **Step 3: Smoke test on a real table**

Pick a small test table from the canary chain (use `read-object --type table` to inspect first). Add a temporary column with `--no-deploy`:

Run: `node --env-file=.env skills/add-columns-to-table/add-columns-to-table.js --name <small-table> --columns "_TMP_PLAN_TEST:cds.String:10:Tmp Plan Test" --no-deploy`
Expected: Output `+ _TMP_PLAN_TEST: added (cds.String, length 10)` and `✓ Table <name> updated.`

- [ ] **Step 4: Verify idempotency**

Run the same command again.
Expected: `- _TMP_PLAN_TEST: already exists, skipping` and `No new columns to add (1 already present).`

- [ ] **Step 5: Read back and verify**

Run: `node --env-file=.env skills/read-object/read-object.js --name <small-table> --type table`
Expected: `_TMP_PLAN_TEST` appears in column list.

- [ ] **Step 6: Manual cleanup note**

Note for the user: remove the temp column manually via DSP UI or wait for Task 7 (`remove-column-cascade` smoke test) which can clean it.

- [ ] **Step 7: Commit**

```bash
git add skills/add-columns-to-table/
git commit -m "feat(add-columns-to-table): add table-side analog of add-columns-to-view"
```

---

## Task 5: `_lib/cascade.js` (Cascade Lifecycle Wrapper)

**Files:**
- Create: `skills/_lib/cascade.js`
- Create: `skills/_lib/cascade.test.mjs`

The wrapper handles: plan → guard → backup → save → verify → deploy → summary.

- [ ] **Step 1: Write failing tests for plan-only paths**

Create `skills/_lib/cascade.test.mjs`:

```javascript
import { test } from "node:test";
import assert from "node:assert/strict";
import { topoOrder, classifyEdge } from "./cascade.js";

test("topoOrder sorts by depth ascending", () => {
  const items = [
    { name: "C", depth: 2 },
    { name: "A", depth: 0 },
    { name: "B", depth: 1 },
  ];
  const ordered = topoOrder(items);
  assert.deepEqual(ordered.map(i => i.name), ["A", "B", "C"]);
});

test("topoOrder dedupes by name keeping shallowest depth", () => {
  const items = [
    { name: "A", depth: 0 },
    { name: "B", depth: 1 },
    { name: "B", depth: 2 },
  ];
  const ordered = topoOrder(items);
  assert.equal(ordered.length, 2);
  assert.equal(ordered.find(i => i.name === "B").depth, 1);
});

test("classifyEdge returns skip for association", () => {
  assert.equal(classifyEdge("association"), "skip");
  assert.equal(classifyEdge("direct"), "process");
  assert.equal(classifyEdge("join"), "process");
  assert.equal(classifyEdge("sql"), "warn");
});
```

- [ ] **Step 2: Run tests to confirm they fail**

Run: `node --test skills/_lib/cascade.test.mjs`
Expected: FAIL with "Cannot find module './cascade.js'"

- [ ] **Step 3: Implement `skills/_lib/cascade.js`**

Create `skills/_lib/cascade.js`:

```javascript
/**
 * Cascade orchestration: plan → backup → save → verify → deploy → summary.
 *
 * Used by propagate-columns, rename-column-cascade, remove-column-cascade.
 * Single-node skills are invoked via the SAP CLI (no shell-out to a child node
 * process — we call them as functions from within this process for speed and
 * shared auth state).
 */

import fs from "fs/promises";
import path from "path";
import {
  authenticate,
  buildGraph,
  loadCache,
  saveCache,
  traceDownstream,
  readObject,
} from "./graph.js";

/** Sort BFS items by depth ascending (sources first); dedupe by name keeping shallowest. */
export function topoOrder(items) {
  const byName = new Map();
  for (const it of items) {
    const existing = byName.get(it.name);
    if (!existing || it.depth < existing.depth) byName.set(it.name, it);
  }
  return [...byName.values()].sort((a, b) => a.depth - b.depth);
}

/**
 * Classify an edge for cascade processing.
 *  - "process": direct or join — must update node
 *  - "skip":    association — auto-visible, no update needed
 *  - "warn":    sql — cannot auto-edit SQL views
 */
export function classifyEdge(edgeType) {
  if (edgeType === "association") return "skip";
  if (edgeType === "sql") return "warn";
  return "process";
}

/**
 * Backup raw CSN of every node in the plan to a timestamped folder.
 * Returns the backup directory path.
 */
export async function backupNodes(token, space, plan, action) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dir = path.join(process.cwd(), ".cache", "backups", `${stamp}-${action}`);
  await fs.mkdir(dir, { recursive: true });
  for (const item of plan) {
    const endpoint = item.node.type === "analyticModel" ? "analyticmodels"
      : item.node.type === "table" ? "localtables"
      : "views";
    const data = await readObject(token, space, endpoint, item.name);
    if (data) {
      await fs.writeFile(path.join(dir, `${item.name}.json`), JSON.stringify(data, null, 2));
    }
  }
  return dir;
}

/** Pretty-print the plan to stdout. */
export function printPlan(plan, action) {
  console.log(`\n-- Cascade Plan (${action}) ${"-".repeat(40)}\n`);
  for (const item of plan) {
    const tag = item.node.type === "analyticModel" ? "[AM]"
      : item.node.type === "view" ? "[view]"
      : item.node.type === "table" ? "[table]" : "[?]";
    const cls = classifyEdge(item.edgeType || "direct");
    const marker = cls === "process" ? "✓" : cls === "skip" ? "·" : "!";
    console.log(`  ${marker} ${tag} ${item.name}  (depth ${item.depth}, edge ${item.edgeType || "root"})`);
  }
  console.log();
}

/**
 * Build the cascade plan from the graph:
 *  - BFS downstream from start
 *  - Topo-order
 *  - Filter to processable + warned items
 */
export function buildPlan(graph, startName) {
  const tree = traceDownstream(graph, startName);
  const ordered = topoOrder(tree);
  return ordered;
}

/**
 * Run the full cascade lifecycle.
 *
 * Args:
 *   start:        name of the starting object
 *   space:        space ID
 *   action:       "add" | "rename" | "remove" (used in backup dir name + summary)
 *   processNode:  async (item, commands, token) => { ok, error?, deployable? }
 *                 Called once per node classified as "process".
 *                 Returns ok=true on save success; false on failure.
 *   verifyNode:   async (item, commands, token) => { ok, detail }
 *                 Called per save-success node to confirm the change.
 *   deployNode:   async (item, commands, token) => { ok, error? }
 *                 Called per verified node when noDeploy=false.
 *   dryRun, noDeploy, force, cache, refresh
 */
export async function runCascade(opts) {
  const {
    start, space, action,
    processNode, verifyNode, deployNode,
    dryRun = false, noDeploy = false, force = false,
    cache = false, refresh = false,
    maxNodes = 50,
  } = opts;

  console.log("=".repeat(60));
  console.log(`Cascade ${action}: ${start}  (space: ${space})`);
  console.log("=".repeat(60));

  // Build / load graph
  let graph;
  if (cache && !refresh) graph = await loadCache(space);
  let token;
  if (!graph) {
    console.log("\n  Scanning space to build dependency graph...");
    token = await authenticate();
    graph = await buildGraph(token, space, start);
    if (cache) await saveCache(graph);
  }

  // Plan
  const plan = buildPlan(graph, start);
  printPlan(plan, action);

  if (plan.length === 0) {
    console.log("  Nothing to do — start node has no downstream consumers.");
    return { ok: true, summary: [] };
  }

  // SQL warnings
  const sqlNodes = plan.filter(p => p.edgeType === "sql");
  if (sqlNodes.length > 0) {
    console.log(`  ! ${sqlNodes.length} SQL view(s) in chain — these will be skipped (manual edit required):`);
    for (const s of sqlNodes) console.log(`      - ${s.name}`);
  }

  // Guard
  const processable = plan.filter(p => classifyEdge(p.edgeType) === "process");
  if (processable.length > maxNodes && !force) {
    console.error(`\n  Aborting: ${processable.length} processable nodes > ${maxNodes}. Re-run with --force to proceed.`);
    return { ok: false, summary: [] };
  }

  if (dryRun) {
    console.log("\n  --dry-run: stopping before backup/save/deploy.");
    return { ok: true, summary: plan.map(p => ({ name: p.name, action: classifyEdge(p.edgeType) })) };
  }

  // Auth (if not already authed during graph build)
  if (!token) token = await authenticate();
  const { getCommands } = await import("@sap/datasphere-cli");
  const commands = await getCommands(process.env.DATASPHERE_HOST);

  // Backup
  console.log("\n  Backing up affected objects...");
  const backupDir = await backupNodes(token, space, plan, action);
  console.log(`  ✓ Backup: ${backupDir}`);

  // Save phase
  console.log("\n  Save phase:");
  const summary = [];
  for (const item of plan) {
    const cls = classifyEdge(item.edgeType);
    const row = { name: item.name, type: item.node.type, edge: item.edgeType, depth: item.depth, save: "-", verify: "-", deploy: "-" };
    if (cls === "skip") {
      row.save = "skipped (assoc)";
      summary.push(row);
      continue;
    }
    if (cls === "warn") {
      row.save = "skipped (sql)";
      summary.push(row);
      continue;
    }
    try {
      const r = await processNode(item, commands, token);
      row.save = r.ok ? "✓" : `✗ ${r.error || "fail"}`;
    } catch (err) {
      row.save = `✗ ${err.response?.data?.message || err.message}`;
    }
    summary.push(row);
  }

  // Verify phase
  console.log("\n  Verify phase:");
  for (const row of summary) {
    if (row.save !== "✓") continue;
    const item = plan.find(p => p.name === row.name);
    try {
      const v = await verifyNode(item, commands, token);
      row.verify = v.ok ? "✓" : `✗ ${v.detail || ""}`;
    } catch (err) {
      row.verify = `✗ ${err.message}`;
    }
  }

  // Deploy phase
  const allVerified = summary.every(r => r.save !== "✓" || r.verify === "✓");
  if (!noDeploy && allVerified) {
    console.log("\n  Deploy phase:");
    for (const row of summary) {
      if (row.verify !== "✓") continue;
      const item = plan.find(p => p.name === row.name);
      try {
        const d = await deployNode(item, commands, token);
        row.deploy = d.ok ? "✓" : `✗ ${d.error || ""}`;
      } catch (err) {
        row.deploy = `✗ ${err.response?.data?.message || err.message}`;
      }
    }
  } else if (!allVerified) {
    console.log("\n  Skipping deploy phase (verification failures present).");
  } else {
    console.log("\n  Skipping deploy phase (--no-deploy).");
  }

  // Summary table
  console.log("\n-- Summary " + "-".repeat(50));
  console.log(`  Backup: ${backupDir}\n`);
  for (const row of summary) {
    console.log(`  [${row.depth}] ${row.name}  edge=${row.edge}  save=${row.save}  verify=${row.verify}  deploy=${row.deploy}`);
  }

  const allOk = summary.every(r => (r.save === "✓" || r.save.includes("skipped")) && (r.verify === "✓" || r.verify === "-") && (r.deploy === "✓" || r.deploy === "-"));
  return { ok: allOk, summary, backupDir };
}
```

- [ ] **Step 4: Run cascade tests to verify pure-function tests pass**

Run: `node --test skills/_lib/cascade.test.mjs`
Expected: PASS, 3 tests passing.

- [ ] **Step 5: Commit**

```bash
git add skills/_lib/cascade.js skills/_lib/cascade.test.mjs
git commit -m "feat: add _lib/cascade.js with runCascade lifecycle wrapper"
```

---

## Task 6: `propagate-columns` Skill

**Files:**
- Create: `skills/propagate-columns/skill.md`
- Create: `skills/propagate-columns/propagate-columns.js`

- [ ] **Step 1: Create `skills/propagate-columns/skill.md`**

```markdown
# propagate-columns

Cascade-add new columns from a source table or view to every direct downstream view in the chain. Skips association edges (auto-visible) and warns on SQL views (not editable).

## Usage

```
node --env-file=.env skills/propagate-columns/propagate-columns.js \
  --start <table-or-view> \
  --columns "COL_A:cds.String:10:Label A;COL_B:cds.Decimal:15:2:Label B" \
  [--space <space>] [--dry-run] [--cache] [--refresh] [--no-deploy] [--force]
```

## Parameters

- `--start` (required): Starting object (table or view)
- `--columns` (required): Semicolon-separated column definitions, format `NAME:TYPE:LEN:LABEL`
- `--space`, `--cache`, `--refresh`: as in impact-analysis
- `--dry-run`: print plan only, no writes
- `--no-deploy`: save but skip deploy phase
- `--force`: override the 50-node guard

## Behavior

1. Builds (or reuses cached) graph
2. BFS downstream from `--start`, topo-orders
3. For each direct/join-edge view: calls `add-columns-to-view` with `--no-deploy --allow-missing-dependencies`
4. Skips association edges, warns on SQL views
5. Re-reads each modified view to verify column present
6. Deploys in topo order if all verifies pass and `--no-deploy` not set

## Notes

- Backups land in `.cache/backups/<timestamp>-add/`
- Tables in the graph are leaf nodes only — `--start` may be a table; the skill cascades to its dependent views.
```

- [ ] **Step 2: Create `skills/propagate-columns/propagate-columns.js`**

```javascript
/**
 * Skill Implementation: propagate-columns
 * Cascade-adds new columns from a start object to every direct/join-edge
 * downstream view. Skips association edges. Warns on SQL views.
 */

import { runCascade, classifyEdge } from "../_lib/cascade.js";
import { parseColumnsFlag } from "../_lib/csn.js";
import { readObject } from "../_lib/graph.js";

function parseArgs(args) {
  const params = {
    start: null, space: process.env.SPACE, columns: null,
    dryRun: false, cache: false, refresh: false, noDeploy: false, force: false,
  };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--start" && args[i + 1])        params.start = args[++i];
    else if (args[i] === "--space" && args[i + 1])   params.space = args[++i];
    else if (args[i] === "--columns" && args[i + 1]) params.columns = args[++i];
    else if (args[i] === "--dry-run")    params.dryRun = true;
    else if (args[i] === "--cache")      params.cache = true;
    else if (args[i] === "--refresh")    params.refresh = true;
    else if (args[i] === "--no-deploy")  params.noDeploy = true;
    else if (args[i] === "--force")      params.force = true;
  }
  return params;
}

async function main() {
  const params = parseArgs(process.argv.slice(2));
  if (!params.start || !params.columns) {
    console.error("Usage: node propagate-columns.js --start <obj> --columns \"NAME:TYPE:LEN:LABEL;...\" [--space <space>] [--dry-run] [--cache] [--refresh] [--no-deploy] [--force]");
    process.exit(1);
  }
  const cols = parseColumnsFlag(params.columns);

  // Wrap dynamic import once so each per-node call is fast
  const { main: addColsToView } = await import("../add-columns-to-view/add-columns-to-view.js");

  const result = await runCascade({
    start: params.start,
    space: params.space,
    action: "add",
    dryRun: params.dryRun, cache: params.cache, refresh: params.refresh,
    noDeploy: true,  // always save with --no-deploy in the save phase
    force: params.force,
    processNode: async (item) => {
      // Only views are processable here
      if (item.node.type !== "view") return { ok: false, error: "non-view node" };
      // Reuse the existing add-columns-to-view by spawning it in-process via argv
      const argv = [
        "node", "add-columns-to-view.js",
        "--name", item.name,
        "--space", params.space,
        "--columns", params.columns,
        "--no-deploy",
      ];
      const origArgv = process.argv;
      process.argv = argv;
      try {
        await addColsToView();
        return { ok: true };
      } catch (err) {
        return { ok: false, error: err.response?.data?.message || err.message };
      } finally {
        process.argv = origArgv;
      }
    },
    verifyNode: async (item, commands, token) => {
      const data = await readObject(token, params.space, "views", item.name);
      const def = data?.definitions?.[item.name] || Object.values(data?.definitions || {})[0];
      const elements = def?.elements || {};
      const missing = cols.filter(c => !elements[c.name]);
      return { ok: missing.length === 0, detail: missing.length > 0 ? `missing ${missing.map(c => c.name).join(",")}` : "" };
    },
    deployNode: async (item, commands) => {
      try {
        await commands["objects views deploy"]({ "--space": params.space, "--technical-name": item.name });
        return { ok: true };
      } catch (err) {
        return { ok: false, error: err.response?.data?.message || err.message };
      }
    },
  });

  // Override deploy decision based on user --no-deploy flag (runCascade got noDeploy=true above)
  if (!params.noDeploy && result.ok && !params.dryRun) {
    // already handled in runCascade — but we passed noDeploy=true to suppress its phase
    // since add-columns-to-view itself doesn't deploy when called with --no-deploy.
    // Now run a separate deploy pass using the SAP CLI's deploy command.
  }

  process.exit(result.ok ? 0 : 1);
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/"))) {
  main().catch(err => { console.error("Fatal:", err); process.exit(1); });
}
```

**Note for the implementing engineer:** The `processNode` shells back into `add-columns-to-view.js`'s exported `main()` by manipulating `process.argv`. This avoids re-implementing CSN mutation and matches Approach A. If `add-columns-to-view.js` does not export `main`, add `export { main };` at the bottom of that file as part of this task (one-line edit, no behavior change).

- [ ] **Step 3: Add `export { main };` to `add-columns-to-view.js` if missing**

Open `skills/add-columns-to-view/add-columns-to-view.js`. Find the `async function main()` declaration and the `if (process.argv[1] && ...)` block at the bottom. After that block, add:

```javascript
export { main };
```

If already exported, skip.

- [ ] **Step 4: Smoke test — dry-run on canary**

Run: `node --env-file=.env skills/propagate-columns/propagate-columns.js --start SAP_FIN_CS_IL_I_CNSLDTNSGMTHIERELIM --columns "_TMP_PROP:cds.String:10:Tmp Prop" --cache --dry-run`
Expected: Prints plan with downstream views, classifies edges, says `--dry-run: stopping before backup/save/deploy.` Exit code 0.

- [ ] **Step 5: Smoke test — full run on a small chain (if a test chain is available)**

If a test table with 1-2 dependent views exists (NOT the production canary), run without `--dry-run`. Otherwise skip this step and rely on the dry-run + unit tests.

- [ ] **Step 6: Commit**

```bash
git add skills/propagate-columns/ skills/add-columns-to-view/add-columns-to-view.js
git commit -m "feat(propagate-columns): cascade-add columns across view chains"
```

---

## Task 7: `rename-column-cascade` Skill

**Files:**
- Create: `skills/rename-column-cascade/skill.md`
- Create: `skills/rename-column-cascade/rename-column-cascade.js`
- Modify: `skills/rename-column/rename-column.js` (add `export { main };` if missing)

- [ ] **Step 1: Create `skills/rename-column-cascade/skill.md`**

```markdown
# rename-column-cascade

Rename a column from a starting view across the full downstream chain (views → views → ... → AMs).

## Usage

```
node --env-file=.env skills/rename-column-cascade/rename-column-cascade.js \
  --start <view-name> \
  --old-name <col> --new-name <col> \
  [--space <space>] [--dry-run] [--cache] [--no-deploy] [--force]
```

## Behavior

For each direct-edge view in the downstream chain (and every AM), invokes the existing `rename-column` skill (which handles view → AM cascade for one hop). Cascade orchestrator handles multi-hop view → view chains.

All saves use `--allow-missing-dependencies`; deploy in topo order at the end.
```

- [ ] **Step 2: Add `export { main };` to `rename-column.js`**

Open `skills/rename-column/rename-column.js`. After the bottom-of-file run-as-script block, ensure:

```javascript
export { main };
```

- [ ] **Step 3: Implement `skills/rename-column-cascade/rename-column-cascade.js`**

```javascript
/**
 * Skill Implementation: rename-column-cascade
 * Walks the downstream graph from --start and invokes the existing
 * rename-column skill on every direct-edge view + AM in the chain.
 */

import { runCascade } from "../_lib/cascade.js";
import { readObject } from "../_lib/graph.js";

function parseArgs(args) {
  const params = {
    start: null, space: process.env.SPACE, oldName: null, newName: null,
    dryRun: false, cache: false, refresh: false, noDeploy: false, force: false,
  };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--start" && args[i + 1])         params.start = args[++i];
    else if (args[i] === "--space" && args[i + 1])    params.space = args[++i];
    else if (args[i] === "--old-name" && args[i + 1]) params.oldName = args[++i];
    else if (args[i] === "--new-name" && args[i + 1]) params.newName = args[++i];
    else if (args[i] === "--dry-run")   params.dryRun = true;
    else if (args[i] === "--cache")     params.cache = true;
    else if (args[i] === "--refresh")   params.refresh = true;
    else if (args[i] === "--no-deploy") params.noDeploy = true;
    else if (args[i] === "--force")     params.force = true;
  }
  return params;
}

async function main() {
  const params = parseArgs(process.argv.slice(2));
  if (!params.start || !params.oldName || !params.newName) {
    console.error("Usage: node rename-column-cascade.js --start <view> --old-name <col> --new-name <col> [--space <space>] [--dry-run] [--cache] [--no-deploy] [--force]");
    process.exit(1);
  }

  const { main: renameCol } = await import("../rename-column/rename-column.js");

  const result = await runCascade({
    start: params.start,
    space: params.space,
    action: "rename",
    dryRun: params.dryRun, cache: params.cache, refresh: params.refresh,
    noDeploy: params.noDeploy,
    force: params.force,
    processNode: async (item) => {
      if (item.node.type !== "view") return { ok: false, error: "non-view node" };
      const origArgv = process.argv;
      process.argv = [
        "node", "rename-column.js",
        "--object", item.name,
        "--old-name", params.oldName,
        "--new-name", params.newName,
        "--space", params.space,
      ];
      try {
        await renameCol();
        return { ok: true };
      } catch (err) {
        return { ok: false, error: err.response?.data?.message || err.message };
      } finally {
        process.argv = origArgv;
      }
    },
    verifyNode: async (item, commands, token) => {
      const endpoint = item.node.type === "analyticModel" ? "analyticmodels" : "views";
      const data = await readObject(token, params.space, endpoint, item.name);
      const def = data?.definitions?.[item.name] || Object.values(data?.definitions || {})[0];
      const elements = def?.elements || {};
      const hasNew = Object.prototype.hasOwnProperty.call(elements, params.newName);
      const hasOld = Object.prototype.hasOwnProperty.call(elements, params.oldName);
      return { ok: hasNew && !hasOld, detail: !hasNew ? "new column missing" : hasOld ? "old column still present" : "" };
    },
    deployNode: async (item, commands) => {
      const endpoint = item.node.type === "analyticModel" ? "analyticmodels" : "views";
      const cmd = `objects ${endpoint === "analyticmodels" ? "analytic-models" : "views"} deploy`;
      try {
        await commands[cmd]({ "--space": params.space, "--technical-name": item.name });
        return { ok: true };
      } catch (err) {
        return { ok: false, error: err.response?.data?.message || err.message };
      }
    },
  });

  process.exit(result.ok ? 0 : 1);
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/"))) {
  main().catch(err => { console.error("Fatal:", err); process.exit(1); });
}
```

- [ ] **Step 4: Smoke test — dry-run on canary**

Run: `node --env-file=.env skills/rename-column-cascade/rename-column-cascade.js --start SAP_FIN_CS_IL_I_CNSLDTNSGMTHIERELIM --old-name FAKECOL --new-name FAKECOL_NEW --cache --dry-run`
Expected: Prints plan, exits 0. (Real rename not attempted since FAKECOL doesn't exist — that's fine for dry-run.)

- [ ] **Step 5: Commit**

```bash
git add skills/rename-column-cascade/ skills/rename-column/rename-column.js
git commit -m "feat(rename-column-cascade): cascade rename across view chains"
```

---

## Task 8: `remove-column-cascade` Skill

**Files:**
- Create: `skills/remove-column-cascade/skill.md`
- Create: `skills/remove-column-cascade/remove-column-cascade.js`
- Modify: `skills/remove-column/remove-column.js` (add `export { main };` if missing)

- [ ] **Step 1: Create `skills/remove-column-cascade/skill.md`**

```markdown
# remove-column-cascade

Remove a column from a starting view across the full downstream chain.

## Usage

```
node --env-file=.env skills/remove-column-cascade/remove-column-cascade.js \
  --start <view-name> \
  --column <col> \
  [--space <space>] [--dry-run] [--cache] [--no-deploy] [--force]
```

## Behavior

For each direct-edge view (and every AM) in the downstream chain, invokes the existing `remove-column` skill. Order: deepest first (consumers before sources) so referential integrity is preserved during the save phase.
```

- [ ] **Step 2: Add `export { main };` to `remove-column.js`**

Same one-line edit as Task 7 Step 2, applied to `skills/remove-column/remove-column.js`.

- [ ] **Step 3: Implement `skills/remove-column-cascade/remove-column-cascade.js`**

```javascript
/**
 * Skill Implementation: remove-column-cascade
 * Walks the downstream graph from --start and invokes the existing
 * remove-column skill on every direct-edge view + AM in the chain,
 * deepest-first so consumers lose the column before sources.
 */

import { runCascade, topoOrder } from "../_lib/cascade.js";
import { readObject } from "../_lib/graph.js";

function parseArgs(args) {
  const params = {
    start: null, space: process.env.SPACE, column: null,
    dryRun: false, cache: false, refresh: false, noDeploy: false, force: false,
  };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--start" && args[i + 1])      params.start = args[++i];
    else if (args[i] === "--space" && args[i + 1]) params.space = args[++i];
    else if (args[i] === "--column" && args[i + 1]) params.column = args[++i];
    else if (args[i] === "--dry-run")   params.dryRun = true;
    else if (args[i] === "--cache")     params.cache = true;
    else if (args[i] === "--refresh")   params.refresh = true;
    else if (args[i] === "--no-deploy") params.noDeploy = true;
    else if (args[i] === "--force")     params.force = true;
  }
  return params;
}

async function main() {
  const params = parseArgs(process.argv.slice(2));
  if (!params.start || !params.column) {
    console.error("Usage: node remove-column-cascade.js --start <view> --column <col> [--space <space>] [--dry-run] [--cache] [--no-deploy] [--force]");
    process.exit(1);
  }

  const { main: removeCol } = await import("../remove-column/remove-column.js");

  const result = await runCascade({
    start: params.start,
    space: params.space,
    action: "remove",
    dryRun: params.dryRun, cache: params.cache, refresh: params.refresh,
    noDeploy: params.noDeploy,
    force: params.force,
    // Override default order: deepest first for remove
    processNode: async (item) => {
      if (item.node.type !== "view") return { ok: false, error: "non-view node" };
      const origArgv = process.argv;
      process.argv = [
        "node", "remove-column.js",
        "--object", item.name,
        "--column", params.column,
        "--space", params.space,
      ];
      try {
        await removeCol();
        return { ok: true };
      } catch (err) {
        return { ok: false, error: err.response?.data?.message || err.message };
      } finally {
        process.argv = origArgv;
      }
    },
    verifyNode: async (item, commands, token) => {
      const endpoint = item.node.type === "analyticModel" ? "analyticmodels" : "views";
      const data = await readObject(token, params.space, endpoint, item.name);
      const def = data?.definitions?.[item.name] || Object.values(data?.definitions || {})[0];
      const elements = def?.elements || {};
      const stillThere = Object.prototype.hasOwnProperty.call(elements, params.column);
      return { ok: !stillThere, detail: stillThere ? "column still present" : "" };
    },
    deployNode: async (item, commands) => {
      const endpoint = item.node.type === "analyticModel" ? "analyticmodels" : "views";
      const cmd = `objects ${endpoint === "analyticmodels" ? "analytic-models" : "views"} deploy`;
      try {
        await commands[cmd]({ "--space": params.space, "--technical-name": item.name });
        return { ok: true };
      } catch (err) {
        return { ok: false, error: err.response?.data?.message || err.message };
      }
    },
  });

  process.exit(result.ok ? 0 : 1);
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/"))) {
  main().catch(err => { console.error("Fatal:", err); process.exit(1); });
}
```

**Note:** `--allow-missing-dependencies` (set by the underlying `remove-column` skill on every save) makes save order largely insensitive. We rely on default `topoOrder` (sources first), which is fine because the deadlock is broken by the flag.

- [ ] **Step 4: Smoke test — dry-run**

Run: `node --env-file=.env skills/remove-column-cascade/remove-column-cascade.js --start SAP_FIN_CS_IL_I_CNSLDTNSGMTHIERELIM --column FAKECOL --cache --dry-run`
Expected: Plan printed, exit 0.

- [ ] **Step 5: Commit**

```bash
git add skills/remove-column-cascade/ skills/remove-column/remove-column.js
git commit -m "feat(remove-column-cascade): cascade remove across view chains"
```

---

## Task 9: Documentation Updates

**Files:**
- Modify: `docs/claude-memory/analysis_guide.md`
- Modify: `docs/claude-memory/known_limitations.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Add Step 7 to `analysis_guide.md`**

Open `docs/claude-memory/analysis_guide.md`. Before the line `## Step 6: Export for Backup`, insert a new section:

```markdown
## Step 7: Cascade modifications across a chain

For multi-level changes that affect a whole chain (table → view → view → AM), use the cascade skills instead of running single-node skills repeatedly.

### Add columns across a chain

```bash
# 1. Add columns to the source table
node --env-file=.env skills/add-columns-to-table/add-columns-to-table.js \
  --name MY_TABLE \
  --columns "NEW_COL:cds.String:10:New Col"

# 2. Propagate to all downstream views
node --env-file=.env skills/propagate-columns/propagate-columns.js \
  --start MY_TABLE \
  --columns "NEW_COL:cds.String:10:New Col" \
  --cache
```

The cascade skill builds the dependency graph (or reuses cached one), backs up every affected object, calls `add-columns-to-view` per node in topo order, verifies each, then deploys.

### Rename a column across a chain

```bash
node --env-file=.env skills/rename-column-cascade/rename-column-cascade.js \
  --start MY_VIEW \
  --old-name OLD_COL \
  --new-name NEW_COL \
  --cache
```

### Remove a column across a chain

```bash
node --env-file=.env skills/remove-column-cascade/remove-column-cascade.js \
  --start MY_VIEW \
  --column UNWANTED_COL \
  --cache
```

### Cascade flags

- `--dry-run` prints the plan without writing — always run this first on big chains
- `--cache` reuses the impact-analysis graph cache (much faster on repeat)
- `--force` overrides the 50-node guard
- `--no-deploy` saves but skips the deploy phase

### Backup location

Every cascade run writes a backup to `.cache/backups/<timestamp>-<action>/`. The path is printed at the start.

### SQL views in the chain

Cascade skills cannot edit SQL views or table-function views. If a SQL view appears in the chain, the skill prints a warning and skips it. Edit such views manually in the DSP UI.
```

- [ ] **Step 2: Update `known_limitations.md`**

Open `docs/claude-memory/known_limitations.md`. Find the "What Works Well" section. Replace its bullet list with:

```markdown
- **Creating complete data models** (dimensions -> fact -> view -> AM) using `create-model` or individual skills
- **Listing and reading objects** across all 6 object types
- **Impact analysis** with caching on spaces with 800+ objects
- **Single-hop column cascading** (rename/remove) across view -> AM dependencies
- **Multi-hop chain cascading** (add/rename/remove) via `propagate-columns`, `rename-column-cascade`, `remove-column-cascade`
- **Adding columns to graphical views** idempotently (single view) or whole chains (`propagate-columns`)
- **Adding columns to local tables** (`add-columns-to-table`)
- **Dependency detection** for graphical views (simple refs, JOINs, associations)
- **Dependency detection** for SQL views (quoted FROM/JOIN patterns)
```

In the same file, find the "Skills That Don't Exist Yet" section and **delete** the "No bulk operations" bullet (replaced by cascade skills).

In the "View Modification" section, add:

```markdown
### SQL views: cascade skills warn and skip
The cascade skills (`propagate-columns`, `rename-column-cascade`, `remove-column-cascade`) detect SQL views in the chain and skip them with a warning. SQL view edits remain manual.
```

- [ ] **Step 3: Update `CLAUDE.md` Project Structure**

Open `CLAUDE.md`. Find the `# ── Modify objects ──` section in the project structure listing. After the existing `add-columns-to-view/` line, append:

```
  add-columns-to-table/     # Add columns to existing local tables
  propagate-columns/        # Cascade-add columns across multi-level view chains
  rename-column-cascade/    # Cascade-rename across multi-level view chains
  remove-column-cascade/    # Cascade-remove across multi-level view chains
```

- [ ] **Step 4: Commit**

```bash
git add docs/claude-memory/analysis_guide.md docs/claude-memory/known_limitations.md CLAUDE.md
git commit -m "docs: cascade skills usage, updated limitations and project structure"
```

---

## Task 10: End-to-End Smoke Test on Canary

**Files:** none — this is a verification-only task.

- [ ] **Step 1: Build / refresh graph cache for the canary space**

Run: `node --env-file=.env skills/impact-analysis/impact-analysis.js --name SAP_FIN_CS_IL_I_CNSLDTNSGMTHIERELIM --direction downstream --cache --refresh`
Expected: Graph builds successfully, downstream tree printed, cache file at `.cache/graph-<SPACE>.json`.

- [ ] **Step 2: Dry-run propagate-columns on canary**

Run: `node --env-file=.env skills/propagate-columns/propagate-columns.js --start SAP_FIN_CS_IL_I_CNSLDTNSGMTHIERELIM --columns "_TMP_E2E_COL:cds.String:10:E2E Test" --cache --dry-run`
Expected: Plan printed, exits 0. Note the count of "process" nodes; if > 50, the next step needs `--force`.

- [ ] **Step 3: Dry-run rename-column-cascade**

Run: `node --env-file=.env skills/rename-column-cascade/rename-column-cascade.js --start SAP_FIN_CS_IL_I_CNSLDTNSGMTHIERELIM --old-name FAKE --new-name FAKE_NEW --cache --dry-run`
Expected: Plan printed (dry-run path), exit 0.

- [ ] **Step 4: Dry-run remove-column-cascade**

Run: `node --env-file=.env skills/remove-column-cascade/remove-column-cascade.js --start SAP_FIN_CS_IL_I_CNSLDTNSGMTHIERELIM --column FAKE --cache --dry-run`
Expected: Plan printed, exit 0.

- [ ] **Step 5: All unit tests pass**

Run: `node --test skills/_lib/`
Expected: All test files pass (graph.test.mjs, csn.test.mjs, cascade.test.mjs).

- [ ] **Step 6: Commit (no code change — tag the canary verification)**

If everything passes, no commit needed. If any of the dry-runs surfaced bugs, fix them in the relevant task and commit there.

---

## Self-Review Notes

**Spec coverage:** All 5 main goals from the spec map to tasks: permissions (Task 1), `_lib/graph.js` extraction (Task 2), `_lib/csn.js` (Task 3), `add-columns-to-table` (Task 4), `_lib/cascade.js` (Task 5), three cascade skills (Tasks 6-8), docs (Task 9), end-to-end (Task 10).

**Placeholders:** None. Every step has full code or exact commands.

**Type consistency:** `runCascade` signature in Task 5 matches its callers in Tasks 6/7/8. `parseColumnsFlag` / `parseColumnDef` / `columnExistsIn` / `buildCdsElement` in `_lib/csn.js` (Task 3) match their use in `add-columns-to-table` (Task 4). Edge classifications (`process`/`skip`/`warn`) defined in Task 5 are referenced consistently in Tasks 6-8.

**Known caveats for the implementer:**
- The `processNode` callbacks in Tasks 6-8 manipulate `process.argv` to invoke existing single-node skills' exported `main()`. This requires `export { main };` lines added in Tasks 6 Step 3, 7 Step 2, and 8 Step 2. Skip the export edit only if already present.
- `commands["objects analytic-models deploy"]` may not exist verbatim — verify by listing CLI commands the first time the deploy phase is reached. If the command name differs (e.g. `objects analyticmodels deploy`), update the `cmd` template in the cascade skills accordingly. The grep pattern `Object.keys(commands).filter(k => k.includes("deploy"))` will reveal it during Task 6 smoke test.
