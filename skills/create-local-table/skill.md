# create-local-table

Create a Local Table in SAP Datasphere using CLI

## Description

Creates a local table in the specified Datasphere space using CDS (Core Data Services) format.

## Usage

```
/create-local-table --name <table-name> --space <space-id> [--columns <column-definitions>]
```

## Parameters

- `--name` (required): Technical name of the table (e.g., `MY_TABLE`)
- `--space` (optional): Space ID (default: `SAP_SCT`)
- `--label` (optional): User-friendly label for the table
- `--columns` (optional): Comma-separated column definitions in format `name:type:length:key:required`
  - Format: `COLUMN_NAME:cds.String:100:key:required`
  - Types: `cds.String`, `cds.Integer`, `cds.Decimal`, `cds.Date`, `cds.DateTime`, `cds.Boolean`
  - Modifiers: `key` (primary key), `required` (not null)

## Examples

### Example 1: Simple table with predefined columns
```
/create-local-table --name CUSTOMER_TABLE --space SAP_SCT
```
Creates a table with default columns: ID, NAME, DESCRIPTION, AMOUNT, CREATED_DATE

### Example 2: Custom columns
```
/create-local-table --name PRODUCT_TABLE --space SAP_SCT --columns "PRODUCT_ID:cds.String:10:key:required,PRODUCT_NAME:cds.String:100:required,PRICE:cds.Decimal:15:2,STOCK:cds.Integer"
```

### Example 3: With custom label
```
/create-local-table --name ORDER_HEADER --space SAP_SCT --label "Order Header Table"
```

## Implementation

The skill will:
1. Parse the parameters
2. Generate CDS-compliant JSON definition
3. Authenticate to Datasphere
4. Create the table using `objects local-tables create`
5. Verify the table was created
6. Return the table details

## Output

Returns the created table definition and confirmation message.

## Notes

- Table names must be unique within the space
- CDS format is required for Datasphere objects
- The table is automatically deployed after creation
- Primary key is required (at least one column must have `key` modifier)

## Error Handling

- If table already exists, returns error with existing table details
- If authentication fails, provides login instructions
- If space doesn't exist, lists available spaces
