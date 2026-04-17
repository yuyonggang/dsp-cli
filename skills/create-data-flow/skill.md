# create-data-flow

Create a Data Flow in SAP Datasphere using CLI

## Description

Creates a simple data flow in the specified Datasphere space. Data flows are ETL processes that move and transform data from source to target.

## Usage

```
/create-data-flow --name <flow-name> --source <source-view> --target <target-table> --space <space-id>
```

## Parameters

- `--name` (required): Technical name of the data flow (e.g., `DF_SALES_ETL`)
- `--source` (required): Source view or table name
- `--target` (required): Target table name
- `--space` (optional): Space ID (default: `$SPACE` from `.env`)
- `--label` (optional): User-friendly label for the flow
- `--mode` (optional): Load mode - `truncate`, `append`, or `upsert` (default: `truncate`)

## Examples

### Example 1: Simple data flow (truncate and load)
```
/create-data-flow --name DF_CUSTOMER_ETL --source CUSTOMER_VIEW --target CUSTOMER_TARGET --space YOUR_SPACE_ID
```

### Example 2: Append mode
```
/create-data-flow --name DF_ORDERS_APPEND --source ORDERS_VIEW --target ORDERS_FACT --mode append
```

### Example 3: With custom label
```
/create-data-flow --name DF_PRODUCTS --source PRODUCTS_STAGING --target PRODUCTS_DIM --label "Products ETL Flow" --mode upsert
```

## Implementation

The skill will:
1. Parse the parameters
2. Read source structure
3. Generate data flow definition (includes processes, connections, vTypes)
4. Authenticate to Datasphere
5. Create the data flow using `objects data-flows create`
6. Verify the flow was created
7. Return the flow details

## Output

Returns the created data flow definition and confirmation message.

## Notes

- Data flow names must be unique within the space
- Source must exist before creating the data flow
- Target table will be created if it doesn't exist
- The flow is NOT automatically run after creation - you need to execute it separately
- This creates a simple source→target flow without transformations

## Error Handling

- If flow already exists, returns error with existing flow details
- If authentication fails, provides login instructions
- If source doesn't exist, returns error
- If space doesn't exist, lists available spaces

## Format

Data flows in Datasphere use a complex JSON structure that includes:
- `processes`: Source (consumer) and target (producer) nodes
- `connections`: Links between nodes
- `vTypes`: Data type definitions
- `sources` and `targets`: Source and target entity definitions
- Node positioning (x, y coordinates)

## Limitations

- This is a simplified implementation for basic ETL scenarios
- For complex flows with transformations, joins, or multiple sources, use the Datasphere UI
- The generated flow performs a direct copy from source to target
