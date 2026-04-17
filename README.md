# SAP Datasphere CLI Skills

Natural language interface for SAP Datasphere artifact creation using Claude Code and the official Datasphere CLI.

## Features

- **Natural Language Processing**: Create and manage Datasphere artifacts using plain English descriptions
- **16 Skills**: Create, inspect, modify, analyze, and export Datasphere objects
- **Complex Model Support**: Automatically handle dimension associations, measure definitions, and business layer configurations
- **Impact Analysis**: Full dependency graph traversal with column gap detection
- **Token Caching**: Efficient OAuth token reuse - authenticate once, work for hours
- **CLI Integration**: Built on SAP's official `@sap/datasphere-cli` package
- **Reverse Engineering**: Learn artifact formats by analyzing existing Datasphere objects

## How It Works

This project provides a three-layer architecture for interacting with SAP Datasphere:

```
╔═══════════════════════════════════════════════════════════════════╗
║ YOU SAY                                                           ║
║ "Create a customer dimension table with ID, name, and city"     ║
╚═══════════════════════════════════════════════════════════════════╝
                              ↓
╔═══════════════════════════════════════════════════════════════════╗
║ SKILLS TRANSLATE TO                                               ║
║ /create-local-table --name DIM_CUSTOMER                          ║
║                     --columns ID:String:10:key,NAME:String:100   ║
╚═══════════════════════════════════════════════════════════════════╝
                              ↓
╔═══════════════════════════════════════════════════════════════════╗
║ CLI EXECUTES                                                      ║
║ datasphere objects local-tables create                            ║
║                --host ... --space ... --file-path table.json      ║
╚═══════════════════════════════════════════════════════════════════╝
                              ↓
╔═══════════════════════════════════════════════════════════════════╗
║ RESULT                                                            ║
║ ✓ Table created in SAP Datasphere                                ║
╚═══════════════════════════════════════════════════════════════════╝
```

**Benefits of this approach:**
- **Ease of use**: Natural language instead of complex JSON schemas
- **Flexibility**: Use natural language for exploration, slash commands for precision
- **Official integration**: Built on SAP's supported CLI, not custom API calls
- **Learning tool**: Inspect generated CSN to understand Datasphere's data model format

## Getting Started

### Prerequisites

- Node.js (v20 or higher)
- SAP Datasphere tenant with OAuth 2.0 client configured
- Claude Code (CLI, Desktop, or Web)

### Installation

1. **Clone the repository:**
```bash
git clone https://github.com/yuyonggang/dsp-cli.git
cd dsp-cli
```

2. **Install dependencies:**
```bash
npm install
```

3. **Configure environment variables:**
```bash
cp .env.example .env
```

Edit `.env` with your Datasphere credentials:
```
DATASPHERE_HOST=https://your-tenant.eu10.hcs.cloud.sap
CLIENT_ID=your-client-id
CLIENT_SECRET=your-client-secret
SPACE=YOUR_SPACE_ID
```

**Note:** OAuth endpoints are automatically discovered via OpenID Connect - no manual configuration needed.

### OAuth 2.0 Setup

Configure an OAuth client in your Datasphere tenant:

1. Navigate to: **System** → **Administration** → **App Integration**
2. Create new OAuth 2.0 client:
   - **Authorization Grant**: Authorization Code
   - **Redirect URI**: `http://localhost:8080/`
   - **Token Lifetime**: 3600 seconds (recommended)
3. Copy the Client ID and Client Secret to your `.env` file

See the [Authentication Guide](docs/authentication-guide.md) for detailed setup instructions and troubleshooting.

### First Use

Create your first table using natural language:
```
"Create a customer table with ID, name, and email. ID is the key."
```

Claude Code will automatically generate and execute the appropriate commands. On first run, your browser will open for OAuth authorization - subsequent runs will use cached tokens (valid for 1 hour).

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

**Tip**: Use series numbers (001, 002, 003) to avoid naming conflicts when creating multiple test models. See the [Best Practices guide](docs/best-practices.md) for details.

**When to use slash commands vs natural language:**
- **Natural language**: Multi-step workflows, exploratory modeling, quick prototypes
- **Slash commands**: Precise control over parameters, repeatable single operations

## Skills Reference

### Creation Skills

#### create-local-table

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

#### create-view

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

#### create-analytic-model

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

#### create-model

Orchestrates full data model creation in a single command: dimension tables, fact table, view with associations, and analytic model.

**Syntax:**
```bash
/create-model --series NNN [--fact-name NAME] [--fact-columns COLS] [--dimensions SPEC] [--view-name NAME] [--model-name NAME] [--label LABEL] [--space SPACE_ID]
```

**Dimensions Format:** `DIM_TABLE:FK_COL:JOIN_KEY:ATTR1,ATTR2` (semicolon-separated for multiple)

**Example:**
```bash
/create-model --series 001 \
  --fact-name SALES_FACT_001 \
  --fact-columns "ORDER_ID:String:10:key,CUSTOMER_ID:String:10,AMOUNT:Decimal:15:2" \
  --dimensions "DIM_CUSTOMER_001:CUSTOMER_ID:ID:NAME,CITY;DIM_PRODUCT_001:PRODUCT_ID:ID:NAME,CATEGORY" \
  --view-name SALES_VW_001 \
  --model-name AM_SALES_001
```

---

#### create-data-flow

Creates a data flow for data transformation pipelines.

**Syntax:**
```bash
/create-data-flow --name FLOW_NAME --source SOURCE_NAME --target TARGET_NAME [--space SPACE_ID] [--label LABEL]
```

---

#### create-replication-flow

Creates a replication flow for data synchronization.

**Syntax:**
```bash
/create-replication-flow --name FLOW_NAME --source SOURCE_NAME --target TARGET_NAME [--space SPACE_ID] [--label LABEL]
```

---

#### create-transformation-flow

Creates a transformation flow with custom logic.

**Syntax:**
```bash
/create-transformation-flow --name FLOW_NAME --source SOURCE_NAME --target TARGET_NAME [--space SPACE_ID] [--label LABEL]
```

### Modification Skills

---

#### add-columns-to-view

Adds columns to an existing graphical view, keeping it in Graphical View Builder mode.

**Syntax:**
```bash
/add-columns-to-view --name VIEW_NAME --columns COLUMN_DEFS [--space SPACE_ID] [--insert-before COL] [--no-deploy]
```

**Column Format:** `NAME:TYPE:LENGTH:LABEL` (semicolon-separated)

**Example:**
```bash
/add-columns-to-view --name MY_VIEW \
  --columns "NEW_COL:cds.String:10:New Column;AMOUNT:cds.Decimal:15:Amount"
```

---

#### rename-column

Renames a column in a view and cascades the rename to all dependent analytic models.

**Syntax:**
```bash
/rename-column --object VIEW_NAME --old-name OLD_COL --new-name NEW_COL [--space SPACE_ID]
```

**Example:**
```bash
/rename-column --object SALES_VW_001 --old-name CUST_ID --new-name CUSTOMER_ID
```

---

#### remove-column

Removes a column from a view and cascades the removal to all dependent analytic models.

**Syntax:**
```bash
/remove-column --object VIEW_NAME --column COL_NAME [--space SPACE_ID]
```

**Example:**
```bash
/remove-column --object SALES_VW_001 --column LEGACY_CODE
```

### Inspection & Analysis Skills

---

#### list-objects

Lists all objects of a given type in a Datasphere space.

**Syntax:**
```bash
/list-objects [--type TYPE] [--space SPACE_ID]
```

**Types:** `table`, `view`, `analytic-model`, `data-flow`, `replication-flow`, `transformation-flow`, `all`

**Example:**
```bash
/list-objects --type view
```

---

#### read-object

Reads and displays the definition of an existing Datasphere object.

**Syntax:**
```bash
/read-object --name OBJECT_NAME --type TYPE [--space SPACE_ID] [--raw]
```

**Example:**
```bash
/read-object --name SALES_VW_001 --type view
```

---

#### describe-model

Traverses the full dependency chain of an analytic model or view and prints a summary.

**Syntax:**
```bash
/describe-model --name MODEL_NAME [--space SPACE_ID]
```

**Example:**
```bash
/describe-model --name AM_SALES_001
```

---

#### find-dependents

Finds all views and analytic models that reference a given table or view.

**Syntax:**
```bash
/find-dependents --name TABLE_OR_VIEW [--space SPACE_ID]
```

**Example:**
```bash
/find-dependents --name SALES_FACT_001
```

---

#### impact-analysis

Builds a full dependency graph in a single scan and traverses it to show the complete impact chain. Optionally detects missing columns in downstream objects.

**Syntax:**
```bash
/impact-analysis --name OBJECT_NAME [--space SPACE_ID] [--direction downstream|upstream|both] [--columns col1,col2] [--cache] [--refresh]
```

**Example:**
```bash
/impact-analysis --name MY_SOURCE_TABLE --direction downstream --columns NEW_COL --cache
```

### Lifecycle Skills

---

#### export-model

Exports the full CSN definitions of a data model and all its dependencies to local JSON files.

**Syntax:**
```bash
/export-model --name MODEL_NAME [--space SPACE_ID] [--output-dir PATH]
```

**Example:**
```bash
/export-model --name AM_SALES_001 --output-dir ./backups/sales-model
```

## Documentation

- **[Authentication Guide](docs/authentication-guide.md)** - OAuth setup, token caching, and troubleshooting
- **[Best Practices](docs/best-practices.md)** - Series numbering, workflows, and natural language usage
- **[Workflow Guide](docs/claude-memory/workflow_guide.md)** - Proven patterns with working command examples

## Project Structure

```
dsp-cli/
├── docs/
│   ├── authentication-guide.md    # OAuth, token caching, troubleshooting
│   ├── best-practices.md          # Series numbering, workflows, patterns
│   └── claude-memory/             # Proven workflows and reference links
├── skills/
│   ├── create-local-table/        # Local tables (fact or dimension)
│   ├── create-view/               # Graphical views with associations
│   ├── create-analytic-model/     # Analytic models with measures
│   ├── create-model/              # Full model orchestrator (dims + fact + view + AM)
│   ├── create-data-flow/
│   ├── create-replication-flow/
│   ├── create-transformation-flow/
│   ├── add-columns-to-view/       # Add columns to existing graphical views
│   ├── rename-column/             # Rename column + cascade to analytic models
│   ├── remove-column/             # Remove column + cascade to analytic models
│   ├── list-objects/              # List all objects of a type in a space
│   ├── read-object/               # Read and pretty-print any object definition
│   ├── describe-model/            # Traverse full model chain (AM -> view -> fact -> dims)
│   ├── find-dependents/           # Find all views/AMs referencing a table or view
│   ├── impact-analysis/           # Full recursive dependency graph + column gap analysis
│   └── export-model/              # Export full model chain to local JSON files
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
