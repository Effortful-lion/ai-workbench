# 040 · 工具类型体系预留 + 面板扁平化类型筛选

- 日期：2026-11-03
- 状态：✅ 已完成（构建通过 + REST/浏览器验证 PASS）

## 目标

1. 首页（HeroState）补充「工具管理」入口 chips。
2. 工具模块重构：不为落地新执行器，而是把 **function / http / shell / database / mcp** 类型体系在数据模型、注册表、出网 DTO、面板 UI 全链路预留出来，后续实现新类型执行器时无需再动骨架。
3. 面板采用扁平列表 + 类型筛选 chips + kind badge（用户明确否决分组方案）。

## 决策

- **类型枚举统一定义在 shared**：`TOOL_KINDS = ["function","http","shell","database","mcp"]`，前后端共用，避免两处漂移。
- **kind 缺省推导**：`@RegisterTool` 扫描注册的内置工具一律 `kind:"function"`；`register()` 动态注册缺省也是 function，自定义工具用行内 `kind` 显式覆盖。存量代码零改动。
- **预留类型只到数据与 UI 层**：`custom_tools.kind` 枚举放宽为 http/shell/database/mcp，但创建入口（REST/meta 工具）仍只接受 http——未实现的执行器不放行，避免产生"能创建不能跑"的半吊子状态。
- **预留类型在筛选 chips 显示 0 计数**：点击后空态明确提示"预留类型，执行器后续支持"，把路线图摊给用户看。

## 实现

- shared `tool.ts`：`TOOL_KINDS`/`ToolKind`；`ToolDef`、`ToolSchemaDto` 加 `kind?: ToolKind`；`CustomToolDto.kind` 由 `"http"` 放宽为 `ToolKind`。
- server
  - `tool-registry.service.ts`：扫描注册与动态注册均补 `kind:"function"` 缺省。
  - `db/schema.ts`：`custom_tools.kind` 枚举放宽（drizzle sqlite 的 text enum 无 CHECK 约束，push 无变更，直接兼容）。
  - `custom-tools.service.ts`：`toToolDef` 透传 `row.kind`。
- web `ToolsManagerPanel.tsx`：`KIND_META` 徽章配色（function=tx2 / http=acc / shell=warn / database=tx / mcp=tx3）；筛选 chips 改为 全部 + 5 类型（带实时计数）；行内新增 kind badge（位于 AI 写 与 permission badge 之间）；预留类型空态文案；底部说明补类型图例。
- web `HeroState.tsx`：首页 chips 增加「▸ 打开工具管理」。

## 验证

- `GET /api/tools` 出网 kind 分布：`function 120 / http 1`，custom.weather 正确带 `kind:"http"`。
- 浏览器：6 个筛选 chips 计数正确（function 120、http 1、其余 0）；行 badge 正常；shell/database/mcp 空态提示正确。

## 遗留

- shell / database / mcp 执行器：落地时需各自定义 spec 结构（命令模板 / 连接配置+参数化 SQL / MCP server 描述），`specJson` 列已有 `$type<HttpToolSpec>`，届时改为判别联合类型。
- function 类型的"AI 写 JS 沙箱函数"需引入隔离运行时（isolated-vm 等），安全模型单独设计。
