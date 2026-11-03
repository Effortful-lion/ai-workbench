# 008 · projects 项目管理

- 日期：2026-11-02
- 状态：✅ 完成（接口 curl 权限矩阵全 PASS；前端浏览器验证 owner 建项目/写文档、member 只读 PASS）

## 目标

按需求准备「项目管理 —— 前期项目文档资料的创建、删除、更新（区别于文档库，特定项目文档管理），后期对标 git」落地二期第一个模块：

- 项目列表 + 项目文档树两层结构，而非扁平文档表。
- owner 可创建项目、建文档、编辑正文（版本号 +1）、改状态、删除项目/文档；member 只读；guest 不可见。
- 面板延续终端气质：项目行 `▸ name + 描述 + docs N + 日期 + 状态标签`，文档行 `├── 文件名 + 大小 · vN · 日期`，正文用等宽 textarea 直接编辑保存。
- 创建入口用一行命令 `project.new <name> [描述] [#status]` 与 `doc.new <文件名>`，不引入传统表单。
- 能力注册为 AI Tool（`projects.list` / `projects.readDoc` / `projects.create` / `projects.writeDoc`），便于 Agent 归档文档。

## 决策

1. **项目与文档分两张表**：`projects` + `project_docs`，文档通过 `project_id` 外键级联删除。项目是文档的生命周期边界，与知识库（长期沉淀、可跨项目检索）明确区分。
2. **文档 `path` 不落库**：路径由 `~/projects/<project.name>/<doc.title>` 在 DTO 层现算。这样项目改名后文档路径自动跟随，避免批量更新冗余路径字段造成不一致。
3. **项目名即目录名**：`normalizeName` 空白转 `-`、去首尾标点、只放行字母/数字/中文/`. _ -`，并限长 40；同一 owner 下项目名唯一。文档标题禁止 `/`（替换为 `-`），避免树结构和路径展示错乱。
4. **权限复用现有角色体系**：新增权限点 `projects:read` / `projects:write`；仅给 member 增加 `projects:read`，guest 不新增，owner 由 `"*"` 覆盖。前端 `canWrite = role === "owner"` 只收缩展示，服务端 `PermissionGuard` 兜底。与原型 ACL `~/projects owner rw / member ro / guest ×` 一致。
5. **数据按 ownerId 隔离**：每个用户拥有自己的 `~/projects`，member 的只读作用于自己的项目空间（当前为空），既不会越权看到 owner 项目，也保持既有模块的「个人工作台」模型。
6. **版本号而非历史表**：`project_docs.version` 在标题或正文变化时 +1，未变化不涨版本；为后期 git diff/回滚语义预留，但一期不存 revision 快照，避免过度设计。
7. **状态用英文枚举 + 中文展示**：库内 `active/paused/done`，界面显示「进行中/暂停/完结」；服务端兼容中文别名与 `#` 前缀，方便命令行和 Agent 输入。
8. **空文档允许创建**：`doc.new` 先建标题、再在 textarea 写正文；`content` 缺省为空字符串，`size` 用 UTF-8 字节数。正文上限 200,000 字符，与知识库一致。
9. **AI 写入用 upsert**：`projects.writeDoc` 按「项目名 + 文档标题」查找，同名则更新（版本 +1），否则新建，直接支持原型里的「把《接口约定.md》归档到 ai-workbench」。

## 实现

- 共享协议：[projects.ts](file:///Users/lion/workspace/gocode/ai-workbench/packages/shared/src/projects.ts)
  （`ProjectDto` / `ProjectInput` / `ProjectPatchInput` / `ProjectDocDto` / `ProjectDocDetailDto` /
  `ProjectDocInput` / `ProjectDocPatchInput` / `PROJECT_STATUSES`），由
  [index.ts](file:///Users/lion/workspace/gocode/ai-workbench/packages/shared/src/index.ts) 导出。
- 权限：[roles.ts](file:///Users/lion/workspace/gocode/ai-workbench/packages/shared/src/roles.ts)
  member 新增 `projects:read`；owner 仍为 `"*"`，guest 无项目权限。
- 服务端：
  - [schema.ts](file:///Users/lion/workspace/gocode/ai-workbench/apps/server/src/db/schema.ts)
    新增 `projects`（`id/owner_id/name/title/status/created_at/updated_at`）与
    `project_docs`（`id/project_id/title/content/size/version/created_at/updated_at`），已 `drizzle-kit push --force`。
  - [projects.service.ts](file:///Users/lion/workspace/gocode/ai-workbench/apps/server/src/projects/projects.service.ts)
    `normalizeName` / `normalizeStatus` / `normalizeDocTitle` / `normalizeContent`；
    `list`（left join 统计 docCount）/ `create` / `update` / `remove`；
    `listDocs` / `getDoc` / `createDoc` / `updateDoc` / `removeDoc`；
    `findByName` / `readDocByTitle` / `upsertDocByTitle` 供工具层复用。
  - [projects.controller.ts](file:///Users/lion/workspace/gocode/ai-workbench/apps/server/src/projects/projects.controller.ts)
    `GET/POST /api/projects`、`PATCH/DELETE /api/projects/:id`、
    `GET/POST /api/projects/:id/docs`、`GET/PATCH/DELETE /api/projects/:id/docs/:docId`。
  - [projects.tools.ts](file:///Users/lion/workspace/gocode/ai-workbench/apps/server/src/projects/projects.tools.ts)
    `projects.list` / `projects.readDoc`（`projects:read`），`projects.create` / `projects.writeDoc`（`projects:write`）。
  - [projects.module.ts](file:///Users/lion/workspace/gocode/ai-workbench/apps/server/src/projects/projects.module.ts)
    与 [app.module.ts](file:///Users/lion/workspace/gocode/ai-workbench/apps/server/src/app.module.ts) 接线。
- 前端：
  - [ProjectsPanel.tsx](file:///Users/lion/workspace/gocode/ai-workbench/apps/web/src/features/projects/ProjectsPanel.tsx)
    `project.new` / `doc.new` 解析，项目列表（状态标签、docs 数、日期），文档树，正文编辑/保存/还原，
    owner 状态切换与删除确认，member 只读预览。
  - [panel.ts](file:///Users/lion/workspace/gocode/ai-workbench/apps/web/src/stores/panel.ts) 注册
    `projects`（`项目管理` / `~/projects`）；
    [PanelZone.tsx](file:///Users/lion/workspace/gocode/ai-workbench/apps/web/src/shell/PanelZone.tsx) 映射
    `projects: () => <ProjectsPanel />`；
    [HeroState.tsx](file:///Users/lion/workspace/gocode/ai-workbench/apps/web/src/shell/HeroState.tsx) 新增
    「▸ 打开项目管理」chip；CommandPalette / CliOverlay 从 `PANEL_META` 自动获得入口。

## 验证

- 构建：shared `tsc` 通过；server / web `tsc --noEmit` 0 错误；web `vite build` 通过（74 modules）。
- curl（owner 用 dev secret 手工签发 JWT）：
  - 未登录 `GET /projects` → 401；guest → 403 `requires projects:read`。
  - owner `POST /projects`（`ai-workbench`）→ 201；`GET` → 200 且 `docCount=0`。
  - 非法项目名 `bad name!` → 400；重名项目 → 400「项目名已存在」。
  - `POST /projects/:id/docs` → 201，返回 `path=~/projects/ai-workbench/需求准备.md`、`version=1`；
    同名文档 → 400「该项目下已存在同名文档」。
  - `PATCH .../docs/:docId` → 200，`size 48→78`、`version 1→2`；`GET` 正文一致。
  - `PATCH /projects/:id`（`status=paused`）→ 200 且 `docCount=1`。
  - member `kbtest`：`GET /projects` → 200（自己的空列表）；`POST /projects` / `PATCH` owner 项目 → 403；
    `GET` owner 项目 docs → 404「项目不存在」（按 ownerId 隔离）。
  - `GET /tools`：owner 得到 4 个 projects 工具；member 仅得到 `projects.list` / `projects.readDoc`。
- 浏览器（临时账号，验证后已删除并级联清理其项目）：
  1. `prjowner` 登录 → 首页 chip「▸ 打开项目管理」→ `project.new demo-app 演示项目` 创建成功，
     左侧出现 demo-app / docs 1；`doc.new 说明.md` → 输入「# 演示文档」→「⏎ 保存」，
     提示 `✓ 说明.md 已保存 · v2`，文件行显示 v2，正文区显示「6 chars · 已保存」。
  2. `prjmember` 登录 → 面板显示 `read-only` 徽标与只读提示行，无命令输入框、无「删除项目」按钮，
     看不到 prjowner 的 demo-app（0 projects）。
  3. 临时账号 prjowner / prjmember 已从 DB 删除，demo-app 及其文档随外键级联删除。
- 演示数据保留在 lion 名下：`ai-workbench`（active，3 docs，含 v2 的 需求准备.md）、
  `kb-cli`（active，2 docs）、`lancer`（paused，1 doc）、`meishi`（done，1 doc）。

## 遗留

- 项目重命名/改描述仅有服务端 `PATCH` 能力，面板暂未提供 rename 入口；改描述需删除重建。
- 文档只支持标题 + 纯文本/Markdown 正文，无上传附件、无目录层级（标题里的 `/` 会被替换为 `-`）。
- 版本号只是计数，不保存历史快照，无法 diff / 回滚 / 查看旧版本；这是后期对标 git 的主要欠账。
- 没有文档搜索、标签、里程碑、动态联动（项目事件尚未汇入个人动态）。
- member 只读是「自己项目空间只读」；当前 member 无法查看 owner 项目，与原型中「成员可读主人项目」的语义
  仍有差异，待二期 ACL 明确后调整（例如引入 workspace 共享项目）。
- 状态切换需手动点选，未做根据更新时间自动判定「暂停 / 活跃」。
- AI 工具暂无删除能力（`projects.remove` / `deleteDoc`），Agent 不能帮用户清理项目。
