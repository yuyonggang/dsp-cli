# remove-column-cascade

Remove a column starting from a view across the full downstream chain (views → views → ... → AMs).

## Usage

```
node --env-file=.env skills/remove-column-cascade/remove-column-cascade.js \
  --start <view-name> \
  --column <col> \
  [--space <space>] [--dry-run] [--cache] [--no-deploy] [--force]
```

## Parameters

- `--start` (required): Starting view containing the column
- `--column` (required): Column to remove
- `--space`, `--cache`, `--refresh`: as in impact-analysis
- `--dry-run`: print plan only, no writes
- `--no-deploy`: save but skip deploy phase
- `--force`: override the 50-node guard

## Behavior

1. Builds (or reuses cached) graph
2. BFS downstream from `--start`, topo-orders
3. For each direct-edge view (and every AM) in the downstream chain, invokes the existing `remove-column` skill (which handles view → AM cascade for one hop). The cascade orchestrator handles multi-hop view → view chains.
4. All saves use `--allow-missing-dependencies` (set by the underlying remove-column skill)
5. Re-reads each modified object to verify the column was removed
6. Deploys in topo order if all verifies pass and `--no-deploy` not set

## Notes

- Backups land in `.cache/backups/<timestamp>-remove/`
- The starting view IS modified (consistent with rename-column-cascade — there's no separate seeding step for removes).
- Save order is topological (sources first). `--allow-missing-dependencies` makes ordering insensitive — the underlying remove-column skill handles the deadlock.
