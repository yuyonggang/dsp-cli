# impact-analysis

Build a full dependency graph of all views and analytic models in a space in a **single scan**, then instantly traverse it to show the complete impact chain of any object. Optionally detects columns missing in downstream objects and produces an action plan.

**Key advantage over `find-dependents`**: one scan (~2-3 min) replaces N sequential full scans for an N-level chain. With `--cache`, subsequent runs skip API calls entirely (< 1 second).

## Usage

```
node --env-file=.env skills/impact-analysis/impact-analysis.js \
  --name <object-name> \
  [--space <space>] \
  [--direction downstream|upstream|both] \
  [--columns col1,col2,...] \
  [--cache] \
  [--refresh]
```

## Parameters

| Flag | Required | Default | Description |
|------|----------|---------|-------------|
| `--name` | yes | - | Technical name of the table, view, or analytic model |
| `--space` | no | `$SPACE` | Space ID |
| `--direction` | no | `both` | `downstream` (consumers), `upstream` (sources), or `both` |
| `--columns` | no | - | Comma-separated column names to check propagation for |
| `--cache` | no | off | Persist graph to `.cache/graph-{SPACE}.json` |
| `--refresh` | no | off | Force rebuild even if cache exists |

## Examples

### Basic impact analysis
```bash
node --env-file=.env skills/impact-analysis/impact-analysis.js \
  --name MY_SOURCE_TABLE
```

### Check new column propagation
```bash
node --env-file=.env skills/impact-analysis/impact-analysis.js \
  --name MY_SOURCE_TABLE \
  --columns NewTestColumn
```

### Downstream only, with caching
```bash
node --env-file=.env skills/impact-analysis/impact-analysis.js \
  --name MY_TABLE \
  --direction downstream \
  --cache

# Second run uses cache (instant):
node --env-file=.env skills/impact-analysis/impact-analysis.js \
  --name MY_TABLE \
  --direction downstream \
  --cache
```

### Force cache rebuild
```bash
node --env-file=.env skills/impact-analysis/impact-analysis.js \
  --name MY_TABLE \
  --cache --refresh
```

## Output

Three sections:

1. **Dependency Tree** — indented tree showing all upstream/downstream objects with type tags (`[table]`, `[view]`, `[AM]`) and edge types (direct source vs association)
2. **Column Propagation** (when `--columns` used) — for each object in the chain, shows whether the specified columns exist, are missing, or are auto-visible via association
3. **Action Plan** (when `--columns` used) — numbered list of objects that need changes, ordered from closest to the source outward

## How It Works

1. **List** all views and analytic models in the space (paginated, `top=100`)
2. **Read** every definition in parallel (concurrency 20)
3. **Parse** each CSN definition to extract source refs, association targets, and columns
4. **Build** an in-memory directed graph (downstream + upstream edge maps)
5. **Traverse** the graph via BFS from the start node — zero additional API calls

## Performance

| Metric | find-dependents (5-level chain) | impact-analysis |
|--------|--------------------------------|-----------------|
| API calls | ~4000 (5 full scans) | ~815 (1 scan) |
| Time | ~15-20 min | ~2-3 min |
| With cache | N/A | < 1 sec |

## Notes

- Tables are not scanned (they appear as leaf nodes referenced by views)
- Circular associations are handled (BFS uses a visited set)
- Objects referencing tables in other spaces appear as "unknown" nodes
- The `--cache` file includes a timestamp — use `--refresh` after structural changes
- Add `.cache/` to `.gitignore` if using caching
