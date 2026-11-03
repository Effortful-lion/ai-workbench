# 027 · 百宝箱工具录入（链接 / 文件 / 分类）

- 日期：2026-11-02
- 状态：✅ 完成
- 前置：026 模型管理分类改造

## 目标

`~/tools · 百宝箱` 原先只有一行 `alias.new <url>` 命令，无法录入文件类工具，也没有分类管理。改为可视化表单：

- 工具载体分两类：**链接**（外链文本）与**文件**（二进制 / 安装包 / 压缩包 / 技能包）。
- 文件类支持点击选择与拖拽上传，落盘后可下载。
- 增加工具分类：数据库 / 技能 / AI / 开发 / 设计 / 运维 / 办公 / 其他，另可自定义。
- 保留终端风格与原有命令模式（表单 / 命令可切换）。

## 决策

| 问题 | 选择 | 原因 |
|------|------|------|
| 载体字段 | `kind` = `link` / `file` | 与现有 alias 语义兼容，旧数据默认 `link` |
| 文件存储 | `data/toolbox/<id>/<原文件名>` | 与 DB 行一一对应，删除时整目录回收 |
| 文件下载地址 | `/api/toolbox/files/:id`（公开） | id 为随机 UUID，公开墙游客也能下载 |
| 上传方式 | multipart + multer 内存存储，上限 50MB | 复用 `FileInterceptor` 现有模式，不引入新依赖 |
| 分类输入 | 预设下拉 + 「自定义…」 | 常用分类一键选，同时允许新分类 |
| 录入方式 | 表单为默认，命令模式保留 | 满足可视化操作，不破坏原有快捷录入 |
| 命令模式范围 | 仅链接 | 文件必须走表单上传 |

## 实现

- `packages/shared/src/toolbox.ts`：新增 `TOOLBOX_KINDS` / `ToolboxKind`；DTO 增加 `kind`、`fileName`、`fileSize`、`mimeType`。
- `apps/server/src/db/schema.ts`：`toolbox_items` 新增 `kind` / `file_name` / `file_size` / `mime_type` / `storage_path`；已执行 `ALTER TABLE` 迁移。
- `apps/server/src/toolbox/toolbox.service.ts`：新增 `createFile`（校验体积、文件名净化、落盘）、`fileFor`（下载信息 + 目录穿越校验）、删除时回收文件目录；`create` 保持链接录入。
- `apps/server/src/toolbox/toolbox.controller.ts`：新增 `POST /toolbox/items/upload`（multipart）与公开 `GET /toolbox/files/:id`（`StreamableFile` + `content-disposition`）。
- `apps/web/src/features/tools/ToolboxPanel.tsx`：重写录入区为终端风格表单（kind 切换、name/category/desc、链接或文件拖拽区、分类下拉 + 自定义、表单 / 命令切换）。
- `apps/web/src/features/tools/ToolboxWall.tsx`：卡片按载体展示 `▤ 文件名 · 体积` 或域名，下载/外链图标区分。

## 验证

- 构建：shared / server / web 全部通过。
- 接口：`POST /toolbox/items` 创建链接 → `kind=link`；`POST /toolbox/items/upload`（demo-tool.txt）→ `kind=file`、`fileName/fileSize/mimeType` 正确；`GET /toolbox/files/:id` 无鉴权可下载且内容一致；`DELETE` 后文件目录被回收、DB 行删除。
- 页面（浏览器实测）：表单 / 命令切换、链接 / 文件切换、name/category/desc/url 字段、分类含「数据库 / 技能 / AI」、文件拖放区、命令模式 `alias.new` 输入均正常。

## 遗留

- 文件上传上限 50MB（内存暂存），更大的安装包需改为磁盘流式上传。
- 文件下载无权限校验（依赖 UUID 不可枚举）；如需更严格可加签名有效期。
- 命令模式暂不支持文件上传，Agent 侧 `toolbox.add` 仍只支持链接。

## 增补：入口改弹窗

- 录入区不再常驻，改为右上角「+ 添加工具」按钮打开居中弹窗；表单 / 命令切换、关闭按钮保留在弹窗头部。
- 遮罩层用 `onMouseDown` + `e.target === e.currentTarget` 关闭，避免与面板内点击冲突。
- 表单标签与控件间距由 `gap-2`（8px）调至 `gap-4`（16px），并给控件加 `pl-2`（8px）内边距，label 到选中文字的视觉间距约 24px。
- 表单由两列网格改为「每属性一行」的单列布局（`space-y-2`），name / category / desc / url 均占满整行。
- 验证：浏览器实测默认不显示表单、按钮打开弹窗、✕ 与遮罩均可关闭；category 标签右缘到下拉文字实测 24px，无重叠；各字段独占一行（输入框宽度与表单容器一致）。

