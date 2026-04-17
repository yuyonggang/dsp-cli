# read-object

Read and display the definition of an existing SAP Datasphere object in human-readable form.

## Usage

```
node skills/read-object/read-object.js --name <name> --type <type> [--space <space>] [--raw]
```

## Parameters

- `--name` (required): Technical name of the object
- `--type` (required): Object type
  - `table` — Local table
  - `view` — Graphical or SQL view
  - `analytic-model` — Analytic model
  - `data-flow` — Data flow
  - `replication-flow` — Replication flow
  - `transformation-flow` — Transformation flow
- `--space` (optional): Space ID. Default: `$SPACE` from `.env`
- `--raw` (optional flag): Print the full CSN JSON instead of the formatted summary

## Examples

### Read a table
```
node skills/read-object/read-object.js --name DIM_CUSTOMER_001 --type table --space YOUR_SPACE_ID
```

### Read a view
```
node skills/read-object/read-object.js --name SALES_VW_001 --type view --space YOUR_SPACE_ID
```

### Read an analytic model
```
node skills/read-object/read-object.js --name AM_SALES_001 --type analytic-model --space YOUR_SPACE_ID
```

### Get the raw CSN definition (e.g. to inspect uiModel)
```
node skills/read-object/read-object.js --name SALES_VW_001 --type view --raw
```

## Output

Prints a formatted summary showing:
- **Tables/Views**: label, columns with types and flags (KEY, NOT NULL, DIMENSION, MEASURE), associations
- **Analytic models**: source, dimension sources, measures, attributes
- **Flows**: label, sources, targets

Use `--raw` to get the full CSN JSON definition, which is useful when you need to inspect the `uiModel` or write an update script.

## Notes

- Use this before modifying an object to understand its current structure
- Use `--raw` to get a definition you can use as input for an update script
