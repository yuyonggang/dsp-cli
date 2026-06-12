# Design: Large-Dataflow Cascade Skills for DSP CLI

**Date:** 2026-05-28
**Status:** Draft — pending user review
**Canary chain:** `SAP_FIN_CS_IL_I_CNSLDTNSGMTHIERELIM` (multi-level consolidation hierarchy)

---

## Problem

The DSP CLI project works well for individual SAP Datasphere objects but breaks down on large data flows in three ways:

1. **Permission interruptions.** Long-running analyses and edit sessions trigger repeated approval prompts for `node`, git, and file operations that have already been authorized in spirit.
2. **Multi-level cascade gaps.** `rename-column` / `remove-column` cascade only one hop (view → AM). Real chains in the FIN_CS_IL_* family have view → view → view → AM. Single-hop cascades leave the chain inconsistent.
3. **Missing skills.** No `add-columns-to-table`. No chain-aware `propagate-columns`. No chain-aware rename/remove that walks the full downstream graph.

This design closes all three gaps without changing the contract of any existing skill.

---

## Goals

- Cascade column add / rename / remove across multi-level view chains, ending at analytic models.
- Auto-approve routine project commands so long-running tasks don't get interrupted.
- Provide a table-side analog (`add-columns-to-table`) so a "new column from source to AM" workflow is one-then-one command.
- Backup before, verify after, deploy on success — fail safely with a clear restore point.

## Non-goals

- SQL-view editing (still flagged in `known_limitations.md`; cascade skills warn and skip).
- Cross-space cascades (still unsupported).
- True bulk creation. (Each cascade run targets one column-set on one chain.)
- Auto-rollback on failure. (Backups are emitted; rollback is manual.)

---

## Architecture

```
skills/
  _lib/                              ← NEW shared library
    graph.js                         ← extracted from impact-analysis (auth, listAll,
                                       buildGraph, BFS, edge-type semantics)
    cascade.js                       ← NEW: backup → topo-order → per-node call →
                                       verify → deploy wrapper
    csn.js                           ← NEW: CSN element / column / uiModel helpers
                                       shared by add-columns-to-table and (later)
                                       any other table-touching skill

  add-columns-to-table/              ← NEW (table analog of add-columns-to-view)
  propagate-columns/                 ← NEW (chain-aware add)
  rename-column-cascade/             ← NEW (chain-aware rename)
  remove-column-cascade/             ← NEW (chain-aware remove)

  impact-analysis/                   ← refactor: import from _lib/graph.js
                                       (no behavior change, no CLI flag change)
  add-columns-to-view/               ← unchanged (called by propagate-columns)
  rename-column/                     ← unchanged (called by rename-column-cascade)
  remove-column/                     ← unchanged (called by remove-column-cascade)
```

### Key principles

- **Single-node skills stay single-node.** No `--cascade` flag bolted on to existing skills. This preserves their contract and keeps each skill's purpose obvious.
- **Cascade skills are orchestrators.** They build the graph, decide order, and call existing single-node skills per affected node. They do not duplicate CSN-mutation logic.
- **`_lib/graph.js`** is the canonical graph builder. `impact-analysis` becomes a thin CLI on top of it. Cascade skills also import it. The `.cache/graph-{SPACE}.json` file is shared so a `propagate-columns` run reuses an `impact-analysis` cache and vice versa.
- **`_lib/cascade.js`** exposes one function: `runCascade({ start, columns, action, dryRun, noDeploy, force, space })` which handles the full lifecycle (plan → backup → save → verify → deploy → summary).

---

## New / Changed Skill Interfaces

### `add-columns-to-table` (NEW)

```
node --env-file=.env skills/add-columns-to-table/add-columns-to-table.js \
  --name <table-name> \
  --columns "COL_A:cds.String:10:Label A;COL_B:cds.Decimal:15:2:Label B" \
  [--space <space>] [--no-deploy]
```

- Reads existing table CSN, appends to `definitions.elements` and `query.SELECT.columns`.
- Tables have no `uiModel`, so the three-way sync issue from views does not apply.
- Idempotent: skip columns that already exist.
- Default: deploy after save. `--no-deploy` opts out (matches `add-columns-to-view`).
- Saves with `--allow-missing-dependencies` (consistent with project convention).

### `propagate-columns` (NEW)

```
node --env-file=.env skills/propagate-columns/propagate-columns.js \
  --start <table-or-view> \
  --columns "NEW_COL_A:cds.String:10:Label A;NEW_COL_B:cds.Decimal:15:2:Label B" \
  [--space <space>] [--dry-run] [--cache] [--refresh] [--no-deploy] [--force]
```

- Builds graph (or loads cache), walks downstream from `--start`.
- For each **direct-edge view** node: calls `add-columns-to-view` in topological order.
- **Skips association-edge nodes** — columns auto-visible per `analysis_guide.md` edge semantics.
- **Stops at SQL views** with a clear warning per `known_limitations.md`.
- Refuses to run on > 50 affected nodes without `--force` (runaway-cascade guard).

### `rename-column-cascade` (NEW)

```
node --env-file=.env skills/rename-column-cascade/rename-column-cascade.js \
  --start <table-or-view> \
  --old-name <col> --new-name <col> \
  [--space <space>] [--dry-run] [--cache] [--no-deploy] [--force]
```

- Walks downstream graph from `--start`. For each direct-edge view, calls existing `rename-column` (which already handles view → AM cascade for one hop). The cascade skill orchestrates view → view → view → AM chains by issuing per-view calls in topo order.
- Same backup + verify + deploy wrapper.

### `remove-column-cascade` (NEW)

Same shape as `rename-column-cascade`, but with `--column <col>` instead of `--old-name`/`--new-name`.

### Common to all three cascade skills

- **`--dry-run`** prints the plan (object list, edge type, action) without writing.
- **`--cache`** reuses the `impact-analysis` graph cache.
- **`--force`** required when affected node count > 50.
- **Backup directory** printed at start (`.cache/backups/<ISO-timestamp>-<action>/`).
- **Final summary table:** ✓/✗ per object, with the failing DSP error message attached on ✗.
- **Exit code:** 0 if all saves + verify + deploy succeed; 1 if any node failed.

---

## Execution Lifecycle (cascade skills)

1. **Plan.** Build graph (cached or fresh), BFS downstream from `--start`, classify edges (direct / association / sql), produce ordered node list (sources first). Print plan.
2. **Guard.** If node count > 50 and `--force` not set, abort with summary.
3. **Backup.** Call `export-model` for every node in the plan, write to `.cache/backups/<ISO-timestamp>-<action>/`. Print path.
4. **Save phase.** Per-node call to the existing single-node skill with `--no-deploy --allow-missing-dependencies`. Continue on per-node failure (partial success is recoverable).
5. **Verify phase.** Re-read each modified object, confirm column present / renamed / absent. Build summary table.
6. **Deploy phase** (skipped if `--no-deploy` or any verify failure). Deploy each node in topo order. Continue on deploy failure; collect errors for summary.
7. **Summary.** Print table: object | edge type | action | save | verify | deploy. Exit 0 / 1.

### Why two phases for save/deploy

Intermediate-state deploys would fail because `--allow-missing-dependencies` only suppresses save-time errors. Deploy needs the chain consistent. So: save the whole chain first, verify, then deploy from sources outward.

### Failure handling

- **Save fails on node N:** continue with remaining nodes (so user sees full picture). Skip deploy phase. Print backup path.
- **Verify fails on node N:** skip deploy phase. Print backup path.
- **Deploy fails on node N:** continue deploying the rest. Print failed nodes; user can re-deploy manually from the DSP UI.

---

## Permissions

Update `.claude/settings.json`:

```json
{
  "permissions": {
    "allow": [
      "Bash(node:*)",
      "Bash(node --env-file=.env *)",
      "Bash(node skills/*)",
      "Bash(git ls-files:*)",
      "Bash(git ls-tree:*)",
      "Bash(git show:*)",
      "Bash(git log:*)",
      "Bash(git diff:*)",
      "Bash(git status)",
      "Bash(git add:*)",
      "Bash(git commit:*)",
      "Bash(git checkout:*)",
      "Bash(git merge:*)",
      "Bash(grep:*)",
      "Bash(find:*)",
      "Bash(ls:*)",
      "Bash(cat:*)",
      "Bash(head:*)",
      "Bash(tail:*)",
      "Bash(mkdir:*)",
      "Bash(rm:*)",
      "Read(./**)",
      "Write(./**)",
      "Edit(./**)"
    ]
  }
}
```

`Bash(node:*)` covers all node invocations regardless of flags or args, so future skills and ad-hoc `.mjs` scripts are auto-approved without further settings edits.

---

## Documentation Updates

- **`docs/claude-memory/analysis_guide.md`** — new section "Step 7: Cascade modifications across a chain" with the canary example.
- **`docs/claude-memory/known_limitations.md`** — remove "no view-to-view cascade", add "SQL views: cascade skills warn and skip".
- Each new skill gets a `skill.md` matching the existing pattern (description, usage, parameters, examples, notes).

---

## Testing

### Smoke test on canary

Use `SAP_FIN_CS_IL_I_CNSLDTNSGMTHIERELIM`:

1. `impact-analysis --name SAP_FIN_CS_IL_I_CNSLDTNSGMTHIERELIM --cache` — build graph.
2. `propagate-columns --start SAP_FIN_CS_IL_I_CNSLDTNSGMTHIERELIM --columns "_TMP_TEST_COL:cds.String:10:Tmp" --dry-run --cache` — print plan.
3. `add-columns-to-table --name <fact-table-in-chain> --columns "_TMP_TEST_COL:cds.String:10:Tmp"` — seed.
4. `propagate-columns --start <fact-table-in-chain> --columns "_TMP_TEST_COL:cds.String:10:Tmp" --cache` — cascade.
5. `remove-column-cascade --start <fact-table-in-chain> --column _TMP_TEST_COL --cache` — cleanup.

### Unit tests (optional, gated on lib complexity)

Only if `_lib/graph.js` accumulates non-trivial logic, add a `node:test` file with fixture CSN to verify:
- Topological order on a known graph
- Edge-type classification (direct vs association vs sql vs join)
- Node-count guard

### Acceptance criteria

- Each new skill passes its `--dry-run` against the canary chain without errors.
- Permission settings update eliminates approval prompts for routine `node skills/*` runs.
- The smoke test sequence completes end-to-end with all ✓ in the summary.
- Documentation updates are committed alongside the skills.

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Hidden circular reference in graph causes BFS to loop | BFS already uses a visited set in `impact-analysis`; reuse it via `_lib/graph.js`. |
| Deploy fails mid-chain leaving inconsistent state | Two-phase save/deploy + per-node deploy errors collected; backup path always printed. |
| 50-node guard too strict for real chains | `--force` flag bypass; can adjust threshold after seeing real-world chain sizes. |
| `_lib/` import paths break on Windows shells | Use ESM relative imports (`../_lib/graph.js`); already standard in the project. |
| SQL views in the middle of a chain block propagation | Skill prints the SQL node and stops there; user handles manually. Documented behavior. |

---

## Out of Scope (Explicit)

- SQL-view editing (cascade skills warn and skip; flagged limitation).
- Cross-space cascades.
- Auto-rollback on failure.
- Bulk creation across unrelated objects.
- True graph diff between two cache snapshots (would be useful but is a separate feature).
