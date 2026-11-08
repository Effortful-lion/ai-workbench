# 059 · 开放性问题（续）：意图路由 + 能力知识库降本

- 日期：2026-11-07
- 状态：已完成

## 目标

058 用能力地图 + `site.capabilities` 解决了开放性问题答不上来的问题，但每轮仍把 122 个工具的 schema 全量下发，单轮输入约 **3.3 万 tokens**。开放性问题其实只需要少数几个模块的工具，全量下发是浪费。

验收标准：

1. 每轮对话先用廉价 LLM 调用做意图路由，只下发相关模块的工具 schema；
2. 开放性问题（general）只给通用工具 + 能力片段，模型靠检索内容回答；
3. 单轮输入 tokens 从 ~33k 降到 ~6-10k；
4. 路由失败/检索超时不阻塞对话，优雅降级。

## 决策

- **LLM 意图路由（而非本地关键词匹配）**：路由 prompt 列出所有模块 id/名称/职责，让模型输出 `{kind, modules[]}`。路由用低温度、短超时的非流式调用，成本极低。
- **能力文档存入 LightRAG（复用现有 KB 模块，不另建本地搜索）**：从 `OPERATIONS` 目录生成每模块的能力手册 markdown，直接调用 `LightRagService.insertText()` 摄入，docId 前缀 `capability:` 与用户文档隔离。
- **跳过 `kb_documents` 表**：该表 `ownerId` 有 FK 到 `users`，系统用户不存在会报 `FOREIGN KEY constraint failed`。能力文档直接走 LightRAG REST API，不写主库。
- **工具裁剪**：直跑模式下只保留路由命中模块 + 通用模块（`site/web/health/chat`）的工具；general 问题只给通用工具。Agent 模式不裁剪（保持用户配置）。
- **能力片段替代全量能力地图**：system prompt 注入从 LightRAG 检索到的能力片段，不再塞完整能力地图。
- **检索用 quick 模式（纯向量）而非 deep（图谱推理）**：能力手册是结构化文档，向量检索足够且快得多；deep 模式 120s 超时会拖垮整轮对话。
- **检索外层包 5s 超时**：LightRAG pipeline 忙（正在摄入）时 `/query/data` 会阻塞，超时直接返回空，模型回退到 `site.capabilities` 工具。pipeline 空闲时向量检索 <1s 返回。
- **路由失败模型短期缓存（5 分钟）**：欠费/不可用模型（如 doubao 403）第一次失败后标记，后续路由直接跳过，避免每轮先踩坑拖慢首字延迟。
- **存在性检查用 `/documents/paginated` 而非 `queryData`**：前者不占 LLM/embedding 资源，pipeline 忙时也能用。

## 实现

- 新增 [capability.service.ts](file:///Users/lion/workspace/gocode/ai-workbench/apps/server/src/capability/capability.service.ts)：
  - `ensureCapabilityDocs()`：启动时把 18 篇能力手册灌入 LightRAG，`listDocPaths()` 检查已存在则跳过；
  - `route(question)`：依次尝试真实模型（跳过近期失败的），解析 `{kind, modules[]}`；
  - `retrieve(question, topK)`：`queryData(question, topK*3, "quick")`，过滤 `capability:` 前缀，5s 超时保护；
  - `ROUTE_SYSTEM`：模块清单 + few-shot 示例。
- 新增 [capability.module.ts](file:///Users/lion/workspace/gocode/ai-workbench/apps/server/src/capability/capability.module.ts)：导入 `KbModule`、`ModelsModule`。
- [lightrag.service.ts](file:///Users/lion/workspace/gocode/ai-workbench/apps/server/src/kb/lightrag.service.ts)：新增 `listDocPaths()` 列出所有已摄入文档的 file_path。
- [models.service.ts](file:///Users/lion/workspace/gocode/ai-workbench/apps/server/src/models/models.service.ts)：`pickModel()` 支持 `preferReal`、新增 `listRealModels()`（从 ChatService 迁移，消除循环依赖）。
- [kb.service.ts](file:///Users/lion/workspace/gocode/ai-workbench/apps/server/src/kb/kb.service.ts) / [kb.module.ts](file:///Users/lion/workspace/gocode/ai-workbench/apps/server/src/kb/kb.module.ts)：改为依赖 `ModelsService`（不再依赖 `ChatService`），消除 `KbModule → ChatModule → KbModule` 循环。
- [chat.gateway.ts](file:///Users/lion/workspace/gocode/ai-workbench/apps/server/src/chat/chat.gateway.ts)：
  - 直跑模式：`Promise.all([route, retrieve])` 后裁剪 `agentTools`；
  - phase system prompt 注入 `capabilityText`（检索片段）替代全量能力地图；
  - trace 输出路由结果（`🧭 路由：general/specific`）。
- [site.tools.ts](file:///Users/lion/workspace/gocode/ai-workbench/apps/server/src/tools/site.tools.ts)：新增 `buildCapabilityDocs()`（每模块能力手册）、`moduleDigest()`（路由用一行模块清单）。

## 验证

- `npx tsc --noEmit` 通过；`npx nest build` 通过。
- 服务器启动日志：`▸ 能力手册已存在（18 篇），跳过摄入`（无 FK 错误、无 API key 错误）。
- WS 实测（deepseek-flash）：
  - **开放性问题**「网站当前可以做什么？」：路由 `general`，7 个工具，1 次 `site.capabilities` 调用，**~4223 tokens**（较 058 的 ~33k 降低 **7.8 倍**）；
  - **具体问题**「我有几封未读邮件？」：路由 `specific modules=[mail]`，22 个工具，1 次 `mail.digest` 调用，~6177 tokens，正确返回 63 封未读；
  - 第二次请求不再尝试 doubao（失败缓存生效），无首字延迟。

## 遗留

- LightRAG 摄入 18 篇能力手册需数分钟（图谱抽取走 LLM，单 worker 串行），处理期间 `retrieve` 会 5s 超时回退；处理完成后检索才会真正命中片段。
- `site.capabilities` 在 general 模式下被调用时，响应仍含全部 122 工具的元数据（但这是输出载荷，不影响输入 token 成本）。
- 路由失败缓存在内存中，服务重启后失效；可考虑持久化到 DB 或用模型 `status=error` 标记。
