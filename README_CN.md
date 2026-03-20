# SAP Datasphere CLI Skills

使用 Claude Code 和官方 Datasphere CLI 的自然语言接口来创建 SAP Datasphere 对象。

## 功能特点

- **自然语言处理**: 使用中文描述来创建 Datasphere 对象
- **六种对象类型**: 本地表、视图、分析模型、数据流、复制流、转换流
- **复杂模型支持**: 自动处理维度关联、度量定义和业务层配置
- **CLI 集成**: 基于 SAP 官方 `@sap/datasphere-cli` 包
- **逆向工程**: 通过分析现有 Datasphere 对象来学习对象格式

## 前置条件

- Node.js (v14 或更高版本)
- 配置了 OAuth 2.0 客户端的 SAP Datasphere 租户
- Claude Code CLI

## 安装

1. 克隆仓库:
```bash
git clone https://github.com/yuyonggang/dsp-cli.git
cd dsp-cli
```

2. 安装依赖:
```bash
npm install
```

3. 配置环境变量:
```bash
cp .env.example .env
```

编辑 `.env` 文件，填入你的 Datasphere 凭据:
```
DATASPHERE_HOST=https://your-tenant.datasphere.cloud.sap
CLIENT_ID=your_client_id
CLIENT_SECRET=your_client_secret
AUTHORIZATION_URL=https://your-tenant.authentication.sap.hana.ondemand.com/oauth/authorize
TOKEN_URL=https://your-tenant.authentication.sap.hana.ondemand.com/oauth/token
```

## OAuth 2.0 配置

在 Datasphere 租户中配置 OAuth 客户端:

1. 导航到: **系统** → **管理** → **应用集成**
2. 创建新的 OAuth 2.0 客户端:
   - **授权类型**: Authorization Code
   - **重定向 URI**: `http://localhost:8080/`
   - **Token 有效期**: 3600 秒 (推荐)
3. 记录 Client ID 和 Client Secret 用于 `.env` 文件

## Skills 参考

### create-local-table

在 Datasphere 中创建本地表。

**语法:**
```bash
/create-local-table --name 表名 --columns 列定义 [--space 空间ID] [--label 标签] [--dimension]
```

**列格式:** `名称:类型:长度[:精度][:key][:required]`

**示例:**
```bash
# 简单表
/create-local-table --name CUSTOMER --columns ID:String:10:key,NAME:String:100,EMAIL:String:100

# 带 Decimal 类型 (精度:小数位，如 15:2)
/create-local-table --name SALES --columns ORDER_ID:String:10:key,AMOUNT:Decimal:15:2:required

# 维度表
/create-local-table --name DIM_CUSTOMER --columns ID:String:10:key,NAME:String:100 --dimension
```

**支持的类型:** `String`, `Integer`, `Decimal`, `Date`, `DateTime`, `Boolean`

---

### create-view

基于现有表或视图创建视图。支持创建带维度关联的图形视图。

**语法:**
```bash
/create-view --name 视图名 --source 源名称 [--columns 列] [--dimensions 维度] [--space 空间ID] [--label 标签]
```

**示例:**
```bash
# 简单视图
/create-view --name V_CUSTOMER --source CUSTOMER --columns ID,NAME

# 带维度的图形视图 (多个维度用分号分隔)
/create-view --name SALES_FACT_VW --source SALES_FACT --dimensions "CUSTOMER_ID:DIM_CUSTOMER:ID;PRODUCT_ID:DIM_PRODUCT:ID"
```

---

### create-analytic-model

创建带维度关联的分析模型。

**语法:**
```bash
/create-analytic-model --name 模型名 --source 源名称 [--measures 度量] [--dimensions 维度] [--space 空间ID] [--label 标签]
```

**度量格式:** `列名:聚合方式` (逗号分隔)

**聚合方式:** `sum`, `avg`, `min`, `max`, `count`

**维度格式:** `外键列:维度表:连接键:属性1,属性2` (多个维度用分号分隔)

**示例:**
```bash
/create-analytic-model --name AM_SALES \
  --source SALES_FACT \
  --measures AMOUNT:sum,QUANTITY:sum \
  --dimensions CUSTOMER_ID:DIM_CUSTOMER:ID:NAME,CITY;PRODUCT_ID:DIM_PRODUCT:ID:NAME,CATEGORY
```

---

### create-data-flow

创建数据转换流水线的数据流。

**语法:**
```bash
/create-data-flow --name 流名称 --source 源名称 --target 目标名称 [--space 空间ID] [--label 标签]
```

---

### create-replication-flow

创建数据同步的复制流。

**语法:**
```bash
/create-replication-flow --name 流名称 --source 源名称 --target 目标名称 [--space 空间ID] [--label 标签]
```

---

### create-transformation-flow

创建带自定义逻辑的转换流。

**语法:**
```bash
/create-transformation-flow --name 流名称 --source 源名称 --target 目标名称 [--space 空间ID] [--label 标签]
```

## 自然语言使用

无需记忆命令语法，用中文描述你的需求即可：

**示例 1: 简单表**
```
"创建一个客户表，包含ID、姓名和邮箱。ID是主键。"
```

**示例 2: 多步骤数据模型**
```
"创建一个销售分析数据模型。

首先，创建一个销售事实表，包含订单号、客户ID、产品ID和金额。
然后，创建一个客户维度表，包含ID、姓名和城市。
接着，创建一个产品维度表，包含ID、名称和类别。
然后，基于销售事实表创建一个事实视图，关联这两个维度。
最后，基于事实视图创建一个分析模型，以金额合计作为度量。"
```

Claude Code 会自动：
1. 解析你的需求
2. 确定要调用的 Skills
3. 生成正确的命令参数
4. 按正确的顺序执行 Skills

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
├── README.md
└── README_CN.md
```

每个 skill 目录包含：
- **`*.js`**: 使用 Datasphere CLI 的 Skill 实现
- **`skill.md`**: Claude Code skill 定义和文档

## 安全注意事项

- 永远不要将 `.env` 文件或凭据提交到版本控制
- 生产环境使用 OAuth 2.0 authorization_code 流程
- 将敏感配置存储在环境变量中
- `.gitignore` 文件已排除 `.env`、`secrets.json` 和 `tests-private/`

## 技术细节

### CDS 和 CSN 格式

Skills 以 CSN (Core Schema Notation) 格式生成对象，这是 CDS (Core Data Services) 模型的 JSON 表示。格式通过以下方式学习：

1. 在 Datasphere UI 中手动创建参考对象
2. 通过 CLI 读取对象结构: `datasphere objects views read --name ARTIFACT_NAME`
3. 分析 JSON 结构以识别必需字段和模式
4. 基于这些模板生成新对象

### 图形视图 uiModel

对于带维度关联的图形视图，`editorSettings.uiModel` 结构需要特别注意：

- **数据结构** (`DimensionNode`, `Association`, `ElementMapping`) 必须为每个维度生成
- **图表符号** (`EntitySymbol`, `AssociationSymbol`) 对于维度 **不应该** 生成
- SAP Datasphere 会在图形编辑器中打开视图时自动生成可视化符号
- 生成部分符号（如只有 `EntitySymbol` 没有 `AssociationSymbol`）会导致显示问题

## 限制

- Skills 针对标准建模模式进行了优化
- 复杂的业务逻辑可能需要手动调整
- 参考模型未覆盖的边缘情况可能会出现 UI 验证错误
- 推荐工作流程：从简单对象开始，逐步增加复杂性

## 贡献

此项目使用 Claude Code 进行 AI 辅助开发。欢迎贡献：

1. 使用你的 Datasphere 租户测试 Skills
2. 报告问题或边缘情况
3. 提交改进的 Pull Request
4. 分享额外的对象模板

## 支持

相关问题请参考：
- **Skills**: 在 GitHub 上提 Issue
- **Datasphere CLI**: 参考 SAP 官方文档
- **Claude Code**: 参考 Anthropic 文档
