# add-columns-to-view

Add new columns to an existing graphical View in SAP Datasphere.

## Description

Adds one or more columns to an existing view, keeping it in Graphical View Builder mode.
Updates all three required locations consistently:
1. `definitions.elements` — the CDS element definitions
2. `query.SELECT.columns` — the SELECT projection
3. `editorSettings.uiModel` — the graphical view UI model (source, projection, and output nodes)

The operation is **idempotent**: running it twice will not add duplicates. Each node
(source, projection, output) is checked independently before adding.

## Usage

```
/add-columns-to-view --name <view-name> --space <space-id> --columns <column-defs>
```

## Parameters

- `--name` (required): Technical name of the existing view
- `--space` (optional): Space ID (default: `SAP_CONTENT`)
- `--columns` (required): Column definitions, semicolon-separated
  - Format: `NAME:TYPE:LENGTH:LABEL`
  - Example: `OperatingConcern:cds.String:4:Operating Concern;DefaultProfitCenter:cds.String:10:Default Profit Center`
- `--insert-before` (optional): Insert new columns before this column name in the SELECT list (default: append at end)
- `--no-deploy` (optional): Save but do not deploy (default: false — deploy after save)

## Column Type Shorthand

The `TYPE` field accepts CDS types directly or shorthand:
- `String` → `cds.String`
- `Integer` → `cds.Integer`
- `Decimal:PRECISION:SCALE` → use precision/scale instead of length

## Examples

```
/add-columns-to-view --name SAP_FI_IL_AT_ControllingArea --space SAP_CONTENT \
  --columns "OperatingConcern:cds.String:4:Operating Concern;DefaultProfitCenter:cds.String:10:Default Profit Center"
```

## Notes

- The view must already exist and be a Graphical View Builder view (has `uiModel` in editorSettings)
- SQL-mode views are not supported
- Automatically detects whether the view has a projection node (RenameElements) or not
- Source table snapshot in uiModel is updated to reflect the source table's actual columns at runtime
