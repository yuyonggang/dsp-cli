# propagate-columns

Cascade-add new columns from a source table or view to every direct downstream view in the chain. Skips association edges (auto-visible) and warns on SQL views (not editable).

## Usage

```
node --env-file=.env skills/propagate-columns/propagate-columns.js \
  --start <table-or-view> \
  --columns "COL_A:cds.String:10:Label A;COL_B:cds.Decimal:15:2:Label B" \
  [--space <space>] [--dry-run] [--cache] [--refresh] [--no-deploy] [--force]
```

## Parameters

- `--start` (required): Starting object (table or view). The start node itself is NOT modified — call `add-columns-to-table` or `add-columns-to-view` first to seed the start. This skill propagates downstream from there.
- `--columns` (required): Semicolon-separated column definitions, format `NAME:TYPE:LEN:LABEL`
- `--space`, `--cache`, `--refresh`: as in impact-analysis
- `--dry-run`: print plan only, no writes
- `--no-deploy`: save but skip deploy phase
- `--force`: override the 50-node guard

## Behavior

1. Builds (or reuses cached) graph
2. BFS downstream from `--start`, topo-orders
3. For each direct/join-edge VIEW (skips the start node itself, skips association edges, warns on SQL views): calls `add-columns-to-view` with `--no-deploy --allow-missing-dependencies`
4. Re-reads each modified view to verify column present
5. Deploys in topo order if all verifies pass and `--no-deploy` not set

## Notes

- Backups land in `.cache/backups/<timestamp>-add/`
- Tables in the graph are leaf nodes only — `--start` may be a table; the skill cascades to its dependent views.
- The start node itself is skipped during the cascade — seed it first with `add-columns-to-table` or `add-columns-to-view`.
- **If the table column was already added manually**, skip `add-columns-to-table` and run `propagate-columns` directly — it will skip the start node and cascade only to the dependent views.
- Deploy is handled automatically after a successful verify phase (re-saves each object without `--no-deploy`). Use `--no-deploy` to skip deploy explicitly.
