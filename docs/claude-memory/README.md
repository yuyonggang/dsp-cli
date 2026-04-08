# Claude Memory Documentation

This directory contains Claude Code memory files that document best practices, successful patterns, and user preferences for using the dsp-cli tools.

## Purpose

These files serve as:
- **Knowledge base** for creating Datasphere objects
- **Best practices** documentation
- **Working examples** that have been tested and verified
- **Usage patterns** for natural language interaction with Claude Code

## Files

### [MEMORY.md](MEMORY.md)
Index file that organizes all memory entries by type.

### [reference_successful_series_numbering.md](reference_successful_series_numbering.md)
**Complete workflow** for creating data models with series numbering.

Contains:
- ✅ Proven creation sequence (dimensions → fact → view → analytic model)
- ✅ Naming conventions with series numbers (001, 002, etc.)
- ✅ Working command examples
- ✅ Natural language input patterns
- ✅ Success factors and common pitfalls

**Use this as a reference** when creating complete data models with dimension associations.

### [user_series_numbering_preference.md](user_series_numbering_preference.md)
User preference for using simple numeric suffixes instead of timestamps.

## How to Use

### For Users
Reference these files when creating complex data models to follow proven patterns.

### For Claude Code
These files are automatically loaded by Claude Code's memory system to provide context-aware assistance.

### For Contributors
If you discover new patterns or improvements, update these files to share knowledge with others.

## Example Workflow

Based on the successful pattern documented here:

```bash
# 1. Create dimension tables with --dimension flag
node skills/create-local-table/create-local-table.js \
  --name DIM_CUSTOMER_001 \
  --columns "ID:String:10:key,NAME:String:100:required,CITY:String:50" \
  --dimension

node skills/create-local-table/create-local-table.js \
  --name DIM_PRODUCT_001 \
  --columns "ID:String:10:key,NAME:String:100:required,CATEGORY:String:50" \
  --dimension

# 2. Create fact table
node skills/create-local-table/create-local-table.js \
  --name SALES_FACT_001 \
  --columns "ORDER_ID:String:10:key,CUSTOMER_ID:String:10:required,PRODUCT_ID:String:10:required,AMOUNT:Decimal:15:2:required"

# 3. Create view with dimension associations
node skills/create-view/create-view.js \
  --name SALES_VW_001 \
  --source SALES_FACT_001 \
  --dimensions "CUSTOMER_ID:DIM_CUSTOMER_001:ID;PRODUCT_ID:DIM_PRODUCT_001:ID"

# 4. Create analytic model (auto-detects dimensions from view)
node skills/create-analytic-model/create-analytic-model.js \
  --name AM_SALES_001 \
  --source SALES_VW_001 \
  --measures "AMOUNT:sum"
```

## Naming Convention

All objects in a batch use the same series number:
- `SALES_FACT_001`, `DIM_CUSTOMER_001`, `AM_SALES_001` (first batch)
- `SALES_FACT_002`, `DIM_CUSTOMER_002`, `AM_SALES_002` (second batch)

This avoids naming conflicts during iterative development and testing.

## Safety Note

These files contain **no sensitive information**:
- ✅ No credentials or API keys
- ✅ No host URLs or personal information
- ✅ Only technical documentation and examples
- ✅ Safe to share and version control

---

*These files were generated and validated through successful test runs on 2026-04-08.*
