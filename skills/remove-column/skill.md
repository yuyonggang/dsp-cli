# remove-column

Remove a column from a view and automatically cascade the removal to all dependent analytic models in the same space.

## Usage

```
node skills/remove-column/remove-column.js --object <view-name> --column <col-name> [--space <space>]
```

## Parameters

- `--object` (required): Technical name of the view containing the column
- `--column` (required): Technical name of the column to remove
- `--space` (optional): Space ID. Default: `$SPACE` from `.env`

## Examples

### Remove a column from a view
```
node skills/remove-column/remove-column.js \
  --object SALES_VW_001 \
  --column LEGACY_CODE \
  --space YOUR_SPACE_ID
```

## What it updates

For the **view**:
1. `definitions.elements` — deletes the element
2. `query.SELECT.columns` — removes the column reference
3. `editorSettings.uiModel` — removes the element from all nodes (Entity, RenameElements, Output) and any associated element mappings

For each **analytic model** that sources from the same view:
1. `definitions.elements`
2. `query.SELECT.columns`
3. `businessLayerDefinitions` — removes any attribute or measure that maps to the removed column

## Circular dependency handling

All saves use `--allow-missing-dependencies` so the view and analytic models can be saved in any order without hitting HTTP 422 errors.

## Notes

- Objects are saved with `--no-deploy`. Deploy from the Datasphere UI after verifying the removal.
- Only columns in views are supported. To remove a column from a source table, use the Datasphere UI (table column removal via CLI is not supported without a full table redefinition).
- Association columns (FK links to dimension tables) are not removed by this skill. To remove a dimension association, update the view manually.
- This action cannot be undone via the CLI. Consider using `export-model` to back up the model before removing columns.
