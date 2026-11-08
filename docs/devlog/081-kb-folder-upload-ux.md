# 081 · KB 文件夹批量入库 + 目录交互打磨

- 日期：2026-11-08
- 状态：已完成
- 关联：080 KB 软链接树形视图

## 目标

落实 080 上线后的四条反馈：① 开发阶段注释 LightRAG 能力手册摄入 403 告警；② 目录创建/重命名去掉 `window.prompt`，改为站内终端风内联表单；③ 支持整文件夹拖拽/选择上传——递归读取后扁平入库，并按原目录层级在视图层重建目录树并挂载；④ 目录展开可见挂载文档叶子，拖拽跟随标签平滑化。

## 决策

- **目录链重建在前端做**：按原相对路径逐段「查找同名子目录，缺则建」（`ensureFolderChain`），复用既有 `POST /kb/folders` + ingest `folderId` API，后端零改动；过程用本地副本累积新目录，不依赖中途刷新树。
- **批量入库不做表单**：文件夹上传跳过粘贴表单直接入库（逐个 `POST /kb/documents`），非文本文件按 080 的 TEXT_EXT 白名单跳过并在结果里计数；单个文件拖拽仍走表单预填。
- **拖拽平滑方案**：跟随标签改为常驻 DOM + `dragover` 事件里直写 `style.transform`（不触发 React 重渲染），仅标签文本走状态；悬停高亮加 `transition-all duration-150`。
- **展开显示文档叶子**：目录展开后把该目录直接挂载的文档渲染为 `├─` 叶子行（可拖拽/点击看原文），解决「目录展开看不到内容」的困惑。
- `webkitGetAsEntry` 递归读目录，`readEntries` 循环读到空（每次最多 100 条）；`选文件夹` 按钮用 `webkitdirectory` 输入，`webkitRelativePath` 含根目录名——根目录名保留为顶层视图目录。

## 实现

- `apps/server/src/capability/capability.service.ts`：`onModuleInit` 暂注释（上线前恢复）。
- `apps/web/src/features/kb/KbTreeView.tsx`：`NewFolderInput`/`RenameInput` 内联表单（`▌` 光标、⏎ 确认 / Esc·失焦取消，新建时强制展开父目录）；`FolderRow` 渲染挂载文档叶子；props 增加 `docs/onDocOpen/onDocDrag`，create/rename 回调改为携带 name。
- `apps/web/src/features/kb/KbPanel.tsx`：`walkEntry` 递归展开拖入条目；`ensureFolderChain` + `ingestFolderFiles` 批量入库（进度 `⠋ x/y · path` + `[████░░]` 字符进度条，结束报成功/跳过/失败计数）；根 `onDrop` 识别目录条目走批量链路；头部新增「⤒ 选文件夹」。

## 验证

- `tsc --noEmit` + `pnpm --filter @aiwb/{web,server} build` 全部通过。
- server 重启后日志无 `ensureCapabilityDocs failed`（403 告警消除），应用正常启动。
- 批量链路依赖的 folders/links/ingest API 已在 080 E2E 验证；前端拖拽/文件夹手测待浏览器确认。

## 遗留

- 文件夹上传中的同名文件去重提示（当前直接新增副本）。
- 批量入库失败重试单文件。
- 移动端（061）下 webkitdirectory/webkitGetAsEntry 不可用，文件夹上传仅桌面端。
