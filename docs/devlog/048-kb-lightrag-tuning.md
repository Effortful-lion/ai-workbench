# 048 · kb LightRAG 收尾优化（引用 / 延迟 / 报错）

- 日期：2026-11-05
- 状态：已完成

## 目标
补齐 044 遗留中除 siftops 外的三项：ask 结构化引用、检索延迟、Qdrant 未启动时的可读报错。

## 决策
1. **ask 的 citations 用并行 `/query/data` 回填**：LightRAG `/query` 只返回带 `### References` 的整段文本，无法给前端做可点击引用。改为 `Promise.all([query, queryData])`，两路并行不叠加延迟；chunk → 命中项复用 search 的同一套用户隔离逻辑。
2. **缓存放在 LightRagService 内，而不是 HTTP 层**：key = 接口 + 模式 + 参数，TTL 默认 300s（`LIGHTRAG_CACHE_TTL_MS`），容量 200 条按最旧淘汰。摄入完成 / 删除 / 重试前清空，避免答案引用已删文档。
3. **问答与纯检索的检索模式可分开配置**：新增 `LIGHTRAG_SEARCH_MODE`（默认跟 `LIGHTRAG_QUERY_MODE`），需要低延迟可单独把检索降为 `naive`（仅向量、跳过图谱）。
4. **Qdrant 报错在 service 层翻译**：所有请求收敛到一个 `req()` 出口，捕获 `fetch failed` / `TimeoutError` 后抛「向量库 Qdrant 不可达（url）：请先启动容器，或用 KB_PROVIDER=lightrag 切换」。该消息直接落库到文档 `error` 字段，前端原样展示。
5. **生成失败但有检索结果时降级抽取式**：至少让用户看到原文依据，而不是直接「服务不可用」。

## 实现
- [lightrag.service.ts](file:///Users/lion/workspace/gocode/ai-workbench/apps/server/src/kb/lightrag.service.ts)：新增 `cache` / `cached()` / `clearCache()`；`query` 与 `queryData` 走缓存；`LIGHTRAG_SEARCH_MODE`。
- [kb.service.ts](file:///Users/lion/workspace/gocode/ai-workbench/apps/server/src/kb/kb.service.ts)：抽出 `chunksToHits()`（search 与 ask 共用）；ask LightRAG 分支并行取答案与 chunks；`processDocument` / `removeDocument` / `retryIngest` 清理缓存。
- [qdrant.service.ts](file:///Users/lion/workspace/gocode/ai-workbench/apps/server/src/kb/qdrant.service.ts)：新增 `req()` 统一出口与 `QDRANT_HINT`，`ensureCollection` / `upsert` / `search` / `deleteByDoc` 全部改走它。

## 验证
环境：`pnpm start:lightrag`（旧进程已 kill，重新 build 后启动），LightRAG 9621 在线。

- `tsc --noEmit` 通过；`nest build` 通过。
- **ask 引用**：`POST /api/kb/ask`「大模型面试常问哪些问题？」→ `source=llm citations=2 latency=32169ms`，引用为本人唯一文档的 2 个 chunk。
- **缓存**：同一问题第二次 ask → `latency=0ms`（总计 0.009s）；同参数 search → `hits=2 latency=0ms`。
- **Qdrant 报错**：临时以默认 qdrant 模式起在 8710，上传文档后落库 `status=error`，`error=向量库 Qdrant 不可达（http://localhost:6333）：请先启动 Qdrant 容器，或用 KB_PROVIDER=lightrag 切换图谱检索`；测试文档已删除，临时进程已停。

## 遗留
- 首次 ask 仍为 10-30s 量级（deepseek-flash + mix 图谱检索），只能靠缓存与模式调整缓解，未做流式输出。
- 缓存为单进程内存，多实例部署会各自持有；如需共享可换 Redis。
- `extractiveAnswer` 的 [n] 与 citations 下标对齐依赖调用方顺序，LightRAG 分支已保证同序。
