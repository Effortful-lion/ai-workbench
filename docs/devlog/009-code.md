# 009 · code 代码管理

- 日期：2026-11-02
- 状态：✅ 完成（接口 curl 权限矩阵全 PASS；前端浏览器验证 owner 建仓库/建文件/保存、member 只读 PASS）

## 目标

按需求准备「代码管理 —— 前期提供项目代码上传、下载、查看等功能，后期直接对标 git（甚至借助 github cli）」落地二期第二个模块：

- 仓库卡片 + 文件树两层结构，对应原型 `~/code/repos`。
- owner 可建仓库、上传文本文件、在线查看/编辑保存、下载、删除；member 只读；guest 不可见。
- 仓库卡片展示 `language / name / ● branch · clean / files · size / 日期`，文件树展示带目录的相对路径。
- 命令入口保持终端风格：`repo.new <name> [language] [描述]`、`file.new <path>`，上传按钮走文件选择器。
- 注册 AI Tool（`code.list` / `code.readFile` / `code.createRepo` / `code.writeFile`）。

## 决策

1. **仓库与文件分表**：`code_repos` + `code_files`，文件随仓库外键级联删除；仓库是文件的边界。
2. **文件内容存库、路径存相对值**：一期不做真实文件系统落盘，正文直接存 SQLite，`path` 为 `src/main.tsx` 这类相对路径，展示时拼 `~/code/<repo>/<path>`。
3. **只支持文本文件**：上传前按扩展名 / MIME 白名单判断，正文上限 200,000 字符，与知识库、项目文档一致；二进制、图片、压缩包延后。
4. **路径严格归一化**：统一反斜杠和重复斜杠、去掉 `./` 与首尾 `/`，拒绝 `.` / `..` 段，避免路径穿越式展示；同一仓库内路径唯一。
5. **仓库统计实时聚合**：`fileCount` / `sizeBytes` 由 `left join + count/sum` 计算，不冗余存储，避免增删文件后计数漂移。
6. **权限复用角色体系**：新增 `code:read` / `code:write`；member 仅 `code:read`，guest 无，owner 由 `"*"` 覆盖。与原型 ACL `~/code owner rw / member ro / guest ×` 一致。
7. **数据按 ownerId 隔离**：member 只读作用于自己的仓库空间，跨用户访问返回 404，延续个人工作台模型。
8. **上传即「按路径 upsert」**：前端上传时若同路径已存在，二次确认后走 `PATCH` 覆盖，否则 `POST` 新建；AI 工具 `code.writeFile` 复用同一语义，同名覆盖、否则新建。
9. **下载由前端 Blob 完成**：查看接口返回正文，前端 `Blob + a[download]` 触发下载，服务端不额外提供二进制流接口，一期够用且避免鉴权头在 `<a>` 下载中丢失。
10. **分支与 clean 状态是展示位**：`branch` 可改、卡片固定显示 `· clean`；没有真实 git 对象、commit、diff，明确留到后期对标 git 时再做。

## 实现

- 共享协议：[code.ts](file:///Users/lion/workspace/gocode/ai-workbench/packages/shared/src/code.ts)
  （`CodeRepoDto` / `CodeRepoInput` / `CodeRepoPatchInput` / `CodeFileDto` / `CodeFileDetailDto` /
  `CodeFileInput` / `CodeFilePatchInput`），由
  [index.ts](file:///Users/lion/workspace/gocode/ai-workbench/packages/shared/src/index.ts) 导出。
- 权限：[roles.ts](file:///Users/lion/workspace/gocode/ai-workbench/packages/shared/src/roles.ts)
  member 新增 `code:read`。
- 服务端：
  - [schema.ts](file:///Users/lion/workspace/gocode/ai-workbench/apps/server/src/db/schema.ts)
    新增 `code_repos`（`id/owner_id/name/description/language/branch/created_at/updated_at`）与
    `code_files`（`id/repo_id/path/content/size/created_at/updated_at`），已 `drizzle-kit push --force`。
  - [code.service.ts](file:///Users/lion/workspace/gocode/ai-workbench/apps/server/src/code/code.service.ts)
    `normalizeName` / `normalizePath` / `normalizeContent`；
    `listRepos`（聚合文件数与大小）/ `createRepo` / `updateRepo` / `removeRepo`；
    `listFiles` / `getFile` / `createFile` / `updateFile` / `removeFile`；
    `findByRepoName` / `readFileByPath` / `upsertFileByPath` 供工具层复用。
  - [code.controller.ts](file:///Users/lion/workspace/gocode/ai-workbench/apps/server/src/code/code.controller.ts)
    `GET/POST /api/code/repos`、`PATCH/DELETE /api/code/repos/:id`、
    `GET/POST /api/code/repos/:id/files`、`GET/PATCH/DELETE /api/code/repos/:id/files/:fileId`。
  - [code.tools.ts](file:///Users/lion/workspace/gocode/ai-workbench/apps/server/src/code/code.tools.ts)
    `code.list` / `code.readFile`（`code:read`），`code.createRepo` / `code.writeFile`（`code:write`）。
  - [code.module.ts](file:///Users/lion/workspace/gocode/ai-workbench/apps/server/src/code/code.module.ts)
    与 [app.module.ts](file:///Users/lion/workspace/gocode/ai-workbench/apps/server/src/app.module.ts) 接线。
- 前端：
  - [CodePanel.tsx](file:///Users/lion/workspace/gocode/ai-workbench/apps/web/src/features/code/CodePanel.tsx)
    `repo.new` / `file.new` 解析、仓库卡片、文件树、在线编辑/保存/还原、文本上传（同路径确认覆盖）、
    Blob 下载、`wb push` 命令复制、owner 删除确认、member 只读预览。
  - [panel.ts](file:///Users/lion/workspace/gocode/ai-workbench/apps/web/src/stores/panel.ts) 注册
    `code`（`代码管理` / `~/code`）；
    [PanelZone.tsx](file:///Users/lion/workspace/gocode/ai-workbench/apps/web/src/shell/PanelZone.tsx) 映射
    `code: () => <CodePanel />`；
    [HeroState.tsx](file:///Users/lion/workspace/gocode/ai-workbench/apps/web/src/shell/HeroState.tsx) 新增
    「▸ 打开代码管理」chip；CommandPalette / CliOverlay 自动获得入口。

## 验证

- 构建：shared `tsc` 通过；server / web `tsc --noEmit` 0 错误；web `vite build` 通过（75 modules）。
- curl（owner 用 dev secret 手工签发 JWT）：
  - 未登录 `GET /code/repos` → 401；guest → 403 `requires code:read`。
  - owner `POST /code/repos` → 201；非法仓库名 `bad name!` → 400；重名 → 400「仓库名已存在」。
  - `POST /code/repos/:id/files`（`src/main.tsx`）→ 201，`sizeBytes=47`；
    `./src/main.tsx` 归一化后命中重名 → 400；`src/../etc/passwd` → 400「文件路径不能包含 . 或 .. 段」。
  - `PATCH .../files/:fileId` → 200，size 47→72，`GET` 正文一致；`GET /code/repos` 聚合出 `1 files · 72B`。
  - `PATCH /code/repos/:id`（`branch=dev`）→ 200。
  - member `kbtest`：`GET /code/repos` → 200（自己的空列表）；`POST` → 403；
    `GET` owner 仓库文件 → 404「仓库不存在」（ownerId 隔离）。
  - `GET /tools`：owner 得到 4 个 code 工具；member 仅 `code.list` / `code.readFile`。
- 浏览器（临时账号，验证后已删除并级联清理仓库）：
  1. `codeowner` 登录 → 首页 chip「▸ 打开代码管理」→ `repo.new demo-repo typescript 演示仓库` 成功，
     提示 `✓ 仓库 demo-repo 已创建 · typescript @ main`；`file.new src/util.ts` → 输入
     `export const add = (a: number, b: number) => a + b;` →「⏎ 保存」，
     提示 `✓ src/util.ts 已保存`，卡片显示 `1 files · 51B`，底部「已保存」。
  2. `codemember` 登录 → 面板显示 `read-only` 徽标与只读提示行，无命令输入框、无「上传文件」与
     「删除仓库」按钮，看不到 codeowner 的 demo-repo（0 repositories）。
  3. 临时账号 codeowner / codemember 已从 DB 删除，demo-repo 及其文件随外键级联删除。
- 演示数据保留在 lion 名下：`ai-workbench`（typescript，3 files，319B）、`lancer`（typescript，2 files）、
  `kb-cli`（go，2 files）、`dotfiles`（shell，2 files），均 `main` 分支、界面显示 clean。

## 遗留

- 仅文本文件；二进制 / 图片 / 压缩包 / 大文件上传不支持，也没有文件大小进度条与分片上传。
- 没有真实 git：无 commit、diff、分支切换、回滚、clone/push/pull；`branch` 与 `· clean` 只是展示位。
- 上传一次只能选一个文件；浏览器 `webkitRelativePath` 仅在目录选择时可用，目前未提供整目录上传。
- 文件树是平铺列表（按路径排序），没有按目录折叠的树形缩进与图标。
- 重命名仓库有服务端 `PATCH` 能力但面板未提供入口；文件重命名同样只能通过 API。
- 无语法高亮、搜索、README 渲染、代码行号。
- AI 工具只能读/写单文件，不能列文件清单、搜索代码或删除文件。
- `wb push` 只是复制命令文案，本地 CLI 与仓库尚未真正打通。
