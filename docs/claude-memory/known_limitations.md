# Known Limitations

This document lists current limitations, unsupported features, and known issues. Check here before attempting something that might not work yet.

---

## Skills That Don't Exist Yet

### No delete-object skill
There is no skill to delete objects from Datasphere. A `delete-object` skill was planned but removed before completion. To delete objects, use the SAP Datasphere UI directly.

### No deploy/undeploy skill
The mutation skills (`rename-column`, `remove-column`) save with `--no-deploy`. There is no skill to trigger deployment programmatically. Deploy manually from the DSP UI after making changes.

### No bulk operations
Each skill operates on one object at a time. There is no batch mode for creating, updating, or deleting multiple objects in a single call. The `create-model` skill orchestrates multiple creations sequentially but is not a true bulk API.

---

## API and Connectivity

### Rate limiting (HTTP 429)
The Datasphere API enforces rate limits. When listing views in large spaces (500+), you may see `429 Too Many Requests` errors. The skills handle this gracefully by returning partial results, but some objects may be missed in a single run. Workaround: re-run the command or use `impact-analysis --cache` which retries with smaller page sizes.

### TLS version negotiation
The CLI attempts TLSv1.3 first and falls back to TLSv1.2. This produces `EPROTO` warnings in the console output on every connection. These are harmless and do not affect functionality.

### Token lifetime
OAuth tokens expire after 1 hour (default). Long-running operations like `impact-analysis` on very large spaces may hit token expiration mid-scan. If this happens, re-run the command — the `--force` flag on login will fetch a fresh token.

---

## Dependency Detection

### SQL views: limited pattern matching
For SQL views and table function views, `find-dependents` and `impact-analysis` extract dependencies by matching `FROM "TableName"` and `JOIN "TableName"` patterns in the SQL script. This means:

**Detected:**
- `FROM "MY_TABLE"`
- `LEFT JOIN "MY_TABLE"`
- `INNER JOIN "MY_TABLE"`

**Not detected:**
- Unquoted table names: `FROM MY_TABLE`
- CTEs / WITH clauses that alias tables
- Dynamic SQL or string concatenation
- Subqueries in WHERE clauses referencing different tables
- Cross-space references (`"OTHER_SPACE"."TABLE_NAME"`)

### Tables are leaf nodes
`impact-analysis` scans views and analytic models but not tables. Tables appear in the graph only when referenced by a view. If a table is not referenced by any view, it won't appear in the graph at all.

### Cross-space dependencies
Objects referencing tables in other spaces show as "unknown" nodes in the dependency graph. The analysis cannot follow references across space boundaries.

---

## View Modification

### Graphical views only
The `add-columns-to-view` skill only works with Graphical View Builder views (those with `uiModel` in editorSettings). SQL-mode views are not supported.

### uiModel synchronization is fragile
Graphical views store their visual layout in three locations that must stay in sync:
1. `definitions.elements` — CDS element definitions
2. `query.SELECT.columns` — the SELECT projection
3. `editorSettings.uiModel` — the graphical editor model (JSON string)

If `uiModel` is not updated when `definitions` and `query` change, DSP converts the view from Graphical mode to SQL mode. The `add-columns-to-view` skill handles this correctly, but ad-hoc scripts must update all three locations.

### No view type conversion
There is no skill to convert a SQL view to a Graphical view or vice versa.

---

## Object Creation

### Transformation flows may need adjustments
The `create-transformation-flow` skill generates a format that may vary across Datasphere versions. If creation fails, export a working transformation flow from the DSP UI using `read-object --raw` and compare the format.

### Analytic model dimension detection
The `create-analytic-model` skill auto-detects dimensions from the source view's associations. If the view has no associations defined, no dimensions will be created in the analytic model. Ensure the source view has associations set up before creating the AM.

### describe-model: verbose error output
When `describe-model` tries to read an object that doesn't exist at a particular type endpoint (e.g., looking for an AM as a view first), the SAP CLI dumps the full Axios error object to stdout. The skill still works correctly — the error is from the CLI's internal logging, not the skill code. The relevant user-facing message appears at the end.

---

## What Works Well

For balance, here's what is reliable and well-tested:

- **Creating complete data models** (dimensions -> fact -> view -> AM) using `create-model` or individual skills
- **Listing and reading objects** across all 6 object types
- **Impact analysis** with caching on spaces with 800+ objects
- **Column cascading** (rename/remove) across view -> AM dependencies
- **Adding columns to graphical views** idempotently
- **Dependency detection** for graphical views (simple refs, JOINs, associations)
- **Dependency detection** for SQL views (quoted FROM/JOIN patterns)

---

*Last updated: 2026-04-17*
