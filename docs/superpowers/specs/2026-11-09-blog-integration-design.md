# 博客子模块 · 系统集成设计

> 日期：2026-11-09 · 状态：设计定稿，未进入编码
> 上游文档：原型 `docs/prototype/blog.html`（已交付）、`2026-11-08-agent-team-research.md`（AI 生产内容路径相关）
> 定位：**工作台的一个内容子模块**，不是独立站点。本文回答两个问题：哪些能力不许重复造；与哪些模块必须联动。

---

## 1. 设计理念：博客是系统的"发表出口"，不是平行世界

工作台已有的东西可以概括为三层：**生产层**（chat/agents/pipe 产文本）、**沉淀层**（KB 存知识、projects/code 存成果）、**分发层**（resume/toolbox/contact 公开页、notify 通知、mail 邮件）。博客恰好落在三层的交汇处：

```
chat/agents/pipe ──产出──▶ 草稿（博客）
                              │ 发布
                              ▼
                        博客文章 + 评论
                        ▲          │
              KB 摄取入库      notify 通知评论
              （沉淀层回收）    （分发层触达）
```

一句话原则：**博客只新增"文章 + 评论"两个实体，其余一律挂靠现有模块**——权限挂在 auth/roles，发布时机挂在 schedule 的提醒机制，通知挂在 notify，插图挂在 storage，渲染挂在 lib/markdown，AI 能力挂在 tools 注册表。

## 2. 去重清单（明确不做的）

| 博客常见功能 | 系统已有 | 结论 |
|---|---|---|
| 登录/评论者身份 | auth 三级角色（owner/member/guest，`packages/shared/src/roles.ts:2`） | 复用；游客评论=公开页匿名 + 昵称（与原型一致），登录用户自动带身份 |
| 评论通知推送 | **notify 站内信已完整**（`notify.controller.ts`，类型 system/schedule/mail，TopBar 60s 轮询红点） | 只扩 `NotificationType` 加 `"blog"`，不新建推送体系 |
| 定时发布 | schedule 任务 + upcoming 扫描（无 cron，前端轮询模式） | 定时发布 = 一条 `type=blog` 的 schedule 任务到点触发 publish，不引入新调度器 |
| Markdown 渲染 | `lib/markdown.tsx`（react-markdown + gfm + breaks，含表格/图片） | 复用，仅补 rehype-highlight 代码高亮插件 |
| 图片上传 | storage 模块 `POST /storage/presign/put` 客户端直传 MinIO | 复用，编辑器加一个 presign→PUT 的小上传按钮 |
| AI 撰写/审校 | agents + pipe（SOP 步骤链、断点重试） | 不内置"AI 写作"功能；用 pipe SOP（草稿→扩写→审校→排版）产出 Markdown，人工粘贴/一键导入草稿 |
| 分类树 | KB KbTreeView 目录树交互 | 博客分类保持**平铺标签**（原型 #知识库/#Agent/#管道/#随笔），不做层级树——博客分类是导航词，不是知识组织（KB 的职责） |
| 访问统计 | stats 模块 + `lib/collector.ts` 前端采集 | 公开页阅读量直接走 stats 现有埋点，博客表不建 read_count 字段 |

## 3. 联动点设计（按模块）

### 3.1 面板与路由（web shell）
- 后台管理面板 `features/blog/BlogPanel.tsx`：走**面板注册四件套**——`stores/panel.ts`（PANEL_IDS/PANEL_META）→ `shell/PanelZone.tsx`（PANEL_BODY）→ `lib/commands.ts`（`/blog` 命令）→ 新组件；原型中"台账列表"即此面板的管理态（草稿/已发布/评论管理）
- **公开阅读页 `/b/:username/:slug`**：照抄 App.tsx:70-75 的公开 pathname 匹配模式（同 `/p/` 简历、`/t/` 百宝箱），无需登录；阅读页排版 = 原型"深度阅读页"（左目录 + 680 版心 + 评论）
- 复用全局件：ConfirmDialog（删除确认）、ToastHost（发布/评论反馈）、PickerChip（状态/分类筛选）、ModelPicker（AI 草稿场景）

### 3.2 权限（auth/roles）
- 新增权限点：`blog:read / blog:write / blog:publish`，加入 roles.ts 的 member 权限数组；guest 仅公开页匿名读 + 评论（评论可开关，默认开、需人工过审可选）

### 3.3 KB（沉淀层回收）
- 发布动作可选勾选 **"同步入库 KB"**：服务端发布成功后调 `KbService.ingest(userId, { title, content, folderId: 博客归档目录 })`（`kb.controller.ts:22`，纯文本摄取接口现成）
- 反向联动：KB 问答（`/kb/ask` deep 模式）因此天然能检索到已发表文章——博客内容成为工作台大脑的一部分，这是"不割裂"的核心体现

### 3.4 notify（评论触达）
- 评论/回复落库时 `NotifyService.create({ type:"blog", title:"新评论", body:"《文章》收到 xx 的评论", link:"/b/:slug" })`；TopBar 铃铛红点自动生效，零新代码路径
- 未来若做邮件通知，mail 模块已有，同理挂钩

### 3.5 schedule（定时发布）
- 草稿表加 `publishAt` 字段；保存定时发布时创建 schedule 任务（`type:"blog", remindAt: publishAt`）；到点由现有 upcoming 扫描/TopBar 轮询触发 `publish()`，并回写任务状态。**不建 cron**

### 3.6 tools（AI 能力挂钩）
- 新建 `apps/server/src/tools/blog.tools.ts`，用 `@RegisterTool` 挂三个工具：
  - `blog.search(keyword, category)` → `blog:read`：让主对话 agent 能检索已发表文章（配合 KB 形成双通道）
  - `blog.draft(title, markdown)` → `blog:write`：AI 在对话里直接落草稿
  - `blog.listPending()` → `blog:write`：AI 巡检待发布队列
- 这样"写博客"成为 agent 的一种工作能力，而非博客模块自带的 AI 功能——与 agent-team-research 的路线一致

### 3.7 storage（插图）
- 编辑器插图按钮：`presign/put` 拿直传 URL → PUT MinIO（对象路径 `ai-workbench/blog/:postId/:n.png`）→ Markdown 插入 `![](...)`（存对象路径，读取走 presign/get）

## 4. 数据模型（最小集）

```
blog_posts:   id, authorId→users, slug(唯一), title, summary, contentMd,
              category(enum: kb/agent/pipe/essay), tags(json), status(draft/published/archived),
              publishAt?, publishedAt?, kbDocId?(入库回链), createdAt/updatedAt
blog_comments: id, postId→blog_posts, userId?(可空=游客), nickname, content,
              parentId?(一级回复), status(pending/approved/hidden), createdAt
```
- 评论只需一级回复（原型已验证够用）；游客评论默认 `approved`，可配置为 `pending` 人工过审
- slug 由标题拼音/编号生成，公开页 URL 友好

## 5. API 面（沿用现有风格）

| 端点 | 权限 | 说明 |
|---|---|---|
| `GET/POST/PATCH/DELETE /blog/posts` | blog:read/write | CRUD + 状态流转；PATCH publish 原子发布（+可选 KB ingest） |
| `GET /blog/public/:username/:slug` | 匿名 | 公开页取数（仅 published） |
| `GET /blog/public/:username` | 匿名 | 公开台账列表（分类/排序参数） |
| `GET/POST/PATCH/DELETE /blog/comments` | 匿名 post / blog:write 管理态 | 评论 CRUD + 过审/隐藏 |
| blog.tools.ts 三工具 | 见 3.6 | 注册表自动发现 |

## 6. 原型 → 实现的映射

| 原型交互 | 实现归宿 |
|---|---|
| 台账列表（分类词、⇅ 排序、悬停摘要） | BlogPanel 管理态（登录）+ 公开列表页（匿名，同组件） |
| FLIP 全屏阅读页（左目录 scrollspy） | 公开页 `/b/:u/:slug`；hash 路由换成真 pathname 路由 |
| 评论嵌套 + 昵称发布 | 公开页评论组件；登录态带 userId，notify 联动 |
| 主题 token/ConfirmDialog 等 | 全部已是全局基建，零迁移 |

## 7. 非目标（本轮明确不做）

- 评论楼层嵌套 >1 级、评论点赞、富文本编辑器、独立站点路由/SEO sitemap（可后补）、邮件订阅、多语言
- AI 自动发布（永远人工点发布键，AI 只产草稿——与"Agent 只到草稿为止"的安全边界一致）
