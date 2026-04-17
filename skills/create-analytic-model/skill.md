# create-analytic-model

Create an Analytic Model in SAP Datasphere using CLI

## Description

Creates an analytic model in the specified Datasphere space. Analytic models are used for analytical queries and reporting, combining fact data with dimensions and measures.

## Usage

```
/create-analytic-model --name <model-name> --source <source-view> --space <space-id> [--attributes <attr-list>] [--measures <measure-list>] [--dimensions <dim-definitions>]
```

## Parameters

- `--name` (required): Technical name of the analytic model (e.g., `AM_SALES`)
- `--source` (required): Source view/table to use as fact source
- `--space` (optional): Space ID (default: `$SPACE` from `.env`)
- `--label` (optional): User-friendly label for the model
- `--attributes` (optional): Comma-separated list of attribute columns (dimensions)
- `--measures` (optional): Comma-separated list of measure columns (facts to aggregate)
  - Format: `COLUMN1,COLUMN2,COLUMN3`
- `--dimensions` (optional): Dimension table associations with attributes to expose
  - Format: `FK_COLUMN:DIMENSION_TABLE:JOIN_KEY:ATTR1,ATTR2;...`
  - Multiple dimensions separated by semicolon (;)
  - Example: `PRODUCT:LT_PRODUCT_DIM:PRODUCT_ID:PRODUCT_NAME,CATEGORY`

## Examples

### Example 1: Simple analytic model
```
/create-analytic-model --name AM_SALES_ANALYSIS --source SALES_VIEW --space YOUR_SPACE_ID
```

### Example 2: With specific attributes and measures
```
/create-analytic-model --name AM_PRODUCT_SALES --source PRODUCT_SALES_VIEW --attributes "PRODUCT_ID,CUSTOMER_ID,DATE" --measures "AMOUNT,QUANTITY"
```

### Example 3: With dimension tables (complex)
```
/create-analytic-model --name AM_SALES_WITH_DIM --source SALES_FACT_VIEW --measures "AMOUNT,QUANTITY" --dimensions "PRODUCT:LT_PRODUCT_DIM:PRODUCT_ID:PRODUCT_NAME,CATEGORY;CUSTOMER:LT_CUSTOMER_DIM:CUSTOMER_ID:CUSTOMER_NAME,REGION"
```
This creates an analytic model with:
- Fact source: SALES_FACT_VIEW
- Measures: AMOUNT, QUANTITY
- Dimension 1: PRODUCT table (LT_PRODUCT_DIM) joined on PRODUCT_ID, exposing PRODUCT_NAME and CATEGORY
- Dimension 2: CUSTOMER table (LT_CUSTOMER_DIM) joined on CUSTOMER_ID, exposing CUSTOMER_NAME and REGION

### Example 4: With custom label
```
/create-analytic-model --name AM_REVENUE --source REVENUE_VIEW --label "Revenue Analysis Model"
```

## Implementation

The skill will:
1. Parse the parameters
2. Read source structure to identify columns
3. Generate CDS definition with analytical annotations
4. Generate businessLayerDefinitions structure
5. Authenticate to Datasphere
6. Create the analytic model using `objects analytic-models create`
7. Verify the model was created
8. Return the model details

## Output

Returns the created analytic model definition and confirmation message.

## Notes

- Model names must be unique within the space
- Requires both CDS definitions and businessLayerDefinitions
- Automatically marks numeric fields as measures if not specified
- The model is automatically deployed after creation
- Source view/table must exist in the same space

## Error Handling

- If model already exists, returns error with existing model details
- If authentication fails, provides login instructions
- If source doesn't exist, returns error
- If space doesn't exist, lists available spaces
