# 098 · 权限矩阵定稿：数据归属 admin / user

日期：2026-11-10 ｜ 分支：main ｜ 类型：feat

## 一、定稿规则

数据归属只有两种：

- **admin（owner）**：配置种入的特殊用户，绝大多数模块的数据与读写权都归它；
- **user（member）**：邮箱注册的普通用户，只参与「浏览 + 讨论」。

## 二、最终矩阵

| 模块 | 数据归属 | admin | user | 实现位置 |
|---|---|---|---|---|
| 模型管理 | admin | rw | 仅切换使用 | 面板 `models` 仅 owner；列表/选用走 `models:use`，增删改仍 `models:write` |
| AI 助手 | admin | rw | — | `agents:read/write` |
| 执行历史 | admin | rw | — | `agents:read` |
| 知识库 | admin | rw | — | `kb:read/write` |
| 博客 | admin | rw | r | `blog:read`；评论仅需登录 |
| 项目管理 | admin | rw | — | `projects:*` |
| 代码管理 | admin | rw | — | `code:*` |
| 日程管理 | admin | rw | — | `schedule:*` |
| 邮件管理 | admin | rw | — | `mail:*` |
| 商业化管理 | admin | rw | — | `commerce:*` |
| 客户管理 | admin | rw | — | `crm:*` |
| 流水线管理 | admin | rw | — | `pipe:*` |
| 工具管理（自定义工具） | admin | rw | — | `aitools:read/write` |
| 站内信 | 各自 | 全部 | 仅讨论类 | 服务端按 `type === "blog"` 过滤 |
| GitHub 观察窗 | admin | rw | r | `github:read`；Token 写入/删除 = `github:write` |
| CLI 终端 | — | 可用 | 可用 | `cli:use`，命令本身仍受各自权限约束 |
| 对象存储 | admin | rw | — | `storage:*` + 顶栏入口仅 owner |
| 访问统计 | admin | rw | — | 新增 `stats:read` |
| 个人简历 / 联系信息 / 百宝箱 | admin | rw | r | `resume:read`、`contact:read`、`toolbox:read` |

> 简历 / 联系 / 百宝箱本来就有公开页（`/p/:username`、`/c/:username`、`/t/:username`），游客都能看；登录后保留只读是最小惊讶的选择。

## 三、这次动到的关键点

### 1. 权限点命名空间整理

`tools:*` 一词原先同时表示「百宝箱」和「自定义工具（工具管理）」，无法单独收口。拆成：

- `toolbox:read/write` —— 百宝箱（`/toolbox`）
- `aitools:read/write` —— 工具管理（`/tools/custom`）
- `tools:read` 保留给 **Agent 工具目录**（chat 执行时按角色裁剪工具集）

`resume` / `contact` 也不再借用 `me:read`（语义是「我自己」，而读的是 admin），改为 `resume:read`、`contact:read`。`me:write` 仅剩「改昵称」一个用途。

### 2. GitHub 越权修复

`POST /github/account/token`（覆盖 Token）、`DELETE /github/account`（删除账号）原先标的是 `github:read`，等于任何 member 都能改写 admin 的 GitHub 凭证。改为 `github:write`，member 只有 read → 观察窗对所有人只读开放，符合定稿第 8 条。

### 3. 站内信分流

- 非 owner 的 `list` / `digest` 只返回 `type = blog`（评论/回复），摘要文案变成「评论 N」；
- `POST /notify/scan`（扫日程/邮件生成提醒）改为 `notify:scan`，仅 owner；
- 非 owner 创建站内信只允许 `blog` 类型，其余 400。

### 4. 访问统计加权限

`GET /stats/overview` 补 `PermissionGuard` + `stats:read`；`POST /stats/collect` 保持匿名（访客采集必须）。

### 5. 前端同步收口

`OWNER_ONLY_PANELS = models / agents / history / kb / projects / code / cal / mail / biz / crm / pipe / aitools / stats`，四处入口同时过滤（首页 chips、⌘K、CLI `open`、PanelZone 拒绝态）。另外：

- 顶栏邮件图标与 `/mail/digest` 轮询仅 owner；
- 模型选择器（首页 + 聊天栏）仅 owner，聊天栏对 member 不再请求 `/models`、`/agents`；
- GitHub 面板无 Token 时，member 看到「由站点主人配置」而不是绑定表单；
- 站内信面板的类型筛选对 member 只剩 `all` / `blog`，「扫描提醒」按钮仅 owner；
- 商业化 / 客户 / 流水线面板恢复 owner-only（上一轮曾放开只读）。

## 四、验证

构建：`@aiwb/shared`、`@aiwb/server`、`@aiwb/web` 全部通过；lint 0 诊断。

member 账号（真实邮箱注册）实测：

| 请求 | 结果 |
|---|---|
| `GET /blog/posts`、`/resume/me`、`/profile/contact`、`/toolbox/items`、`/github/account`、`/notify/digest`、`/notify/notifications` | 200 |
| `GET /kb/documents`、`/agents`、`/projects`、`/code/repos`、`/schedule/tasks`、`/mail/messages`、`/models`、`/tools/custom`、`/stats/overview`、`/commerce/digest`、`/crm/digest`、`/pipe/digest` | 403 |
| `POST /github/account/token`、`DELETE /github/account` | 403 |
| `POST /notify/scan` | 403 |
| `POST /notify/notifications {type:"system"}` | 400 |
| `POST /notify/notifications {type:"blog"}` | 201 |
| `GET /notify/digest` | `summary: "1 unread · 今日 1 条 · 评论 1"` |

owner（admin）侧回归：`/kb/documents`、`/stats/overview`、`/mail/messages`、`/models`、`/tools/custom`、`/agents` 全部 200。

测试账号与站内信已清理。

## 五、追加：模型「可切换不可管理」

定稿里「user 无模型读写权限」与「用户要能切模型」并不冲突——拆成两个动作：

- **管理**（增删改、设默认、连通性测试）：`models:write`，只有 owner；
- **使用**（列可选模型 + 选中某个模型发起对话）：新增 `models:use`，member 有。

实现上 `GET /models` 从 `models:read` 改为 `models:use`（同一接口同时服务管理面板和聊天选择器，返回的 DTO 本来就不含 apiKey，只有 `hasKey`）；前端首页与聊天栏恢复 `ModelPicker`，模型管理面板仍在 `OWNER_ONLY_PANELS` 里。聊天请求携带的 `modelId` 由 `models.pickModel()` 按 id 取用，不绑定归属。

实测：member `GET /models` 200（`hasKey:false`、无明文 Key）、`POST /models` 403。

## 六、追加：「如何联系我」对 user 可见

联系信息是 admin 的对外名片，注册用户也应该能看到（这正是「邮箱只对 admin 开放」的另一面：用户只能联系 admin）。

- 顶栏 `ContactBadge` 恢复对所有登录用户展示；
- 徽标里的跳转目标不再用「登录人 username」（普通用户没有自己的联系页），改用 `GET /profile/contact` 返回的 `username`——守卫已把它映射到 admin，所以点进去是 `/c/admin`；
- `contact.getOwn()` 在 `canEdit = false` 时只返回 `visibility === "public"` 的渠道，admin 的私密渠道不会因为「可读」而外泄。

实测：member `GET /profile/contact` → `username: "admin"`、`canEdit: false`、`channels` 仅 email + github（均 public）。

## 七、五个「展示型」模块的数据归属确认

明确这五个模块的数据归 admin，所有登录用户看到的是 admin 的内容（只读）：

| 模块 | 读接口 | 实测（member 身份） |
|---|---|---|
| 如何联系我 | `GET /profile/contact` | `username: admin`、仅 public 渠道、`canEdit: false` |
| 个人简历 | `GET /resume/me` | `username: admin`、`canEdit: false` |
| 博客 | `GET /blog/posts` | 返回 admin 已发布文章 |
| 百宝箱 | `GET /toolbox/items` | 返回 admin 的工具（Admin Tool） |
| GitHub 观察窗 | `GET /github/account` | 返回 admin 的账号（token 仅掩码） |

写权限全部归 admin（`resume:write` / `contact:write` / `blog:write` / `toolbox:write` / `github:write`），member 只有读。

顺带修了 `/c/:username` 页面的一处边界：原来用「URL 里的 username 是否等于登录人」判断是不是站长本人，导致普通用户访问 `/c/自己的名字` 时会误认为自己可编辑（而后端因 `contact:write` 返回 403）。现在改为 `username 相同 && role === "owner"` 才进入编辑态。

## 八、遗留

- `POST /github/ask`、`/github/review-draft` 仍是 `github:read`（只读分析，但会消耗模型额度）；若担心 member 刷额度，可再收紧成 `github:write`。
- `POST /stats/collect` 接受 body 里的 `userId`，可被伪造；只在统计口径上失真，无越权。
- 站内信非 owner 只按 `type=blog` 过滤，未按「消息来源用户」细分（例如 admin 回复 vs 其他用户回复）；目前讨论消息都会进来。
