# create-view

Create a View in SAP Datasphere using CLI

## Description

Creates a view in the specified Datasphere space using CDS (Core Data Services) format. Views are virtual tables based on SELECT queries from other tables or views.

## Usage

```
/create-view --name <view-name> --source <source-table> --space <space-id> [--columns <column-list>]
```

## Parameters

- `--name` (required): Technical name of the view (e.g., `MY_VIEW`)
- `--source` (required): Source table or view name to query from
- `--space` (optional): Space ID (default: `$SPACE` from `.env`)
- `--label` (optional): User-friendly label for the view
- `--columns` (optional): Comma-separated list of columns to select (default: all columns from source)
  - Format: `COLUMN1,COLUMN2,COLUMN3`
- `--dimensions` (optional): Dimension associations in format `fkColumn:dimTable:joinKey`
  - Use **semicolon** (`;`) to separate multiple dimensions
  - Format: `CUSTOMER_ID:DIM_CUSTOMER:ID;PRODUCT_ID:DIM_PRODUCT:ID`
- `--where` (optional): WHERE clause filter condition

## Examples

### Example 1: Simple view selecting all columns
```
/create-view --name CUSTOMER_VIEW --source CUSTOMER_TABLE --space YOUR_SPACE_ID
```

### Example 2: View with specific columns
```
/create-view --name PRODUCT_SUMMARY --source PRODUCT_TABLE --columns "PRODUCT_ID,PRODUCT_NAME,PRICE" --label "Product Summary View"
```

### Example 3: View with filter
```
/create-view --name ACTIVE_ORDERS --source ORDER_TABLE --where "STATUS = 'ACTIVE'"
```

## Implementation

The skill will:
1. Parse the parameters
2. Generate CDS-compliant VIEW definition with SELECT query
3. Authenticate to Datasphere
4. Create the view using `objects views create`
5. Verify the view was created
6. Return the view details

## Output

Returns the created view definition and confirmation message.

## Notes

- View names must be unique within the space
- CDS format is required for Datasphere objects
- The view is automatically deployed after creation
- Source table/view must exist in the same space

## Error Handling

- If view already exists, returns error with existing view details
- If authentication fails, provides login instructions
- If source table doesn't exist, returns error
- If space doesn't exist, lists available spaces
