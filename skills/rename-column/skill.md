# rename-column

Rename a column in a view and automatically cascade the rename to all dependent analytic models in the same space.

## Usage

```
node skills/rename-column/rename-column.js --object <view-name> --old-name <col> --new-name <col> [--space <space>]
```

## Parameters

- `--object` (required): Technical name of the view containing the column
- `--old-name` (required): Current column name
- `--new-name` (required): New column name
- `--space` (optional): Space ID. Default: `$SPACE` from `.env`

## Examples

### Rename a column in a view
```
node skills/rename-column/rename-column.js \
  --object SALES_VW_001 \
  --old-name CUST_ID \
  --new-name CUSTOMER_ID \
  --space YOUR_SPACE_ID
```

## What it updates

For the **view**:
1. `definitions.elements` — renames the element key
2. `query.SELECT.columns` — updates all refs and aliases
3. `editorSettings.uiModel` — updates element names in all nodes (Entity, RenameElements, Output)

For each **analytic model** that sources from the same view:
1. `definitions.elements`
2. `query.SELECT.columns`
3. `businessLayerDefinitions` — attribute and measure mappings

## Circular dependency handling

All saves use `--allow-missing-dependencies` to break the circular dependency deadlock. This means:
- The view can be saved referencing the new column name before the analytic model is updated
- The analytic model can be saved referencing the new column name before the view is deployed
- No specific ordering is required

## Notes

- Objects are saved with `--no-deploy`. Deploy from the Datasphere UI when the full rename is verified.
- Only views are supported as the starting object (not tables directly). To rename a column in a table that a view projects, rename it in the table first via the UI, then use this skill to update the view.
- Association columns and FK references are not renamed by this skill — only regular projected columns.
