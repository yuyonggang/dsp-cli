# SAP Datasphere CLI Skills

Natural language interface for SAP Datasphere artifact creation using Claude Code and the official Datasphere CLI.

## Features

- **Natural Language Processing**: Create Datasphere artifacts using plain English descriptions
- **Six Artifact Types**: Local Tables, Views, Analytic Models, Data Flows, Replication Flows, Transformation Flows
- **Complex Model Support**: Automatically handle dimension associations, measure definitions, and business layer configurations
- **Token Caching**: Efficient OAuth token reuse - authenticate once, work for hours
- **CLI Integration**: Built on SAP's official `@sap/datasphere-cli` package
- **Reverse Engineering**: Learn artifact formats by analyzing existing Datasphere objects

## How It Works

This project provides a three-layer architecture for interacting with SAP Datasphere:

```
┌─────────────────────────────────────────────────────────────────────┐
│   Layer 1: Natural Language                                         │
│   Claude interprets plain English descriptions                      │
│                                                                      │
│   "Create a customer dimension table with ID, name, and city"      │
└──────────────────────────────┬──────────────────────────────────────┘
                               ↓
┌─────────────────────────────────────────────────────────────────────┐
│   Layer 2: Skills (Slash Commands)                                  │
│   Parse requirements → Generate CSN → Execute with parameters       │
│                                                                      │
│   /create-local-table --name DIM_CUSTOMER                          │
│                       --columns ID:String:10:key,NAME:String:100    │
└──────────────────────────────┬──────────────────────────────────────┘
                               ↓
┌─────────────────────────────────────────────────────────────────────┐
│   Layer 3: Datasphere CLI                                           │
│   Official SAP package handles OAuth, API calls, token management   │
│                                                                      │
│   datasphere objects local-tables create                            │
│                      --host ... --space ... --file-path table.json  │
└──────────────────────────────┬──────────────────────────────────────┘
                               ↓
┌─────────────────────────────────────────────────────────────────────┐
│   Layer 4: SAP Datasphere API                                       │
│   Artifacts created in your Datasphere tenant                       │
│                                                                      │
│   ✓ Table created in tenant                                         │
└─────────────────────────────────────────────────────────────────────┘
```

**Benefits of this approach:**
- ✅ **Ease of use**: Natural language instead of complex JSON schemas
- ✅ **Flexibility**: Use natural language for exploration, slash commands for precision
- ✅ **Official integration**: Built on SAP's supported CLI, not custom API calls
- ✅ **Learning tool**: Inspect generated CSN to understand Datasphere's data model format

## Quick Start

1. **Clone and install:**
```bash
git clone https://github.com/yuyonggang/dsp-cli.git
cd dsp-cli
npm install
```

2. **Configure credentials:**
```bash
cp .env.example .env
# Edit .env with your Datasphere host, client ID, and secret
```

3. **Create your first table using natural language:**
```
"Create a customer table with ID, name, and email. ID is the key."
```

Claude Code will automatically generate and execute the appropriate commands. On first run, your browser will open for OAuth authorization - subsequent runs will use cached tokens.

## Prerequisites

- Node.js (v14 or higher)
- SAP Datasphere tenant with OAuth 2.0 client configured
- Claude Code (CLI, Desktop, or Web)

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
DATASPHERE_HOST=https://your-tenant.eu10.hcs.cloud.sap
CLIENT_ID=your_client_id
CLIENT_SECRET=your_client_secret
```

**Note:** OAuth endpoints (authorization and token URLs) are automatically discovered via OpenID Connect. No manual configuration needed.

See the [Authentication Guide](docs/authentication-guide.md) for detailed setup instructions and troubleshooting.

## Usage

### Natural Language (Recommended)

The primary way to use this project is through **natural language descriptions**. Describe what you want to create, and Claude Code will handle the rest.

**Example 1: Simple Table**
```
"Create a customer table with ID, name, and email. ID is the key."
```

**Example 2: Complete Data Model**
```
"Create a sales analysis data model with series 001.

First, make a sales fact table with order number, customer ID, product ID, and amount.
Then make customer and product dimension tables.
Create a fact view linking these dimensions.
Finally, make an analytic model with amount sum as the measure."
```

**What Claude Code does automatically:**
1. Parse your requirements
2. Determine the appropriate Skills to invoke
3. Generate the correct command parameters (including series numbers)
4. Execute the Skills in the correct sequence
5. Show task progress for multi-step operations

💡 **Tip**: Use series numbers (001, 002, 003) to avoid naming conflicts when creating multiple test models. See the [Best Practices guide](docs/best-practices.md) for details.

### Skill Command Reference

You can also invoke skills directly using slash commands if you prefer explicit control over parameters.

<details>
<summary><strong>Click to expand command reference</strong></summary>

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

</details>

**When to use slash commands vs natural language:**
- **Natural language**: Multi-step workflows, exploratory modeling, quick prototypes
- **Slash commands**: Precise control over parameters, repeatable single operations

## OAuth 2.0 Configuration

Configure an OAuth client in your Datasphere tenant:

1. Navigate to: **System** → **Administration** → **App Integration**
2. Create new OAuth 2.0 client:
   - **Authorization Grant**: Authorization Code
   - **Redirect URI**: `http://localhost:8080/`
   - **Token Lifetime**: 3600 seconds (recommended)
3. Note the Client ID and Client Secret for your `.env` file

### Authentication Flow

- **First execution**: Opens browser for OAuth authorization
- **Subsequent executions**: Uses cached tokens (valid for 1 hour)
- **Token refresh**: Automatically refreshes using refresh_token when expired
- **Token cache location**: `~/.@sap/datasphere-cli/.cache/secrets.json`

For detailed information about authentication, token caching, and troubleshooting, see the [Authentication Guide](docs/authentication-guide.md).

## Documentation

- 📖 **[Authentication Guide](docs/authentication-guide.md)** - OAuth setup, token caching, and troubleshooting
- 🎯 **[Best Practices](docs/best-practices.md)** - Series numbering, workflows, and natural language usage

## Project Structure

```
dsp-cli/
├── docs/
│   ├── authentication-guide.md   # OAuth, token caching, troubleshooting
│   └── best-practices.md         # Series numbering, workflows, patterns
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
└── README.md
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
