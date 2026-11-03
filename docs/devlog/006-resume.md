# 006 · resume 个人简历

- 日期：2026-11-02
- 状态：✅ 完成（接口 curl + 前端浏览器端到端全 PASS）

## 目标

把「个人简历」做成**终端档案卡**，而不是表单式简历：

- `whoami` 输出基本信息，`ls ./experience` 展开经历时间线，`cat skills.json` 展示技能树，
  `tree ./projects -L 1` 列出项目。
- 命令行可点击展开/收起，也可在底部输入命令驱动（`help` / `all` / `clear` / `edit`）。
- owner 可编辑（`me:write`），member 只读；游客可通过 `/p/:username` 访问公开只读页。
- 档案能力同时注册为 AI Tool `resume.get`，Agent 勾选后可在对话里读取用户简历。

## 决策

1. **复用 `users.profile_json`，不新建表**：总体设计 §7 未给 resume 独立表；存成
   `{ resume, resumeUpdatedAt }` 信封，既保留扩展位，也避免为一对一档案增加 join。
2. **编辑权限沿用原型 ACL**：owner `rw` / member `ro` / guest `ro·公开`。权限点用
   `me:read`、`me:write`，member 角色没有 `me:write`，因此**不改动 roles 权限表**；
   member 的档案仍是只读（如需自助编辑，后续给 member 加 `me:write` 即可）。
3. **公开页走独立 URL + 无守卫 API**：`GET /api/resume/public/:username` 不要求登录，
   只暴露档案卡本身；前端 `/p/:username` 在登录判断前用 pathname 匹配渲染，不为了单页引入
   Router，也不把公开页写入浏览 history。这样游客打开链接即可看，不污染工作台路由。
4. **编辑入口是 heredoc + JSON，不是表单**：`cat > ~/me/profile.json <<"JSON"` 的文本框 +
   `:wq 保存` / `:q! 取消`，延续终端气质；服务端做边界收敛（字段长度、数组条数、30KB 上限），
   避免脏 JSON 直接写库。
5. **终端命令语义 = focus**：输入 `whoami` 等命令只展开对应段落，`all` 全部展开，`clear` 全部收起；
   点击命令行头部则单独切换。默认全展开，首屏即是一张完整档案卡。
6. **`resume.get` 只读不写**：AI 可读取档案用于回答，但不注册写工具，避免模型擅自改简历；
   写操作只保留给人用的 `PUT /api/resume/me`。
7. **公开链接入口放在面板**：`⧉ 公开链接` 复制 `${origin}/p/<username>`，让公开页能力可被发现。

## 实现

- 共享协议：[resume.ts](file:///Users/lion/workspace/gocode/ai-workbench/packages/shared/src/resume.ts)
  （`ResumeBasics` / `ResumeExperience` / `ResumeSkillGroup` / `ResumeProject` / `ResumeProfile` /
  `ResumeDto` / `ResumeUpdateInput`），由 [index.ts](file:///Users/lion/workspace/gocode/ai-workbench/packages/shared/src/index.ts) 导出。
- 服务端：
  - [resume.service.ts](file:///Users/lion/workspace/gocode/ai-workbench/apps/server/src/resume/resume.service.ts)
    `getOwn` / `getPublic` / `update` + `normalizeProfile` 边界收敛 + 空档案骨架。
  - [resume.controller.ts](file:///Users/lion/workspace/gocode/ai-workbench/apps/server/src/resume/resume.controller.ts)
    `GET/PUT /api/resume/me`（`me:read` / `me:write`），`GET /api/resume/public/:username`（无守卫）。
  - [resume.tools.ts](file:///Users/lion/workspace/gocode/ai-workbench/apps/server/src/resume/resume.tools.ts)
    `resume.get`（`me:read`）。
  - [resume.module.ts](file:///Users/lion/workspace/gocode/ai-workbench/apps/server/src/resume/resume.module.ts)
    与 [app.module.ts](file:///Users/lion/workspace/gocode/ai-workbench/apps/server/src/app.module.ts) 接线。
- 前端：
  - [ResumeTerminal.tsx](file:///Users/lion/workspace/gocode/ai-workbench/apps/web/src/features/resume/ResumeTerminal.tsx)
    终端窗口 + 四段输出 + 命令输入 + 展开/收起。
  - [ResumePanel.tsx](file:///Users/lion/workspace/gocode/ai-workbench/apps/web/src/features/resume/ResumePanel.tsx)
    读取 `/resume/me`、JSON 编辑器保存、复制公开链接。
  - [PublicResumePage.tsx](file:///Users/lion/workspace/gocode/ai-workbench/apps/web/src/features/resume/PublicResumePage.tsx)
    `/p/:username` 公开只读页与 404 态。
  - [PanelZone.tsx](file:///Users/lion/workspace/gocode/ai-workbench/apps/web/src/shell/PanelZone.tsx) 接线、
    [HeroState.tsx](file:///Users/lion/workspace/gocode/ai-workbench/apps/web/src/shell/HeroState.tsx) 新增
    「打开个人简历」chip、[App.tsx](file:///Users/lion/workspace/gocode/ai-workbench/apps/web/src/App.tsx)
    在登录判断前识别公开页路径。

## 验证

- 构建：shared `tsc` 通过；server / web `tsc --noEmit` 0 错误；web `vite build` 通过（70 modules）。
- curl（owner 用 dev secret 手工签发 JWT）：
  - 无 token `GET /resume/me` → 401。
  - owner `GET /resume/me` → 空骨架、`canEdit=true`、`updatedAt=null`。
  - owner `PUT /resume/me`（prototype 同款数据）→ 200；随后 `GET /resume/public/lion` → 200，
    `canEdit=false`，3 段经历 / 4 组技能 / 2 个项目。
  - member `kbtest`：`GET /resume/me` → `canEdit=false`；`PUT` → 403；`GET /resume/public/kbtest` → 404。
  - `GET /tools`（member）返回包含 `resume.get`。
- 浏览器（960×640）：
  1. 未登录打开 `/p/lion`：标题 `~/p/lion/resume.term`，whoami、经历、技能、项目全部渲染，
     右上 `read-only`，无编辑入口，有返回工作台链接。
  2. `kbtest` 登录 → 首页 chip「打开个人简历」→ 面板 `read-only`、无「✎ 编辑」、空档案提示；
     底部输入 `help` 回车出现命令提示，四段命令均可点击。
  3. 临时 owner `resumeowner` 登录 → `rw · owner` → 点「✎ 编辑」出现 JSON 编辑器 →
     写入测试档案 → `✓ 已写入 ~/me/profile.json`，名称/经历/技能/项目即时刷新，
     头部出现 `updated hh:mm:ss`；`⧉ 公开链接` 提示复制成功。测试账号验证后已从 DB 删除。
- 说明：lion 的演示档案通过 curl 写入 dev 数据库；`kbtest` 仍为空档案，用于只读/空态验证。

## 遗留

- member 无自助编辑（按原型 ACL 只读）；如需开放，给 member 加 `me:write` 并调整 UI。
- JSON 编辑器只做语法解析 + 服务端长度收敛，没有 schema 提示/自动补全/格式化按钮。
- 公开可见性没有开关：只要保存过档案就公开；email 等字段默认展示，后续可做字段级可见性。
- 无头像、社交链接、PDF/打印导出、版本历史；公开页无 OG 分享卡片。
- `/p/:username` 用 pathname 匹配而非 React Router，后续若增加更多公开页应统一路由方案。
- `resume.get` 仅返回本人档案，没有按用户搜索/列举的 AI 工具。
- 写操作复用 SQLite 单行，未做并发冲突检测（last-write-wins）。
