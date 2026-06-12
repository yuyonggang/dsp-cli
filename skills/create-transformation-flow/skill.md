# create-transformation-flow

Create a Transformation Flow in SAP Datasphere using CLI

## Description

Creates a transformation flow in the specified Datasphere space. Transformation flows are used to apply SQL-based transformations to data.

## Usage

```
/create-transformation-flow --name <flow-name> --source <source-view> --target <target-table> --transformation <sql-file> --space <space-id>
```

## Parameters

- `--name` (required): Technical name of the transformation flow (e.g., `TF_SALES_TRANSFORM`)
- `--source` (required): Source view or table name
- `--target` (required): Target table name
- `--space` (optional): Space ID (default: `$SPACE` from `.env`)
- `--label` (optional): User-friendly label for the flow
- `--sql` (optional): Inline SQL transformation (simple transformations)
- `--sql-file` (optional): Path to file containing SQL transformation

## Examples

### Example 1: Simple transformation flow (copy all columns)
```
/create-transformation-flow --name TF_CUSTOMER_CLEAN --source CUSTOMER_RAW --target CUSTOMER_CLEAN --space YOUR_SPACE_ID
```

### Example 2: With inline SQL transformation
```
/create-transformation-flow --name TF_SALES_AGG --source SALES_DETAIL --target SALES_SUMMARY --sql "SELECT CUSTOMER_ID, SUM(AMOUNT) as TOTAL FROM SALES_DETAIL GROUP BY CUSTOMER_ID"
```

### Example 3: With SQL file
```
/create-transformation-flow --name TF_COMPLEX --source DATA_SOURCE --target DATA_TARGET --sql-file ./transformations/complex.sql
```

## Implementation

The skill will:
1. Parse the parameters
2. Read SQL transformation (from parameter or file)
3. Generate transformation flow definition
4. Authenticate to Datasphere
5. Create the transformation flow using `objects transformation-flows create`
6. Verify the flow was created
7. Return the flow details

## Output

Returns the created transformation flow definition and confirmation message.

## Notes

- Transformation flow names must be unique within the space
- Source must exist before creating the flow
- Target table will be created based on transformation result
- The flow is NOT automatically run after creation
- SQL transformation should be valid SAP HANA SQL

## Error Handling

- If flow already exists, returns error with existing flow details
- If authentication fails, provides login instructions
- If source doesn't exist, returns error
- If SQL is invalid, returns error from Datasphere

## Format

Transformation flows in Datasphere use a specific JSON structure similar to views but with additional transformation logic.

## Limitations

- This is a simplified implementation for basic transformation scenarios
- For complex multi-step transformations, use the Datasphere UI
- The SQL should be compatible with SAP HANA SQL syntax
