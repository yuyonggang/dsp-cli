# find-dependents

Find all views and analytic models in a space that reference a given table or view. Scans all objects and reports those that use the target as a direct source table or as an association target.

## Usage

```
node --env-file=.env skills/find-dependents/find-dependents.js --name <table-or-view-name> [--space <space>]
```

## Parameters

- `--name` (required): Technical name of the table or view to find dependents for
- `--space` (optional): Space ID. Default: `$SPACE` from `.env`

## Examples

```
node --env-file=.env skills/find-dependents/find-dependents.js \
  --name MY_SOURCE_TABLE
```

## Output

Lists each dependent with:
- Whether it references the target as a direct source table or via an association
- Its columns (views) or measures/attributes (analytic models)

## Notes

- Paginates through all objects in the space (no 25-item limit)
- Uses direct REST API calls — works even when CLI list commands return 403
- For large spaces with many objects, the scan may take a minute
