# rename-column-cascade

Rename a column starting from a view across the full downstream chain (views → views → ... → AMs).

## Usage

```
node --env-file=.env skills/rename-column-cascade/rename-column-cascade.js \
  --start <view-name> \
  --old-name <col> --new-name <col> \
  [--space <space>] [--dry-run] [--cache] [--no-deploy] [--force]
```

## Parameters

- `--start` (required): Starting view containing the column
- `--old-name` (required): Current column name
- `--new-name` (required): New column name
- `--space`, `--cache`, `--refresh`: as in impact-analysis
- `--dry-run`: print plan only, no writes
- `--no-deploy`: save but skip deploy phase
- `--force`: override the 50-node guard

## Behavior

1. Builds (or reuses cached) graph
2. BFS downstream from `--start`, topo-orders
3. For each direct-edge view (and every AM) in the downstream chain, invokes the existing `rename-column` skill (which handles view → AM cascade for one hop). The cascade orchestrator handles multi-hop view → view chains.
4. All saves use `--allow-missing-dependencies` (set by the underlying rename-column skill)
5. Re-reads each modified object to verify the rename happened
6. Deploys in topo order if all verifies pass and `--no-deploy` not set

## Notes

- Backups land in `.cache/backups/<timestamp>-rename/`
- The starting view IS modified (rename-column-cascade includes the start node, unlike propagate-columns which expects the start to be pre-seeded). This is because rename means "change this view's column AND propagate" — there's no separate seeding step.
- Association columns and FK references are not renamed — only regular projected columns (consistent with rename-column).
