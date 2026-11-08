# 044 · kb 模块对接 LightRAG 检索层

- 日期：2026-11-04
- 状态：✅ 完成（ingest / search / ask / delete 全链路真实联调 PASS）

## 目标

把 043 验证过的 LightRAG 独立服务接入 ai-workbench kb 模块，作为可选检索层。
验收标准：

- `KB_PROVIDER` 环境变量一键切换 qdrant（默认，原路径）/ lightrag（图谱 RAG），代码零改动可回切。
- 二开边界不破：services/lightrag 零修改，主仓只新增一个 HTTP client。
- REST 接口、权限、DB 落库、用户隔离语义与 qdrant 路径一致；前端与 shared 类型零改动。

## 决策

1. **检索层做成 provider 开关，不改对外契约**：`KbService` 内部分流
   （[kb.service.ts](file:///Users/lion/workspace/gocode/ai-workbench/apps/server/src/kb/kb.service.ts)
   `useLightRag()`），ingest/search/ask/delete 四个入口分别走两条路径。默认 qdrant，
   `KB_PROVIDER=lightrag` + `LIGHTRAG_URL` + `LIGHTRAG_API_KEY` 三件套即启用。
2. **file_source 直接用 docId（uuid），不加 scheme 前缀**：最初约定 `kb://{docId}`，
   实测 LightRAG v1.5 会清洗掉 `kb://` scheme，落库 file_path 变成裸 docId，导致轮询
   反查不到（表现为摄入"超时"，其实文档早已 PROCESSED）。改为直接传 docId，并按 uuid
   正则区分 kb 来源与非 kb 来源（如手工上传的 manual）。这是最隐蔽的一个坑。
3. **ask 走 LightRAG 生成式 `/query`，citations 置空**：图谱 RAG 的答案自带
   `### References` 引用段，不再经过主仓的对话模型；`model` 字段标记为 `"lightrag"`。
   search 走 `/query/data` 拿结构化 chunks，按 owner_id 过滤保持用户隔离
   （LightRAG workspace 是共享空间，隔离在主仓侧补齐）。
4. **用户隔离在主仓侧做，不依赖 LightRAG**：摄入时 file_source=docId；检索结果
   `titlesByIds` 只回填本人文档标题，他人文档 chunk 直接丢弃。未来 siftops 多项目隔离
   用 LightRAG 的 WORKSPACE（一项目一 workspace），与本层隔离正交。
5. **chunk 相关度分数为递减合成值**：LightRAG `/query/data` 不返回相似度分数，
   按返回顺序合成 1.0/0.95/0.90…，仅用于前端展示排序语义，不影响检索。
6. **删除先反查服务侧内部 id**：`DELETE /documents/delete_document` 要的是
   `doc-<hash>` 内部 id，先经 paginated 按 file_path 反查；删除为异步，实测约 10s 内清完。

## 实现

- 新增 [lightrag.service.ts](file:///Users/lion/workspace/gocode/ai-workbench/apps/server/src/kb/lightrag.service.ts)
  纯 HTTP client：`insertText` / `waitProcessed`（3s 轮询，180s 超时）/ `query` /
  `queryData` / `deleteDoc`，全部官方 REST API，无 SDK 依赖。
- [kb.service.ts](file:///Users/lion/workspace/gocode/ai-workbench/apps/server/src/kb/kb.service.ts)
  ingest/search/ask/removeDocument 四处按 `useLightRag()` 分流；qdrant 路径原样保留。
- [kb.module.ts](file:///Users/lion/workspace/gocode/ai-workbench/apps/server/src/kb/kb.module.ts)
  注册 `LightRagService`。
- shared 类型、controller、前端 KbPanel：**零改动**。

## 验证

环境：`KB_PROVIDER=lightrag LIGHTRAG_URL=http://localhost:9621 LIGHTRAG_API_KEY=*** node dist/main`。

- `tsc --noEmit` + `nest build` 通过。
- **ingest**：POST /api/kb/documents（中文《订单服务发布手册》）→ status=embedded，
  chunkCount=1，耗时 ~174s（图谱抽取走 deepseek-flash，大头是 LLM 调用，符合预期）。
- **search**：「order-svc 什么时候可以发布，灰度怎么做？」→ 12.4s 命中该文档片段。
- **ask**：「payment-gateway 大量 502 的根因和处置步骤」→ 19s 返回图谱 RAG 生成的
  完整根因链（clearing-svc 慢查询 → 连接池耗尽）+ 处置步骤 + References，
  内容命中 PoC 期间入库的 manual 文档，端到端闭环成立。
- **delete**：DELETE /api/kb/documents/:id → 主仓行删除，LightRAG 侧异步清理完成。

## 遗留

- ask 的 citations 为空（答案自带 References 段）；若需结构化引用，可并行调
  `/query/data` 取 chunks 拼装，暂未做。
- LightRAG 检索/问答延迟在 10-20s 量级（deepseek-flash + mix 模式），前端无超时调整；
  如需更稳可把 web 侧 fetch 超时放宽或换更快模型。
- 摄入为同步等待（最长 180s，可用 `LIGHTRAG_INGEST_TIMEOUT_MS` 调大），大文档建议
  后续改异步任务 + 状态轮询。
- ~~启动脚本未固化三件套环境变量~~ 已加 `pnpm start:lightrag`（API key 从
  services/lightrag/.env 现取，不硬编码）。
- ⚠️ 已知坑：server 以默认 qdrant 模式启动而 Qdrant 容器未起时，上传会失败并报
  `fetch failed`（error 落库，原文档行需手动删除）。用 kb 要么起 Qdrant，要么
  `pnpm start:lightrag`。
- siftops Go client 未开始，待本路径稳定运行后复用同一服务推进。
