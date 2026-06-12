# describe-model

Traverse the full dependency chain of an analytic model or view and print a human-readable summary of the entire data model structure.

## Usage

```
node skills/describe-model/describe-model.js --name <name> [--space <space>]
```

## Parameters

- `--name` (required): Technical name of the analytic model or view to describe
- `--space` (optional): Space ID. Default: `$SPACE` from `.env`

## Examples

### Describe an analytic model and its full chain
```
node skills/describe-model/describe-model.js --name AM_SALES_001 --space YOUR_SPACE_ID
```

### Describe a view and its source table and dimensions
```
node skills/describe-model/describe-model.js --name SALES_VW_001 --space YOUR_SPACE_ID
```

## Output

Prints a structured report showing each layer of the model:

```
════════════════════════════════════════════════════════════
Model Description: AM_SALES_001  (space: YOUR_SPACE_ID)
════════════════════════════════════════════════════════════

[ Analytic Model ]  AM_SALES_001
  Label  : Sales Analysis
  Source : SALES_VW_001
  Measures: AMOUNT, QUANTITY
  Attributes: ORDER_ID, ORDER_DATE
  Dimension Sources: _CUSTOMER → DIM_CUSTOMER_001

────────────────────────────────────────────────────────────
[ View ]  SALES_VW_001
  Source: SALES_FACT_001
  Associations: _CUSTOMER → DIM_CUSTOMER_001
  Columns: ORDER_ID, CUSTOMER_ID (FK), AMOUNT (measure), ...

────────────────────────────────────────────────────────────
[ Fact Table ]  SALES_FACT_001
  Columns: ORDER_ID (KEY), CUSTOMER_ID, AMOUNT, ...

────────────────────────────────────────────────────────────
[ Dimension Table ]  DIM_CUSTOMER_001  (via: _CUSTOMER)
  Columns: ID (KEY), NAME, CITY, ...
```

## Notes

- Works with both analytic models and views as the starting point
- If the starting name is not an analytic model, it will try reading it as a view
- Dimension tables are read by following the view's associations
- Use this to quickly understand a model built by a colleague, or to plan schema changes
