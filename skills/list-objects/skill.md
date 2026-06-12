# list-objects

List all objects of a given type in a SAP Datasphere space.

## Usage

```
node skills/list-objects/list-objects.js --env-file=.env [--type <type>] [--space <space>]
```

Or via Claude Code:

```
/list-objects --space YOUR_SPACE_ID --type view
```

## Parameters

- `--type` (optional): Object type to list. Default: `all`
  - `table` — Local tables
  - `view` — Graphical/SQL views
  - `analytic-model` — Analytic models
  - `data-flow` — Data flows
  - `replication-flow` — Replication flows
  - `transformation-flow` — Transformation flows
  - `all` — All of the above
- `--space` (optional): Space ID. Default: `$SPACE` from `.env`

## Examples

### List everything in a space
```
node skills/list-objects/list-objects.js --space YOUR_SPACE_ID
```

### List only views
```
node skills/list-objects/list-objects.js --space YOUR_SPACE_ID --type view
```

### List analytic models
```
node skills/list-objects/list-objects.js --space YOUR_SPACE_ID --type analytic-model
```

## Output

Prints each object type as a section with a two-column table (technical name + label), followed by a summary count per type.

## Notes

- Use this before creating objects to check for naming conflicts
- Use this to find the technical name of an object before modifying it
- If a type returns no results, it displays `(none)` rather than an error
