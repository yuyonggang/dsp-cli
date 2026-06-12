---
name: DSP CLI Successful Pattern - Series Numbering
description: Proven workflow for creating complete data models with series numbers to avoid naming conflicts
type: reference
---

**Successful Pattern for Creating Complete Data Models with Series Numbers**

User successfully created a complete sales analysis data model using series number suffix (001) to avoid naming conflicts.

**Workflow that worked (2026-04-08):**

1. **Use simple numeric series suffix** (001, 002, 003...) not timestamps
2. **Same series number for entire batch** - all objects in one model creation use same suffix
3. **Naming convention**: `OBJECT_TYPE_SERIESNUM`
   - SALES_FACT_001 (fact table)
   - DIM_CUSTOMER_001 (dimension table)
   - DIM_PRODUCT_001 (dimension table)
   - SALES_VW_001 (view with associations)
   - AM_SALES_001 (analytic model)

**Correct Creation Sequence:**
1. Create dimension tables first (with --dimension flag)
2. Create fact table
3. Create view with dimension associations (--dimensions parameter)
4. Create analytic model from view (automatically detects dimensions)

**Natural Language Input that worked:**
```
Create a sales analysis data model.
First, make a sales fact table with order number, customer ID, product ID, and amount.
Then make customer and product dimension tables.
Create a fact view linking these dimensions.
Finally, make an analytic model with amount sum as the measure.
```

**Key Success Factors:**
- Simple numeric suffixes (not timestamps)
- Consistent naming across all objects in a batch
- Correct creation order (dimensions → fact → view → analytic model)
- Use view as source for analytic model (not direct table)

**Commands used:**
```bash
# Dimension tables with --dimension flag
node skills/create-local-table/create-local-table.js --name DIM_CUSTOMER_001 --columns "ID:String:10:key,NAME:String:100:required,CITY:String:50" --dimension

# Fact table (no --dimension flag)
node skills/create-local-table/create-local-table.js --name SALES_FACT_001 --columns "ORDER_ID:String:10:key,CUSTOMER_ID:String:10:required,PRODUCT_ID:String:10:required,AMOUNT:Decimal:15:2:required"

# View with associations (semicolon separator)
node skills/create-view/create-view.js --name SALES_VW_001 --source SALES_FACT_001 --dimensions "CUSTOMER_ID:DIM_CUSTOMER_001:ID;PRODUCT_ID:DIM_PRODUCT_001:ID"

# Analytic model (auto-detects dimensions from view)
node skills/create-analytic-model/create-analytic-model.js --name AM_SALES_001 --source SALES_VW_001 --measures "AMOUNT:sum"
```

**Result:**
- All 5 objects created successfully
- Analytic model correctly includes 2 dimensions with attributes
- Dimension attributes use suffix naming (e.g., NAME_CUSTOMER_ID, CATEGORY_PRODUCT_ID)
