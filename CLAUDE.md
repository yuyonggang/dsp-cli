# DSP CLI — Claude Code Context

This project creates SAP Datasphere objects (tables, views, analytic models, flows) using natural language via Claude Code skills and the official `@sap/datasphere-cli`.

## Project Structure

```
skills/
  # ── Create objects ──────────────────────────────────────────
  create-local-table/       # Local tables (fact or dimension)
  create-view/              # Graphical views with associations
  create-analytic-model/    # Analytic models with measures
  create-model/             # Full model orchestrator (dims → fact → view → AM in one command)
  add-columns-to-view/      # Add columns to existing graphical views
  create-data-flow/
  create-replication-flow/
  create-transformation-flow/

  # ── Inspect objects ─────────────────────────────────────────
  list-objects/             # List all objects of a type in a space
  read-object/              # Read and pretty-print any object's definition
  describe-model/           # Traverse full model chain (AM → view → fact → dims)
  impact-analysis/          # Full recursive dependency graph + column gap analysis (single scan, cached)

  # ── Modify objects ──────────────────────────────────────────
  add-columns-to-view/      # Add columns to existing graphical views
  add-columns-to-table/     # Add columns to existing local tables
  propagate-columns/        # Cascade-add columns across multi-level view chains
  rename-column-cascade/    # Cascade-rename across multi-level view chains
  remove-column-cascade/    # Cascade-remove across multi-level view chains
  rename-column/            # Rename a column in a view + cascade to analytic models
  remove-column/            # Remove a column from a view + cascade to analytic models

  # ── Lifecycle ───────────────────────────────────────────────
  export-model/             # Export full model chain to local JSON files

docs/claude-memory/         # Best practices and proven workflows
```

Each skill has a `skill.md` defining its interface and a `.js` implementation.

## Environment Setup

Credentials are read from `.env` (never commit this file):
```
DATASPHERE_HOST=https://your-tenant.datasphere.cloud.sap
CLIENT_ID=your_client_id
CLIENT_SECRET=your_client_secret
SPACE=YOUR_SPACE_ID
```

`SPACE` is the default space ID used by all skills when `--space` is not provided. Define it once here; never hardcode it in skill invocations.

## Naming Conventions

Use a **numeric series suffix** (001, 002, ...) for all objects in a batch to avoid naming conflicts:
- `DIM_CUSTOMER_001`, `DIM_PRODUCT_001` — dimension tables
- `SALES_FACT_001` — fact table
- `SALES_VW_001` — view
- `AM_SALES_001` — analytic model

All objects in one model creation use the **same series number**.

## Creation Order

Always follow this sequence when building a complete data model:
1. Dimension tables (`--dimension` flag)
2. Fact table
3. View with dimension associations (`--dimensions` parameter)
4. Analytic model from the view (auto-detects dimensions)

## Key Technical Notes

- Skills generate artifacts in **CSN (Core Schema Notation)** JSON format
- For graphical views: generate `DimensionNode`, `Association`, `ElementMapping` — but do **NOT** generate `EntitySymbol` or `AssociationSymbol` (Datasphere auto-generates these; partial symbols cause display issues)
- `--dimensions` parameter uses semicolons to separate multiple associations: `"FK:DIM_TABLE:JOIN_KEY;FK2:DIM2:KEY2"`
- Analytic model auto-detects dimensions when the source view already has associations defined
- **SQL/table-function views** store their dependencies as raw SQL — the field varies by view type: `@DataWarehouse.tableFunction.script` (table functions), `@DataWarehouse.sqlDefinition.script` (some SQL definition views), or `@DataWarehouse.sqlEditor.query` (standard SQL views). `impact-analysis` checks all three fields and parses `FROM "X"` / `JOIN "X"` patterns to detect dependencies that CSN metadata alone would miss.
- **Graphical views with JOINs** have a nested `from` clause (`{join: "left", args: [...]}` with sub-SELECTs) instead of a simple `{ref: [...]}`. Both skills recursively walk the `from` tree to extract all source refs.

## Modifying Existing Graphical Views

**Always use the `add-columns-to-view` skill** when adding columns to an existing view. Never write ad-hoc scripts for this.

Graphical views have three locations that must all be updated consistently:
1. `definitions.elements` — CDS element type definitions
2. `query.SELECT.columns` — the SELECT projection
3. `editorSettings.uiModel` — the visual graph model (JSON string) with three node types:
   - `sap.cdw.querybuilder.Entity` — source table snapshot
   - `sap.cdw.querybuilder.RenameElements` — projection node (may not exist in all views)
   - `sap.cdw.querybuilder.Output` — output node

**Critical**: If `uiModel` is not updated in sync with `definitions` and `query`, DSP converts the view from Graphical mode to SQL mode.

**Idempotency**: Each node (src, prj, out) must be checked independently before adding. Checking only the output node and skipping source/projection is wrong — those nodes may already contain stale entries from a prior failed attempt.

## Adding Columns + Cascading to Dependent Views

This is a common operational task. Do not treat it as a feature design exercise — execute directly.

**Check object type first**: `add-columns-to-table` only works on local tables. `add-columns-to-view` only works on graphical views. To disambiguate: a local table has `"kind":"entity"` and no `editorSettings.uiModel`; a graphical view has `editorSettings.uiModel`.

### Full workflow (column not yet on table):
```bash
# 1. Add to the table
node --env-file=.env skills/add-columns-to-table/add-columns-to-table.js \
  --name MY_TABLE --columns "COL:cds.String:100:Label"

# 2. Cascade to all downstream views (saves + deploys)
node --env-file=.env skills/propagate-columns/propagate-columns.js \
  --start MY_TABLE --columns "COL:cds.String:100:Label" --cache
```

### If the column was already added to the table manually:
Skip step 1. Run only `propagate-columns` — it skips the start node automatically.
```bash
node --env-file=.env skills/propagate-columns/propagate-columns.js \
  --start MY_TABLE --columns "COL:cds.String:100:Label" --cache
```

### Deploy behavior:
`propagate-columns`, `rename-column-cascade`, and `remove-column-cascade` **automatically deploy** after a successful verify phase. No manual DSP UI deployment needed. Use `--no-deploy` to skip.

## Updating Objects With Dependencies

DSP enforces referential integrity on saves. When renaming or removing columns that downstream objects reference, you will hit HTTP 422 errors in both directions:

- **Removing/renaming a column on a view** → DSP blocks it if any downstream object references that column by the old name.
- **Updating a downstream object** to use the new column name → DSP blocks it if the upstream object doesn't have that column yet.

This creates a **circular dependency deadlock**. The solution is `--allow-missing-dependencies`:

```js
commands["objects views update"]({
  "--space": SPACE,
  "--technical-name": VIEW,
  "--file-path": tmpFile,
  "--no-deploy": true,
  "--allow-missing-dependencies": true,   // breaks the deadlock
})
```

**Always add `"--allow-missing-dependencies": true`** to any view update script. It allows saving objects that temporarily reference columns that don't exist yet, with a warning instead of an error. The warnings resolve once all objects in the chain are updated.

**Update order does not matter** when using `--allow-missing-dependencies` — any ordering works. Without it, there is no valid ordering (true circular dependency).

## Ad-hoc Update Scripts

When updating existing objects programmatically (not via skills), write a dedicated `.mjs` file and run it with `node --env-file=.env`. Never use `node -e "..."` inline scripts.

Standard script template pattern:
- `captureStdout()` to capture CLI output
- `parseObject()` to parse the JSON response (handles leading log lines)
- Always log `err.response?.data` on failure to see the DSP error message
- Always use `"--no-deploy": true` unless deployment is explicitly requested
- Always use `"--allow-missing-dependencies": true` on every update call

## Analyzing Dependencies

When asked "what depends on X", "list dependent objects", "impact of X", or any question about dependency chains, **always use `impact-analysis`**.

```bash
node --env-file=.env skills/impact-analysis/impact-analysis.js \
  --name <object-name> --direction downstream [--cache]
```

Use `--cache` for repeated queries — subsequent runs are instant.

## Workflow Reference

See [`docs/claude-memory/workflow_guide.md`](docs/claude-memory/workflow_guide.md) for a complete proven example with working commands.
