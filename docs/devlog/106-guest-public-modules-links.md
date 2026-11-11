# 106 · 游客可直接浏览展示型模块（不止登录后）

日期：2026-11-10 ｜ 分支：main ｜ 类型：feature / ux

## 一、修正点

105 里游客点所有快捷入口都弹登录，过头了。实际规则应为：

| 能力 | 游客 |
|---|---|
| 博客 / 个人简历 / 百宝箱 / 联系我（展示型公开内容） | 可用，直接看 |
| AI 对话、CLI、评论 | 需登录 |
| 站内信（个人消息）、GitHub 观察窗（含私有仓库元数据） | 需登录 |

## 二、缺的那块拼图：站点主人 username

`/b /p /t /c` 公开页都已存在且匿名可读（`/api/blog/public/:username`、`/api/resume/public/:username`、
`/api/toolbox/public/:username`、`/api/profile/public/:username`），游客唯一缺的是**站点主人账号名**。

新增匿名接口：

- `GET /api/profile/owner-public` → `{ username, nickname }`
  （`ContactService.ownerPublic()`，经 `WorkspaceOwner` 解析站点主人，只回账号名与昵称，不暴露联系方式）

## 三、前端

- `lib/public-owner.ts`：`usePublicOwner()`，进程内缓存 + 并发合并，游客首页与顶栏共用；
- `HeroState`：
  - `PUBLIC_PAGES`：`blog → /b/:u`、`resume → /p/:u`、`tools → /t/:u`；
  - 游客点这些入口直接 `location.assign()` 到公开页；
  - 其余入口（站内信 / GitHub 观察窗 / CLI）仍 `requireLogin()`，reason 写明具体模块名；
  - 快捷入口区给游客补「联系我」按钮（`/c/:u`），与登录用户顶栏的联系入口等价。

## 四、验证（playwright-cli，1280×900，未登录新会话）

| 操作 | 结果 |
|---|---|
| 游客首页快捷入口 | 博客 / 站内信 / 个人简历 / 百宝箱 / GitHub 观察窗 / CLI 终端 / 联系我 |
| 点「博客」 | `/b/admin`，卡片墙正常渲染 |
| 点「个人简历」 | `/p/admin`，无错误提示 |
| 点「百宝箱」 | `/t/admin` |
| 点「站内信」 | 弹登录浮层，提示「登录后可使用「站内信」」 |
| 点「GitHub 观察窗」 | 弹登录浮层，提示「登录后可使用「GitHub 观察窗」」 |
| `GET /api/profile/owner-public` | `{"username":"admin","nickname":"admin"}` |

`pnpm --filter @aiwb/{web,server} exec tsc --noEmit` 均通过。

## 五、遗留

- GitHub 观察窗未对游客开放：接口用站点主人的 GitHub token 取数，repos / trending 会带出私有仓库元数据，开放前需要先确认"哪些字段可以公开"，否则容易泄隐私；
- 站内信是个人消息，游客没有对应数据，保持登录后可见；
- 若之后希望游客留在工作台布局里看这些内容（而不是跳到独立公开页），需要给面板加匿名只读数据源，属于后端改造。
