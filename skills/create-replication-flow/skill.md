# create-replication-flow

Create a Replication Flow in SAP Datasphere using CLI

## Description

Creates a replication flow in the specified Datasphere space. Replication flows are used to replicate data from source views/tables to target tables in Datasphere. The skill automatically reads the source object structure and generates the proper replication flow definition.

## Usage

```
/create-replication-flow --name <flow-name> --source <source-view> --target <target-table> --target-connection <connection> --space <space-id>
```

## Parameters

- `--name` (required): Technical name of the replication flow (e.g., `RF_SALES_REPLICATION`)
- `--source` (required): Source table or view name in Datasphere
- `--target` (required): Target table name
- `--target-connection` (optional): Target connection ID (required if replicating to external system)
- `--source-connection` (optional): Source connection ID (default: `$DWC` for internal)
- `--target-container` (optional): Target container path (default: `/DWC_GLOBAL`)
- `--space` (optional): Space ID (default: `$SPACE` from `.env`)
- `--label` (optional): User-friendly label for the flow
- `--load-type` (optional): Load type - `INITIAL` or `DELTA` (default: `INITIAL`)
- `--truncate` (optional): Truncate target before load (flag, default: false)

## Examples

### Example 1: Simple replication from view to table
```
/create-replication-flow --name RF_CUSTOMER_REPL --source TEST_VIEW_YYG --target TARGET_TABLE_RF_TEST --target-connection MY_HANA_CONN --space YOUR_SPACE_ID
```

### Example 2: With delta load and truncate
```
/create-replication-flow --name RF_ORDERS_DELTA --source ORDERS_VIEW --target ORDERS_TABLE --target-connection HANA_CONN --load-type DELTA --truncate
```

### Example 3: Internal replication with custom label
```
/create-replication-flow --name RF_PRODUCTS --source PRODUCT_VIEW --target PRODUCT_TABLE --label "Product Replication Flow"
```

## Implementation

The skill will:
1. Parse the parameters
2. Authenticate to Datasphere using OAuth
3. **Read the source object structure** (view or table) to get column definitions
4. **Generate vTypes** dynamically based on source column types (e.g., `$DYNAMIC.string_10`, `$DYNAMIC.decimal_15_2`)
5. **Generate complete column definitions** for both source and target objects
6. **Create replication flow definition** using the correct `replicationflows` format
7. Save definition to temporary file
8. Create the replication flow using `objects replication-flows create`
9. Verify the flow was created
10. Return the flow details

## Output

Returns the created replication flow definition and confirmation message. The definition is also saved to `/tmp/replication-flow-<name>.json` for reference.

## Notes

- Replication flow names must be unique within the space
- The skill automatically reads source object structure to generate proper column definitions
- **The flow is created but NOT automatically deployed/run** - you need to deploy and execute it separately in Datasphere UI
- Target connection must be configured in Datasphere beforehand (if replicating to external system)
- For internal replication, source connection defaults to `$DWC`
- Target container defaults to `/DWC_GLOBAL`

## Error Handling

- If flow already exists, returns error with existing flow details
- If authentication fails, provides login instructions
- If source object cannot be read, will use simplified structure (may fail at deployment)
- If target connection doesn't exist, returns error with troubleshooting tips
- If space doesn't exist, lists available spaces

## Troubleshooting

### Flow created but deployment fails
- Verify source view/table exists and is accessible
- Check target connection is configured and accessible
- Ensure target table structure matches source (or will be auto-created)
- Verify you have permissions to create replication flows in the space

### FailedToObtainObjectName error
- This typically means the JSON format is incorrect
- The skill now uses the correct `replicationflows` format (learned from actual working examples)
- Ensure source object exists and can be read

## Format

Replication flows in Datasphere use a specific JSON structure (NOT CSN format):

```json
{
  "replicationflows": {
    "RF_NAME": {
      "kind": "sap.dis.replicationflow",
      "@EndUserText.label": "Label",
      "contents": {
        "description": "Description",
        "sourceSystem": [
          {
            "connectionId": "$DWC",
            "connectionType": "HANA",
            "container": "",
            "maxConnections": 10,
            "metadata": {}
          }
        ],
        "targetSystem": [
          {
            "connectionId": "TARGET_CONN_ID",
            "connectionType": "HANA",
            "container": "/DWC_GLOBAL",
            "maxConnections": 10,
            "metadata": {}
          }
        ],
        "vTypes": {
          "scalar": {
            "string_10": {
              "name": "string_10",
              "description": "String(10)",
              "vflow.type": "scalar",
              "template": "string",
              "value.length": 10
            }
          }
        },
        "replicationTasks": [
          {
            "name": "replicationtask1",
            "loadType": "INITIAL",
            "priority": 50,
            "truncate": false,
            "sourceObject": {
              "name": "SOURCE_VIEW",
              "definition": {
                "columns": [
                  {
                    "name": "ID",
                    "vflow.type": "scalar",
                    "vtype-ID": "$DYNAMIC.string_10",
                    "key": true,
                    "businessName": "ID",
                    "metadata": {}
                  }
                ],
                "keys": []
              },
              "metadata": {
                "type": "VIEW",
                "isDeltaDisabled": true
              },
              "businessName": "Source View"
            },
            "targetObject": {
              "name": "TARGET_TABLE",
              "definition": {
                "columns": [...]
              },
              "metadata": {
                "isNew": false
              }
            }
          }
        ],
        "replicationTaskSetting": {
          "hasSkipMappingCapability": true
        },
        "replicationFlowSetting": {},
        "deltaLoadTrigger": "ON_DELTA_INTERVAL"
      },
      "sources": {
        "SOURCE_VIEW": {
          "elements": {
            "ID": {}
          }
        }
      },
      "targets": {},
      "connections": {
        "TARGET_CONN_ID": {}
      }
    }
  }
}
```

### Key Structure Elements

1. **Top-level key**: `replicationflows` (lowercase, plural) - NOT `definitions` or `dataflows`
2. **kind**: `sap.dis.replicationflow` - Datasphere-specific, NOT a CSN standard type
3. **contents**: Complete replication configuration
4. **vTypes**: Dynamic type definitions using `$DYNAMIC.` prefix
   - `$DYNAMIC.string_10` for String(10)
   - `$DYNAMIC.decimal_15_2` for Decimal(15,2)
   - `$DYNAMIC.integer` for Integer
   - `com.sap.core.date` for Date
   - `com.sap.core.timestamp` for DateTime
5. **replicationTasks**: Array of tasks with complete source and target object definitions
6. **sources/targets/connections**: Additional metadata maps

## Limitations

- Delta replication requires source system to support change data capture (CDC)
- The skill creates flows in "undeployed" state - deployment must be done via UI or separate command
- Complex transformations are not supported - use Datasphere UI for advanced scenarios
- The skill reads source structure from views/tables - if source cannot be read, a simplified structure is used which may fail at deployment

## Learn More

- See `REPLICATION_FLOW_SUCCESS.md` for detailed format discovery process
- See `output/TEST_RL_TTG.json` for a complete working example
- The correct format was learned by analyzing actual working Replication Flows in Datasphere
