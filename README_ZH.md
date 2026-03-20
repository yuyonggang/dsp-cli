# SAP Datasphere CLI Skills

使用 Claude Code 和官方 Datasphere CLI 的自然语言 Datasphere 对象创建接口。

## 功能特性

- **自然语言处理**：使用简单的中文或英文描述创建 Datasphere artifacts
- **六种 Artifact 类型**：本地表、视图、分析模型、数据流、复制流、转换流
- **复杂模型支持**：自动处理维度关联、度量定义和业务层配置
- **CLI 集成**：基于 SAP 官方 `@sap/datasphere-cli` 包构建
- **逆向工程**：通过分析现有 Datasphere 对象学习 artifact 格式

## 前置要求

- Node.js (v14 或更高版本)
- 已配置 OAuth 2.0 客户端的 SAP Datasphere 租户
- Claude Code CLI

## 安装

1. 克隆仓库：
```bash
git clone https://github.com/yuyonggang/dsp-cli.git
cd dsp-cli
```

2. 安装依赖：
```bash
npm install
```

3. 配置环境变量：
```bash
cp .env.example .env
```

编辑 `.env` 文件，填入你的 Datasphere 凭证：
```
DATASPHERE_HOST=https://your-tenant.datasphere.cloud.sap
CLIENT_ID=your_client_id
CLIENT_SECRET=your_client_secret
AUTHORIZATION_URL=https://your-tenant.authentication.sap.hana.ondemand.com/oauth/authorize
TOKEN_URL=https://your-tenant.authentication.sap.hana.ondemand.com/oauth/token
```

## OAuth 2.0 配置

在 Datasphere 租户中配置 OAuth 客户端：

1. 导航至：**System** → **Administration** → **App Integration**
2. 创建新的 OAuth 2.0 客户端：
   - **Authorization Grant**: Authorization Code
   - **Redirect URI**: `http://localhost:8080/`
   - **Token Lifetime**: 3600 秒（推荐）
3. 记录 Client ID 和 Client Secret 到 `.env` 文件

## Skills 参考

### create-local-table

在 Datasphere 中创建本地表。

**语法：**
```bash
/create-local-table --name TABLE_NAME --columns COLUMN_DEFINITIONS [--space SPACE_ID] [--label LABEL]
```

**列格式：** `NAME:TYPE:LENGTH[:SCALE][:key][:required]`

**示例：**
```bash
# 简单表
/create-local-table --name CUSTOMER --columns ID:String:10:key,NAME:String:100,EMAIL:String:100

# 带 Decimal（使用冒号分隔精度和小数位，如 15:2）
/create-local-table --name SALES --columns ORDER_ID:String:10:key,AMOUNT:Decimal:15:2:required

# 维度表
/create-local-table --name DIM_CUSTOMER --columns ID:String:10:key,NAME:String:100 --dimension
```

**支持的类型：** `String`, `Integer`, `Decimal`, `Date`, `DateTime`, `Boolean`

---

### create-view

基于现有表或视图创建视图。支持创建带维度关联的图形化视图。

**语法：**
```bash
/create-view --name VIEW_NAME --source SOURCE_NAME [--columns COLUMNS] [--dimensions DIMENSIONS] [--space SPACE_ID] [--label LABEL]
```

**示例：**
```bash
# 简单视图
/create-view --name V_CUSTOMER --source CUSTOMER --columns ID,NAME

# 带维度的图形化视图（使用分号分隔多个维度）
/create-view --name SALES_FACT_VW --source SALES_FACT --dimensions "CUSTOMER_ID:DIM_CUSTOMER:ID;PRODUCT_ID:DIM_PRODUCT:ID"
```

---

### create-analytic-model

创建带维度关联的分析模型。

**语法：**
```bash
/create-analytic-model --name MODEL_NAME --source SOURCE_NAME [--measures MEASURES] [--dimensions DIMENSIONS] [--space SPACE_ID] [--label LABEL]
```

**度量格式：** `COLUMN:AGGREGATION` (逗号分隔)

**聚合函数：** `sum`, `avg`, `min`, `max`, `count`

**维度格式：** `FK_COLUMN:DIM_TABLE:JOIN_KEY:ATTR1,ATTR2` (多个维度用分号分隔)

**示例：**
```bash
/create-analytic-model --name AM_SALES \
  --source SALES_FACT \
  --measures AMOUNT:sum,QUANTITY:sum \
  --dimensions CUSTOMER_ID:DIM_CUSTOMER:ID:NAME,CITY;PRODUCT_ID:DIM_PRODUCT:ID:NAME,CATEGORY
```

---

### create-data-flow

创建数据转换流水线的数据流。

**语法：**
```bash
/create-data-flow --name FLOW_NAME --source SOURCE_NAME --target TARGET_NAME [--space SPACE_ID] [--label LABEL]
```

---

### create-replication-flow

创建数据同步的复制流。

**语法：**
```bash
/create-replication-flow --name FLOW_NAME --source SOURCE_NAME --target TARGET_NAME [--space SPACE_ID] [--label LABEL]
```

---

### create-transformation-flow

创建带自定义逻辑的转换流。

**语法：**
```bash
/create-transformation-flow --name FLOW_NAME --source SOURCE_NAME --target TARGET_NAME [--space SPACE_ID] [--label LABEL]
```

## 自然语言使用

无需记忆命令语法，用简单的中文描述你的需求：

**示例 1：简单表**
```
"创建一个客户表，包含 ID、姓名和邮箱。ID 是主键。"
```

**示例 2：多步骤数据模型**
```
"创建一个销售分析数据模型。

首先创建销售事实表，包含订单号、客户 ID、产品 ID 和金额。
然后创建客户维度表，包含 ID、姓名和城市。
接着创建产品维度表，包含 ID、名称和类别。
然后创建事实视图，基于销售事实表，关联这两个维度。
最后创建分析模型，基于事实视图，用金额求和作为度量。"
```

Claude Code 会自动：
1. 解析你的需求
2. 确定要调用的合适 Skills
3. 生成正确的命令参数
4. 按正确顺序执行 Skills

## 项目结构

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
└── README.md
```

每个 skill 目录包含：
- **`*.js`**：使用 Datasphere CLI 的 Skill 实现
- **`skill.md`**：Claude Code skill 定义和文档

## 安全注意事项

- 永远不要将 `.env` 文件或凭证提交到版本控制
- 生产环境使用 OAuth 2.0 authorization_code 流程
- 在环境变量中存储敏感配置
- `.gitignore` 文件排除了 `.env`、`secrets.json` 和 `tests-private/`

## 技术细节

### CDS 和 CSN 格式

Skills 生成 CSN (Core Schema Notation) 格式的 artifacts，这是 CDS (Core Data Services) 模型的 JSON 表示。格式学习方法：

1. 在 Datasphere UI 中手动创建参考 artifacts
2. 通过 CLI 读取 artifact 结构：`datasphere objects views read --name ARTIFACT_NAME`
3. 分析 JSON 结构，识别必需字段和模式
4. 基于这些模板生成新的 artifacts

## 限制

- Skills 针对标准建模模式优化
- 复杂的业务逻辑可能需要手动调整
- 参考模型未覆盖的边缘情况可能出现 UI 验证错误
- 推荐工作流：从简单 artifacts 开始，逐步增加复杂度

## 贡献

本项目使用 Claude Code 进行 AI 辅助开发。欢迎贡献：

1. 使用你的 Datasphere 租户测试 Skills
2. 报告问题或边缘情况
3. 提交改进的 pull requests
4. 分享额外的 artifact 模板

## 支持

相关问题：
- **Skills**：在 GitHub 上开 issue
- **Datasphere CLI**：参考 SAP 官方文档
- **Claude Code**：参考 Anthropic 文档
