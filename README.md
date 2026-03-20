# SAP Datasphere CLI Skills

Natural language interface for SAP Datasphere artifact creation using Claude Code and the official Datasphere CLI.

## Features

- **Natural Language Processing**: Create Datasphere artifacts using plain English descriptions
- **Six Artifact Types**: Local Tables, Views, Analytic Models, Data Flows, Replication Flows, Transformation Flows
- **Complex Model Support**: Automatically handle dimension associations, measure definitions, and business layer configurations
- **CLI Integration**: Built on SAP's official `@sap/datasphere-cli` package
- **Reverse Engineering**: Learn artifact formats by analyzing existing Datasphere objects

## Prerequisites

- Node.js (v14 or higher)
- SAP Datasphere tenant with OAuth 2.0 client configured
- Claude Code CLI

## Installation

1. Clone the repository:
```bash
git clone https://github.com/yuyonggang/dsp-cli.git
cd dsp-cli
```

2. Install dependencies:
```bash
npm install
```

3. Configure environment variables:
```bash
cp .env.example .env
```

Edit `.env` with your Datasphere credentials:
```
DATASPHERE_HOST=https://your-tenant.datasphere.cloud.sap
CLIENT_ID=your_client_id
CLIENT_SECRET=your_client_secret
AUTHORIZATION_URL=https://your-tenant.authentication.sap.hana.ondemand.com/oauth/authorize
TOKEN_URL=https://your-tenant.authentication.sap.hana.ondemand.com/oauth/token
```

## OAuth 2.0 Configuration

Configure an OAuth client in your Datasphere tenant:

1. Navigate to: **System** → **Administration** → **App Integration**
2. Create new OAuth 2.0 client:
   - **Authorization Grant**: Authorization Code
   - **Redirect URI**: `http://localhost:8080/`
   - **Token Lifetime**: 3600 seconds (recommended)
3. Note the Client ID and Client Secret for your `.env` file

## Skills Reference

### create-local-table

Creates a local table in Datasphere.

**Syntax:**
```bash
/create-local-table --name TABLE_NAME --columns COLUMN_DEFINITIONS [--space SPACE_ID] [--label LABEL] [--dimension]
```

**Column Format:** `NAME:TYPE:LENGTH[:SCALE][:key][:required]`

**Example:**
```bash
# Simple table
/create-local-table --name CUSTOMER --columns ID:String:10:key,NAME:String:100,EMAIL:String:100

# With Decimal (use colon for precision:scale, e.g., 15:2)
/create-local-table --name SALES --columns ORDER_ID:String:10:key,AMOUNT:Decimal:15:2:required

# Dimension table
/create-local-table --name DIM_CUSTOMER --columns ID:String:10:key,NAME:String:100 --dimension
```

**Supported Types:** `String`, `Integer`, `Decimal`, `Date`, `DateTime`, `Boolean`

---

### create-view

Creates a view based on an existing table or view. Supports creating graphical views with dimension associations.

**Syntax:**
```bash
/create-view --name VIEW_NAME --source SOURCE_NAME [--columns COLUMNS] [--dimensions DIMENSIONS] [--space SPACE_ID] [--label LABEL]
```

**Example:**
```bash
# Simple view
/create-view --name V_CUSTOMER --source CUSTOMER --columns ID,NAME

# Graphical view with dimensions (use semicolon to separate multiple dimensions)
/create-view --name SALES_FACT_VW --source SALES_FACT --dimensions "CUSTOMER_ID:DIM_CUSTOMER:ID;PRODUCT_ID:DIM_PRODUCT:ID"
```

---

### create-analytic-model

Creates an analytic model with dimension associations.

**Syntax:**
```bash
/create-analytic-model --name MODEL_NAME --source SOURCE_NAME [--measures MEASURES] [--dimensions DIMENSIONS] [--space SPACE_ID] [--label LABEL]
```

**Measures Format:** `COLUMN:AGGREGATION` (comma-separated)

**Aggregations:** `sum`, `avg`, `min`, `max`, `count`

**Dimensions Format:** `FK_COLUMN:DIM_TABLE:JOIN_KEY:ATTR1,ATTR2` (semicolon-separated for multiple dimensions)

**Example:**
```bash
/create-analytic-model --name AM_SALES \
  --source SALES_FACT \
  --measures AMOUNT:sum,QUANTITY:sum \
  --dimensions CUSTOMER_ID:DIM_CUSTOMER:ID:NAME,CITY;PRODUCT_ID:DIM_PRODUCT:ID:NAME,CATEGORY
```

---

### create-data-flow

Creates a data flow for data transformation pipelines.

**Syntax:**
```bash
/create-data-flow --name FLOW_NAME --source SOURCE_NAME --target TARGET_NAME [--space SPACE_ID] [--label LABEL]
```

---

### create-replication-flow

Creates a replication flow for data synchronization.

**Syntax:**
```bash
/create-replication-flow --name FLOW_NAME --source SOURCE_NAME --target TARGET_NAME [--space SPACE_ID] [--label LABEL]
```

---

### create-transformation-flow

Creates a transformation flow with custom logic.

**Syntax:**
```bash
/create-transformation-flow --name FLOW_NAME --source SOURCE_NAME --target TARGET_NAME [--space SPACE_ID] [--label LABEL]
```

## Natural Language Usage

Instead of memorizing command syntax, describe your requirements in plain English:

**Example 1: Simple Table**
```
"Create a customer table with ID, name, and email. ID is the key."
```

**Example 2: Multi-Step Data Model**
```
"Create a sales analysis data model.

First, make a sales fact table with order number, customer ID, product ID, and amount.
Then make a customer dimension table with ID, name, and city.
Next, make a product dimension table with ID, name, and category.
Then make a fact view based on the sales fact table, linking these two dimensions.
Finally, make an analytic model based on the fact view with amount sum as the measure."
```

Claude Code will automatically:
1. Parse your requirements
2. Determine the appropriate Skills to invoke
3. Generate the correct command parameters
4. Execute the Skills in the correct sequence

## Project Structure

```
dsp-cli/
├── skills/
│   ├── create-local-table/
│   │   ├── create-local-table.js
│   │   └── skill.md
│   ├── create-view/
│   ├── create-analytic-model/
│   ├── create-data-flow/
│   ├── create-replication-flow/
│   └── create-transformation-flow/
├── .env.example
├── package.json
├── README.md
└── README_CN.md
```

Each skill directory contains:
- **`*.js`**: Skill implementation using Datasphere CLI
- **`skill.md`**: Claude Code skill definition and documentation

## Security Considerations

- Never commit `.env` files or credentials to version control
- Use OAuth 2.0 authorization_code flow for production environments
- Store sensitive configuration in environment variables
- The `.gitignore` file excludes `.env`, `secrets.json`, and `tests-private/`

## Technical Details

### CDS and CSN Format

Skills generate artifacts in CSN (Core Schema Notation) format, the JSON representation of CDS (Core Data Services) models. The format is learned by:

1. Creating reference artifacts manually in Datasphere UI
2. Reading the artifact structure via CLI: `datasphere objects views read --name ARTIFACT_NAME`
3. Analyzing the JSON structure to identify required fields and patterns
4. Generating new artifacts based on these templates

### Graphical View uiModel

For graphical views with dimension associations, the `editorSettings.uiModel` structure requires careful handling:

- **Data structures** (`DimensionNode`, `Association`, `ElementMapping`) must be generated for each dimension
- **Diagram symbols** (`EntitySymbol`, `AssociationSymbol`) for dimensions should **NOT** be generated
- SAP Datasphere auto-generates visual symbols when the view is opened in the graphical editor
- Generating partial symbols (e.g., `EntitySymbol` without `AssociationSymbol`) causes display issues

## Limitations

- Skills are optimized for standard modeling patterns
- Complex business logic may require manual adjustments
- UI validation errors may occur for edge cases not covered by reference models
- Recommended workflow: start with simple artifacts, gradually increase complexity

## Contributing

This project was developed using Claude Code for AI-assisted development. Contributions are welcome:

1. Test Skills with your Datasphere tenant
2. Report issues or edge cases
3. Submit pull requests with improvements
4. Share additional artifact templates

## Support

For issues related to:
- **Skills**: Open an issue on GitHub
- **Datasphere CLI**: Refer to SAP official documentation
- **Claude Code**: Refer to Anthropic documentation
