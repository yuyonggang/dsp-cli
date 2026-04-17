# export-model

Export the full CSN definitions of a data model and all its dependencies to local JSON files. Covers the analytic model, its source view, the fact table, and all dimension tables.

## Usage

```
node skills/export-model/export-model.js --name <name> [--space <space>] [--output-dir <path>]
```

## Parameters

- `--name` (required): Technical name of the analytic model or view to export
- `--space` (optional): Space ID. Default: `$SPACE` from `.env`
- `--output-dir` (optional): Local directory to write files to. Default: `./export`

## Examples

### Export a full model to the default ./export folder
```
node skills/export-model/export-model.js --name AM_SALES_001 --space YOUR_SPACE_ID
```

### Export to a specific directory
```
node skills/export-model/export-model.js --name AM_SALES_001 --space YOUR_SPACE_ID --output-dir ./backups/sales-model-2026-04
```

### Export starting from a view (no analytic model)
```
node skills/export-model/export-model.js --name SALES_VW_001 --space YOUR_SPACE_ID
```

## Output

Creates one JSON file per object in the output directory:

```
export/
  index.json                     # Summary: what was exported and when
  analytic-model_AM_SALES_001.json
  view_SALES_VW_001.json
  table_SALES_FACT_001.json
  table_DIM_CUSTOMER_001.json
  table_DIM_PRODUCT_001.json
```

The `index.json` file records the export timestamp, space, root object, and a list of all exported files — useful for documentation and re-import.

## Use cases

- **Backup** before making schema changes
- **Version control** — commit the export folder to track model evolution over time
- **Migration** — export from one space/tenant and re-import to another (manually or scripted)
- **Documentation** — share the raw definitions with colleagues

## Notes

- The exported JSON files are in the native CSN format that the CLI understands
- To re-import, use the appropriate `create` or `update` CLI commands with `--file-path`
- If the root object is an analytic model, the skill follows its source reference to find the view, and from there the fact table and dimension tables
