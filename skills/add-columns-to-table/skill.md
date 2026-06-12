# add-columns-to-table

Add new columns to an existing **local table** in SAP Datasphere.

> **Object type check**: This skill only works on local tables. If the object is a view, use `add-columns-to-view` instead. If you're unsure of the type, check: a local table has `"kind":"entity"` and no `editorSettings.uiModel`; a view has `editorSettings.uiModel`.

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
