# create-model

Create a complete SAP Datasphere data model in a single command. Orchestrates the full sequence: dimension tables → fact table → view with associations → analytic model.

## Usage

```
node skills/create-model/create-model.js --series <NNN> [options]
```

## Parameters

- `--series` (required): Series number suffix for all generated object names (e.g. `001`)
- `--fact-name` (optional): Override the fact table name. Default: `FACT_<series>`
- `--fact-columns` (optional): Comma-separated column definitions for the fact table (same format as `create-local-table`)
- `--dimensions` (optional): Semicolon-separated dimension table specs (see format below)
- `--view-name` (optional): Override the view name. Default: `VW_<series>`
- `--model-name` (optional): Override the analytic model name. Default: `AM_<series>`
- `--label` (optional): Base label applied to all objects (each gets a suffix like `- Fact`, `- View`, etc.)
- `--space` (optional): Space ID. Default: `$SPACE` from `.env`

## Dimension spec format

```
DIM_TABLE_NAME:FK_COLUMN:JOIN_KEY:ATTR1,ATTR2;DIM_TABLE2:FK2:KEY2:ATTR1
```

Where:
- `DIM_TABLE_NAME`: Technical name of the dimension table to create
- `FK_COLUMN`: Foreign key column in the fact table that links to this dimension
- `JOIN_KEY`: Primary key column of the dimension table
- `ATTR1,ATTR2`: Additional attribute columns to create on the dimension table (optional)

## Examples

### Minimal model (no dimensions)
```
node skills/create-model/create-model.js --series 001 --space YOUR_SPACE_ID
```
Creates: `FACT_001`, `VW_001`, `AM_001` with default columns.

### Full sales model with two dimensions
```
node skills/create-model/create-model.js \
  --series 001 \
  --fact-name SALES_FACT_001 \
  --fact-columns "ORDER_ID:String:10:key,CUSTOMER_ID:String:10,PRODUCT_ID:String:10,AMOUNT:Decimal:15:2,ORDER_DATE:Date" \
  --dimensions "DIM_CUSTOMER_001:CUSTOMER_ID:ID:NAME,CITY;DIM_PRODUCT_001:PRODUCT_ID:ID:NAME,CATEGORY" \
  --view-name SALES_VW_001 \
  --model-name AM_SALES_001 \
  --label "Sales Analysis" \
  --space YOUR_SPACE_ID
```

## Creation order

The skill always creates objects in the correct dependency order:
1. Dimension tables (with `--dimension` flag)
2. Fact table
3. View with dimension associations (auto-generated from dimension specs)
4. Analytic model (auto-detects measures and dimensions from the view)

## Notes

- All objects use the same series number to avoid naming conflicts during iterative development
- The analytic model auto-detects measures (numeric columns) and dimensions (via view associations)
- If you need to create a second version, increment the series: `--series 002`
- To clean up a full model, delete objects manually in the Datasphere UI in reverse order: analytic model → view → fact table → dimension tables
