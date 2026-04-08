---
name: User Preference - Series Numbering for Models
description: User prefers simple numeric series suffixes (001, 002) not timestamps for batch object creation
type: user
---

User prefers simple numeric series numbers (001, 002, 003) as suffixes when creating batches of related Datasphere objects, rather than timestamps.

**Why:** Avoids naming conflicts when repeatedly creating similar data models for testing/development. Keeps names clean and readable.

**How to apply:**
- When user asks to create a complete data model, automatically assign a simple series number (001, 002, etc.)
- All objects in the same batch share the same series suffix
- Format: `OBJECTNAME_SERIESNUM` (e.g., SALES_FACT_001, DIM_CUSTOMER_001)
- Increment series number for each new batch (user can also specify)

**Example:**
First batch: SALES_FACT_001, DIM_CUSTOMER_001, AM_SALES_001
Second batch: SALES_FACT_002, DIM_CUSTOMER_002, AM_SALES_002

This approach is cleaner than timestamps (20260408_112923) and easier to reference.
