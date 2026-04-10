# Best Practices

This document outlines recommended patterns and workflows for creating SAP Datasphere objects using the CLI skills.

## Series Numbering Pattern

When creating multiple data models for testing or development, use **simple numeric series suffixes** to avoid naming conflicts.

### Naming Convention

Use the format: `OBJECT_TYPE_SERIESNUM`

**Examples:**
- `SALES_FACT_001` (fact table)
- `DIM_CUSTOMER_001` (dimension table)
- `DIM_PRODUCT_001` (dimension table)
- `SALES_VW_001` (view with associations)
- `AM_SALES_001` (analytic model)

### Key Rules

1. **Use simple numeric suffixes** (001, 002, 003...) instead of timestamps
2. **Same series number for entire batch** - all objects in one model creation use the same suffix
3. **Increment for each new batch**:
   - First batch: `*_001`
   - Second batch: `*_002`
   - Third batch: `*_003`

### Why This Pattern?

**Advantages:**
- ✅ Clean and readable names
- ✅ Avoids naming conflicts when repeatedly creating similar models
- ✅ Easy to identify related objects
- ✅ Simple to reference in commands

**Avoid:**
- ❌ Timestamps (e.g., `SALES_FACT_20260408_112923`) - too long and hard to read
- ❌ Random suffixes - difficult to track related objects

## Object Creation Sequence

When creating a complete analytical data model, follow this order:

### 1. Create Dimension Tables First

Dimension tables should be created with the `--dimension` flag:

```bash
node skills/create-local-table/create-local-table.js \
  --name DIM_CUSTOMER_001 \
  --columns "ID:String:10:key,NAME:String:100:required,CITY:String:50" \
  --dimension

node skills/create-local-table/create-local-table.js \
  --name DIM_PRODUCT_001 \
  --columns "ID:String:10:key,NAME:String:100:required,CATEGORY:String:50" \
  --dimension
```

### 2. Create Fact Table

Fact tables do **not** use the `--dimension` flag:

```bash
node skills/create-local-table/create-local-table.js \
  --name SALES_FACT_001 \
  --columns "ORDER_ID:String:10:key,CUSTOMER_ID:String:10:required,PRODUCT_ID:String:10:required,AMOUNT:Decimal:15:2:required"
```

### 3. Create View with Dimension Associations

Link the fact table to dimensions using the `--dimensions` parameter (semicolon-separated):

```bash
node skills/create-view/create-view.js \
  --name SALES_VW_001 \
  --source SALES_FACT_001 \
  --dimensions "CUSTOMER_ID:DIM_CUSTOMER_001:ID;PRODUCT_ID:DIM_PRODUCT_001:ID"
```

### 4. Create Analytic Model

The analytic model automatically detects dimensions from the view:

```bash
node skills/create-analytic-model/create-analytic-model.js \
  --name AM_SALES_001 \
  --source SALES_VW_001 \
  --measures "AMOUNT:sum"
```

## Natural Language Workflow

You can describe your requirements in natural language. Here's an example that works well:

```
Create a sales analysis data model.
First, make a sales fact table with order number, customer ID, product ID, and amount.
Then make customer and product dimension tables.
Create a fact view linking these dimensions.
Finally, make an analytic model with amount sum as the measure.
```

Claude will automatically:
- Apply the series numbering pattern
- Create objects in the correct order
- Set appropriate flags (--dimension, associations, etc.)
- Verify the creation results

### Task Progress Feedback

When working with Claude Code, you can request task progress updates for multi-step operations. This helps you track what's being done and see the status of each step.

**How to request progress tracking:**
```
Create a sales data model with series 003.
Show me the task progress as you work through each step.
```

**What you'll see:**
- ✅ Individual tasks for each operation (e.g., "Create DIM_CUSTOMER_003")
- ✅ Real-time status updates (pending → in_progress → completed)
- ✅ Clear indication of what's currently being worked on
- ✅ Overview of remaining steps

**Benefits:**
- Track progress during long-running operations
- Understand which step is currently executing
- Identify where issues occur if something fails
- Get visibility into complex multi-step workflows

## Expected Results

After following this workflow, you should have:

- ✅ All objects created successfully
- ✅ Analytic model correctly includes dimensions with attributes
- ✅ Dimension attributes use suffix naming (e.g., `NAME_CUSTOMER_ID`, `CATEGORY_PRODUCT_ID`)
- ✅ All objects use consistent series numbering

## Column Definition Format

When defining columns, use the format: `COLUMN_NAME:TYPE:PARAM1:PARAM2:MODIFIERS`

**Common Types:**
- `String:length` - e.g., `NAME:String:100`
- `Decimal:precision:scale` - e.g., `AMOUNT:Decimal:15:2`
- `Date` - e.g., `ORDER_DATE:Date`
- `Integer` - e.g., `QUANTITY:Integer`

**Modifiers:**
- `key` - Mark as primary key (automatically sets notNull)
- `required` - Mark as not null

**Examples:**
```bash
# Simple key column
ID:String:10:key

# Required text field
NAME:String:100:required

# Decimal with precision and scale
AMOUNT:Decimal:15:2:required

# Date field
CREATED_DATE:Date
```

## Troubleshooting

### Object Already Exists

If you encounter "object already exists" errors:

1. Check existing objects in the space
2. Use the next series number (e.g., if *_001 exists, use *_002)
3. Or delete the existing object first (if safe to do so)

### Dimension Not Detected in Analytic Model

Ensure:
- Dimension tables were created with `--dimension` flag
- View includes dimension associations via `--dimensions` parameter
- Analytic model sources from the view, not directly from the fact table

### Association Errors

Check that:
- Foreign key column names match in fact table and view
- Referenced dimension table exists
- Key column exists in dimension table
