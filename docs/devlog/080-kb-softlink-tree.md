# 080 · KB 扁平存储 + 软链接树形视图

- 日期：2026-11-08
- 状态：已完成

## 目标

知识库采用「底层扁平存储 + 上层软链接树形视图」分离架构：文档与向量始终扁平一份，目录只是视图容器；支持多对多挂载、移除链接/删除本体语义分离、全局与目录范围双模式检索。验收标准：移除链接后全局检索仍可命中；删除本体后所有视图消失且切片清零；范围检索经映射表过滤后召回。

## 决策

- 目录/映射拆两张表（`kb_folders` + `kb_links`，`UNIQUE(document_id, folder_id)`），否决单表 tree_nodes（树结构与引用语义混合，删除语义不清晰）与传统 `folder_id` 硬绑定（违反底层扁平边界）。
- 目录范围检索仅 Qdrant 原生支持（`doc_id match any`）；LightRAG 全局召回后应用层过滤并返回 `scopeFiltered` 标记（结果可能少于 topK，已知取舍）。
- 主归属目录本期启用：chunk payload 增 `primary_path` 路径语义增强；存量文档不回填向量；`kb_documents.path` 语义升级为主归属虚拟路径。
- `kb.ask` 本期保持全局问答；前端 chat Tab 仅显示范围徽标提示。
- `parentId` 不建外键，环检测在 service 层（移动拒绝进自身子树，`folderChain` 带 visited 防死循环）。
- 前端用 HTML5 DnD（自定义 MIME `text/x-kb-doc-id`），避免与文件上传拖拽冲突；拖拽跟随标签为等宽体 `mv` 命令字样。

## 实现

- 类型/协议：`packages/shared/src/kb.ts`（目录/链接/范围检索类型）、`operations.ts` KB_OPERATIONS 补 folders/links 6 条操作与 `folderId` 参数。
- Schema：`apps/server/src/db/schema.ts` 新增 `kb_folders` / `kb_links`、`kb_documents.primaryFolderId`（`make db-push` 应用）。
- 向量层：`apps/server/src/kb/qdrant.service.ts`（ChunkPayload.primary_path、search 第 4 参 docIds 过滤，空集合短路）。
- 服务层：`apps/server/src/kb/kb.service.ts`（listFolders 树组装、create/update/deleteFolder、mountDocument 幂等、unlink、folderSubtreeIds/scopeDocIds、ingest 主归属解析、search 双模式、removeDocument 清理全部映射）。
- 路由：`apps/server/src/kb/kb.controller.ts`（folders/links CRUD、search 透传 folderId）。
- 工具：`apps/server/src/tools/kb.tools.ts`（`kb.search`，search.multi 的 kb 源保持全局语义）。
- 前端：`apps/web/src/features/kb/KbTreeView.tsx`（终端风文件树、拖拽挂载/移除落区、绿描边辉光）、`KbPanel.tsx`（双栏布局、scope 指示、上传主归属下拉、移除链接/删除本体按钮分离 + 二次确认）。

## 验证

- `make build`（shared/server/web）全部通过；`make db-push` 建表，sqlite3 确认唯一索引 `kb_links_doc_folder_uq` 与 `primary_folder_id` 列。
- E2E（Qdrant 容器启动后）：建两级目录 → 上传（`path=~/kb/部署手册/qdrant配置.md`、primaryFolderId 落库）→ 双挂载 + 重复挂载幂等 → 范围检索命中 1 且返回 primaryPath → 移除链接后范围 0 命中/全局仍 1 命中/文档保留 → 删目录（子树级联 removedFolders=2）文档保留 → 删本体后文档消失且 Qdrant 切片 count=0。
- 工具注册：`GET /api/tools` 确认 `kb.search(kb:read)` 及 12 个 kb 操作工具在列。

## 遗留

- 存量文档 `primary_path` 向量回填（本期不动已切片数据）。
- `kb.ask` 目录范围问答。
- 移动端（061 mobileView）下的拖拽手势适配。
- capability 意图路由手册未含 `kb.search` 说明。
- 前端拖拽交互的浏览器人工手测待补（构建与 API 链路已验证）。
