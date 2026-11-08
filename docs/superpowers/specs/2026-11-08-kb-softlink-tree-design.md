# KB 知识库 · 扁平存储 + 软链接树形视图 设计文档

- 日期：2026-11-08
- 状态：待实现
- 决策人：Lion
- 关联：`docs/devlog/080-kb-softlink-tree.md`（实现完成后补记）

## 目标

个人 RAG 知识库采用「底层扁平存储 + 上层软链接树形视图」分离设计：机器检索层与人的视图层解耦。底层文档与向量切片始终扁平（只有一份），上层用多对多映射实现虚拟目录树，支持挂载/移除链接/删除本体三种语义严格区分的操作，以及全局检索与目录范围检索双模式。

## 已拍板决策

1. **数据模型**：方案 A —— `kb_folders` + `kb_links` 两张表，映射关系独立成表；否决单表 `kb_tree_nodes`（混合树结构与引用语义，删除语义不清晰）、否决传统 `folder_id` 硬绑定（违反"底层扁平"边界约定）。
2. **LightRAG 链路取舍**：目录范围检索仅 Qdrant 链路原生支持；LightRAG 全局召回后在应用层按 doc_id 集合过滤，返回带 `scopeFiltered` 标记。否决"召回 topK×N 后过滤"（效果打折）、否决弃用 LightRAG（现有 ask 功能依赖它）。
3. **主归属目录**：本期启用。chunk payload 增加 `primary_path` 字段做路径语义增强；额外挂载不覆盖主归属元信息；存量文档不做向量回填。
4. **前端**：树形视图 + 拖拽挂载（拖文档到目录挂载、拖到落区移除链接），极客风交互（终端绿描边、`▌` 插入线、`mv` 等宽体跟随标签）；不做拖拽排序。
5. **目录范围在 ask 上的边界**：`kb.ask` 本期保持全局问答，不做目录范围。

## 数据模型（Drizzle，`apps/server/src/db/schema.ts`）

```
kb_folders   id, owner_id, name, parent_id(可空→根), sort_order, created_at
kb_links     id, owner_id, document_id, folder_id, created_at
             UNIQUE(document_id, folder_id)
kb_documents 新增 primary_folder_id（可空，上传时记录主归属）
             path 字段保留，语义升级为"主归属虚拟路径"展示用
```

边界约定：目录节点只是视图容器，目录本身不向量化、不参与检索；chunk 只绑定唯一 `document_id`，检索逻辑保持扁平召回。

## chunk payload 语义增强

- Qdrant payload 新增 `primary_path`（如 `~/kb/部署手册/网络/config.md`，由主归属目录链 + 文档名计算）；存量字段 `doc_id/chunk_ix/user_id/doc_title/text` 不变。
- LightRAG 链路：`file_source` 仍为 docId（回链不变），不写路径元数据。
- 存量文档：`primary_folder_id` 为空，`primary_path` 沿用 `~/kb/<title>`；不回填已有向量。

## 后端 API（`apps/server/src/kb/kb.controller.ts` 新增）

| 路由 | 权限 | 说明 |
|---|---|---|
| `GET /kb/folders` | kb:read | 返回目录树（含各目录挂载计数） |
| `POST /kb/folders` | kb:write | 新建目录（name + 可选 parent_id） |
| `PATCH /kb/folders/:id` | kb:write | 重命名 / 移动（改 parent_id） |
| `DELETE /kb/folders/:id` | kb:write | 删目录节点 + 子目录级联 + 其下 links，**不删文档本体** |
| `POST /kb/links` | kb:write | 挂载：document_id + folder_id，唯一约束防重复 |
| `DELETE /kb/links/:id` | kb:write | 移除链接：仅删映射行，文档本体/向量/其他视图保留 |
| `POST /kb/search` | kb:read | 新增可选 `folderId`：不传=全局；传=目录范围（含子目录） |

## 检索双模式

- **全局检索**：与现状一致，扁平召回，不依赖树形结构。
- **目录范围检索**（Qdrant）：递归解析 folderId 子树 → 查 `kb_links` 得 doc_id 集合 → Qdrant filter `doc_id` in 集合（`match_any`）召回。
- **LightRAG**：全局召回后应用层按 doc_id 集合过滤引用，结果可能少于 topK（已知取舍），响应带 `scopeFiltered: true`。

## 删除语义（UI 文案严格区分）

- **移除链接**：删 `kb_links` 一行，其余一切保留，全局检索仍可命中。
- **删除文档本体**：删 MinIO 原文 → 删 Qdrant 切片（doc_id filter）→ 删 LightRAG 文档（如适用）→ 删该文档全部 `kb_links` → 删 `kb_documents` 行。所有目录视图同时消失。

## Agent Tool

- 新增 `kb.search` 工具（query + 可选 folderId），注册进 Tool Registry 并纳入能力路由裁剪。
- `search.multi` 的 kb 源保持全局语义不变。
- `packages/shared/operations.ts` 同步更新操作目录（CLI / 工具 schema 共用协议）；`packages/shared/src/kb.ts` 补目录/链接/范围检索类型。

## 前端（`apps/web/src/features/kb`，docs Tab 重构）

- 拆出 `KbTreeView`：终端文件树风格（`▸/▾` 折叠、等宽体路径、选中目录即切换检索范围）。
- **拖拽挂载**：文档节点拖到目录节点 = 挂载（可挂多目录）；拖到底部「⌫ 移除链接」落区 = 仅移除该目录下链接。
- 极客风拖拽细节：悬停目标终端绿描边 + `box-shadow: 0 0 12px #00E59B22` 辉光；落点用 `▌` 样式插入线；跟随标签等宽体显示 `mv <doc> → <folder>`；禁放位置 `#FF5F56` 阻止态。
- 目录 CRUD 用行内菜单；移除链接与删除文档分列两按钮，删除文档二次确认并提示"将从所有目录移除"。
- 面板顶部显示当前检索范围（`scope: 全部文档 / ~/kb/xxx`），范围仅作用于 docs Tab 的目录范围检索；chat Tab 问答按决策 5 保持全局，仅展示范围徽标提示"问答不受目录范围限制"。
- 视觉遵循 `docs/prototype/index.html` 与《风格描述》：终端绿唯一强调色、MiSans + JetBrains Mono、6px 圆角、无毛玻璃。

## 验证

1. `pnpm --filter @aiwb/server build`、`pnpm --filter @aiwb/web build` 通过。
2. API 手测链路：建目录树 → 上传文档 → 挂到两个目录 → 目录范围检索命中 / 移除一个链接后范围检索不再命中而全局仍命中 → 删除文档后所有视图消失、Qdrant 切片数为 0。
3. 前端手测：拖拽挂载/移除链接、范围切换、删除确认。
4. 完成后写 `docs/devlog/062-kb-softlink-tree.md`。

## 遗留（记录不实现）

- 存量文档 `primary_path` 向量回填。
- `kb.ask` 目录范围问答。
- 移动端树形视图手势优化。
