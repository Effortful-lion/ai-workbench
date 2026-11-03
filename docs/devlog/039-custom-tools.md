# 039 · 工具管理面板 + AI 自写工具（MVP）

- 日期：2026-11-03
- 状态：✅ 已完成（shared/server/web 构建通过 + REST/WS/浏览器 E2E 全通）

## 目标

让 AI 在聊天里自己写工具 → 创建到系统 → 人工启用 → Agent 即可调用；同时提供「工具管理」面板统一查看内置工具、管理自定义工具。

## 决策

- **声明式 HTTP 工具，不做代码沙箱**：MVP 只支持 `method/url/headers/bodyTemplate` 声明 + `{{参数}}` 模板渲染 + fetch 执行。AI 生成结构化 JSON 远比生成可执行代码安全可控。
- **human-in-the-loop**：AI 通过 meta 工具 `tools.create` 创建的工具一律 `enabled=false`，必须人工在面板点击启用后才注册进 ToolRegistry；面板手工创建等同人工信任动作，直接启用。
- **`custom.*` 命名空间 + 全局唯一**：自定义工具强制 `custom.` 前缀（slug 1-31 位小写字母/数字/中划线），与内置工具命名空间隔离；registry 是进程级单例，名字跨用户全局唯一。
- **执行权限独立成点**：自定义工具统一 `permission: "tools:custom"`，member 角色新增 `tools:write`（创建/维护）与 `tools:custom`（执行）两个权限点，停用/回收有明确抓手。
- **SSRF 防护（MVP 粒度）**：仅 http/https；按字面量拒绝 localhost、`*.local`、`*.internal` 与 127/10/172.16-31/192.168/169.254/0.x 私网 IP；`redirect: "error"` 防重定向逃逸；10s AbortController 超时；响应体流式读取 256KB 截断。创建时用样例渲染校验一次，执行时对真实渲染结果再校验一次。
- **启停即注册/注销**：toggle/update/delete 同步 `registry.register/unregister`，不重启进程即时生效；进程重启时 onModuleInit 全量加载 enabled 行。

## 实现

- shared
  - `tool.ts`：`ToolDef`/`ToolSchemaDto` 加 `custom?: boolean`；新增 `HttpToolSpec`、`CustomToolDto`、`UpsertCustomToolInput`。
  - `roles.ts`：member 权限 += `tools:write`、`tools:custom`。
- server
  - `db/schema.ts`：`custom_tools` 表（id/ownerId/name/description/kind/specJson/argsSchemaJson/enabled/createdBy/createdAt），drizzle-kit push 落库。
  - `tools/tool-registry.service.ts`：新增 `unregister(name)`。
  - `tools/custom-tools.service.ts`（新增）：meta 工具 `tools.create`（tools:write，创建 enabled=false、createdBy="ai"，返回面板启用提示）与 `tools.list`（tools:read）；REST 用 CRUD/toggle/remove；`execHttpSpec` 执行器（模板渲染 url encodeURIComponent、headers/body 原样替换）。
  - `tools/tools.controller.ts`：`GET/POST /tools/custom`、`PATCH /tools/custom/:id`、`POST /tools/custom/:id/toggle`、`DELETE /tools/custom/:id`，归属校验 ownerId。
- web
  - `features/aitools/ToolsManagerPanel.tsx`（新增）：统计行（总/自定义/已启用）+ 全部/内置/自定义过滤 + 搜索；行展开看 argsSchema 与 HTTP 声明；custom 行启停 toggle、两步确认删除；手动创建折叠表单（创建即启用）；空态引导"在聊天里让 AI 帮你写工具"。
  - 面板注册：id `aitools`，title「工具管理」，path `~/aitools`；`/aitools` 命令由 PANEL_IDS 自动生成；hash 路由（038）自动支持 `#/p=aitools`。

## 验证

- REST：手工创建 custom.weather（enabled=true）→ `GET /tools` 出现且 `custom:true`；SSRF 用例（`http://127.0.0.1:8700/...`）被 400 拒绝；非法名称被 400 拒绝；toggle 停用/启用后 registry 即时消失/恢复。
- WS（mock 模型）：消息提及 "tools" → 原生 function calling 触发 `tools.create`，参数校验错误以标准 ToolResult 信封返回（链路通）；注入 tools 清单尾部可见已启用的 `custom.weather`。
- 浏览器：`http://localhost:8701/#/p=aitools` 面板渲染正常，统计行「共 121 个 · 自定义 1 · 已启用 1」，custom.weather 行强调色 + tools:custom badge + 已启用状态，展开可见 HTTP 声明。

## 遗留

- 执行 fetch 在沙箱内无外网，仅验证到网络边界（错误信封正常）；真实出网需在非沙箱环境复测。
- SSRF 只按主机名字面量判定，未做 DNS 解析后 IP 校验（域名解析到私网可绕过）；重定向直接拒绝，兼容性后续可放宽为逐跳校验。
- 工具版本历史、调用统计、按 Agent 粒度授权、Skills/MCP 管理面板均为后续迭代。
