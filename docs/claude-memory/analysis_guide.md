# Analyzing and Modifying Data Models

This guide covers how to explore, analyze, and modify existing SAP Datasphere data models using the CLI skills. It complements the [workflow_guide.md](workflow_guide.md) (which covers creation) with the inspection and modification half of the lifecycle.

---

## Step 1: Explore a Space

Before analyzing anything, get an overview of what exists.

### List all objects

```bash
node --env-file=.env skills/list-objects/list-objects.js --type all
```

Filter by type to focus your search:

```bash
node --env-file=.env skills/list-objects/list-objects.js --type view
node --env-file=.env skills/list-objects/list-objects.js --type analytic-model
node --env-file=.env skills/list-objects/list-objects.js --type table
```

**Output**: Technical name and label for every object of that type in the space, with a count summary.

### Read a single object

```bash
node --env-file=.env skills/read-object/read-object.js \
  --name MY_TABLE --type table

node --env-file=.env skills/read-object/read-object.js \
  --name MY_VIEW --type view --raw   # --raw prints full CSN JSON
```

**Output**: Column names, types, lengths, key/notNull flags, label, and modeling pattern. Use `--raw` when you need the full CSN definition for scripting.

---

## Step 2: Understand a Data Model

### describe-model: Trace the full chain

Starting from an analytic model or view, `describe-model` walks the entire dependency chain downward (AM -> view -> fact table -> dimension tables) and prints a summary at each level.

```bash
node --env-file=.env skills/describe-model/describe-model.js \
  --name AM_SALES_001
```

**Output**: For each object in the chain: type, label, columns, measures/attributes (for AMs), associations (for views), and the source object it reads from.

**Best for**: Understanding a single model's structure from top to bottom.

---

## Step 3: Trace Dependencies

Two skills find objects that *reference* a given table or view. Choose based on your use case.

### find-dependents: Who uses this object?

Scans all views and analytic models in the space to find those referencing a specific table or view.

```bash
node --env-file=.env skills/find-dependents/find-dependents.js \
  --name MY_SOURCE_TABLE
```

**Output**: Every view and AM that uses the target as a direct source, association target, JOIN source, or SQL script reference.

**Best for**: Quick answer to "what breaks if I change this table?"

**Performance**: Scans every object individually. Fine for one-off checks. For repeated queries or multi-level chains, use `impact-analysis` instead.

### impact-analysis: Full dependency graph

Builds a complete graph of all views and AMs in the space in a single scan, then traverses it instantly for any object.

```bash
# First run: builds graph (~2-3 min for large spaces)
node --env-file=.env skills/impact-analysis/impact-analysis.js \
  --name MY_SOURCE_TABLE \
  --direction downstream \
  --cache

# Subsequent runs: instant from cache
node --env-file=.env skills/impact-analysis/impact-analysis.js \
  --name ANOTHER_TABLE \
  --direction downstream \
  --cache
```

**Directions**:
- `downstream` — what consumes this object (most common)
- `upstream` — what sources feed into this object
- `both` — full picture in both directions

**Best for**: Large spaces, multi-level dependency chains, repeated queries, column propagation analysis.

### When to use which

| Scenario | Use |
|----------|-----|
| "What views use TABLE_X?" (one-off) | `find-dependents` |
| "What's the full chain if I change TABLE_X?" | `impact-analysis --direction downstream` |
| "Where does VIEW_Y get its data from?" | `impact-analysis --direction upstream` |
| "I need to check multiple tables" | `impact-analysis --cache` (one scan, many queries) |
| "Which columns are missing downstream?" | `impact-analysis --columns COL1,COL2` |

---

## Step 4: Assess Column Change Impact

When you plan to add, rename, or remove columns, use `impact-analysis` with the `--columns` flag to see exactly which downstream objects already have those columns and which need updating.

```bash
node --env-file=.env skills/impact-analysis/impact-analysis.js \
  --name MY_SOURCE_TABLE \
  --direction downstream \
  --columns NEW_COLUMN_A,NEW_COLUMN_B \
  --cache
```

**Output** (three sections):
1. **Dependency tree** — indented tree of all downstream objects
2. **Column propagation** — for each object, whether each column EXISTS, is MISSING, or is auto-visible via association
3. **Action plan** — numbered list of objects that need changes, ordered from closest to source outward

### Understanding edge types

- **direct source**: The downstream view reads from this object as its primary source. Columns must be explicitly added to propagate.
- **association**: The downstream view references this object via a CDS association. Columns are auto-visible for navigation/drill-down without explicit changes.
- **join**: The downstream view JOINs this object in a nested from-clause.
- **sql**: The downstream view references this object in a SQL table function script.

### Worked example

Analyzing `SAP_FIN_CS_IL_I_CNSLDTNUNITFORELIMHIERNODE_2` (a consolidation hierarchy node table):

```
SAP_FIN_CS_IL_I_CNSLDTNUNITFORELIMHIERNODE_2  [table]
 +-- SAP_FIN_CS_IL_H_ConsolidationUnitElimHierNode  [view]  (direct)
      +-- SAP_FIN_CS_ConsolidationUnitElimHier  [view]  (direct)
      |    +-- SAP_FIN_CS_ConsolidationUnitElim  [view]  (association)
      |         +-- SAP_FIN_CS_HL_GrpJrnlEntryItm_MatrixElim  [view]  (association)
      +-- SAP_FIN_CS_ConsolidationUnitElimHierNode  [view]  (direct)
```

**If new columns are added to the table:**
- **Step 1**: Update `SAP_FIN_CS_IL_H_ConsolidationUnitElimHierNode` (direct source — must add columns explicitly)
- **Step 2**: Update `SAP_FIN_CS_ConsolidationUnitElimHier` and `SAP_FIN_CS_ConsolidationUnitElimHierNode` (direct source — if columns need to propagate)
- **No action needed**: `ConsolidationUnitElim` and `GrpJrnlEntryItm_MatrixElim` use association links — columns are auto-visible

---

## Step 5: Make Changes

### Add columns to a view

```bash
node --env-file=.env skills/add-columns-to-view/add-columns-to-view.js \
  --name MY_VIEW \
  --columns "NEW_COL:cds.String:10:New Column Label"
```

Updates all three required locations (definitions, query, uiModel) to keep the view in Graphical mode. Idempotent — safe to run twice.

### Rename a column (with cascade)

```bash
node --env-file=.env skills/rename-column/rename-column.js \
  --object MY_VIEW \
  --old-name OLD_COL \
  --new-name NEW_COL
```

Automatically finds and updates all dependent analytic models. Uses `--allow-missing-dependencies` to break the circular dependency deadlock.

### Remove a column (with cascade)

```bash
node --env-file=.env skills/remove-column/remove-column.js \
  --object MY_VIEW \
  --column UNWANTED_COL
```

Removes the column from the view and cascades to dependent analytic models.

### Important: --allow-missing-dependencies

When renaming or removing columns, DSP enforces referential integrity in both directions, creating a deadlock:
- Can't update the view (downstream objects still reference old column)
- Can't update downstream objects (upstream doesn't have new column yet)

The `--allow-missing-dependencies` flag breaks this deadlock. The rename-column and remove-column skills use it automatically. If you write ad-hoc update scripts, always include it.

### Important: Objects are saved with --no-deploy

The rename-column and remove-column skills save changes with `--no-deploy`. After updating all objects in the chain, deploy them from the SAP Datasphere UI when ready.

---

## Step 6: Export for Backup

Before making large changes, export the current state:

```bash
node --env-file=.env skills/export-model/export-model.js \
  --name AM_SALES_001 \
  --output-dir ./backups/before-rename
```

This exports the full CSN definitions of the model and all its dependencies to local JSON files.

---

## Recommended Workflow for Large Changes

1. **Explore**: `list-objects` to survey the space
2. **Analyze**: `impact-analysis --cache` to build the graph once
3. **Assess**: `impact-analysis --columns` on each object you plan to change
4. **Export**: `export-model` to back up affected objects
5. **Change**: Use `add-columns-to-view`, `rename-column`, or `remove-column`
6. **Verify**: `read-object --raw` on changed objects to confirm
7. **Deploy**: Deploy from DSP UI when satisfied

---

*Last updated: 2026-04-17*
