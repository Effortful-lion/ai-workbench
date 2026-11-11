# 105 · 游客直接进首页 + 受限功能原地登录浮层

日期：2026-11-10 ｜ 分支：main ｜ 类型：feature / ux

## 一、方案取舍

原状：`App.tsx` 里 `if (!user) return <LoginScreen />`，除 `/p /t /c /b` 公开页外全站硬门禁。

两个候选：

| 方案 | 结论 |
|---|---|
| A：登录页加「游客浏览」按钮 | 不省事——游客态适配（不拉鉴权接口、顶栏精简、入口拦截）两方案都要做，A 只是多一次点击 + 一份 `guestMode` 持久化 |
| B：直接首页，按需登录 | 采用 |

选 B 的理由：站内已有四个免登录公开页，产品定位本就是"可展示"；首屏直接是产品体验，转化更好；没有临时入口将来还要删。

登录引导采用**当前页浮层**（不跳转），登录后原地继续，输入框内容不丢。

## 二、改动

### 新增

- `stores/auth-modal.ts`：`useAuthModal`（`open` / `reason` / `requireLogin(reason?)` / `close`）；
- `features/auth/AuthForm.tsx`：从 `LoginScreen` 抽出的登录/注册表单（校验、验证码倒计时、开发兜底码、主题切换可选），支持 `reason` 与 `onSuccess`；
- `shell/AuthModal.tsx`：遮罩 + 居中卡片 + Esc/遮罩关闭，挂在**根节点**（`main.tsx`），因此公开页也能唤起；
- 删除 `features/auth/LoginScreen.tsx`（表单已复用，无其他引用）。

### 修改

- `App.tsx`：游客分支渲染 `TopBar + HeroState + StatusBar`，不再拦截到登录页；⌘K 命令面板仅登录态可用；
- `shell/TopBar.tsx`：游客顶栏只留品牌 / 「只读浏览」/ 主题 / 「登录 / 注册」；站内信、邮件、连接状态、昵称、退出全部隐藏；
- `shell/HeroState.tsx`：招呼语「访客」、启动行 `guest@workbench`；游客不请求 `/models`、不渲染模型选择器与「最近提问」；输入框回车 / 快捷入口 / 斜杠命令统一 `requireLogin()`；文案改为「只读浏览 · 登录后即可开始对话」；
- `shell/StatusBar.tsx`：游客显示 `[guest · 只读]`，隐藏 socket 状态；
- `features/blog/CommentThread.tsx`：未登录点「登录后发表」/「去登录」改为弹浮层（原来是 `window.location.assign("/")`）。

快捷入口仍按 `canOpenPanel(panel, role)` 过滤，游客（role 为空）自然只看到 member 可见的那批：博客、站内信、个人简历、百宝箱、GitHub 观察窗、CLI。

## 三、验证（playwright-cli，1280×900，未登录新会话）

| 场景 | 结果 |
|---|---|
| 未登录打开 `/` | 顶栏「只读浏览 · 登录 / 注册」，招呼语「下午好，访客！」，输入框可用 |
| 输入「游客试问一句」回车 | 弹登录浮层，提示「登录后即可开始对话」，输入框内容保留 |
| 浮层内 admin 登录 | 浮层关闭，顶栏切换为登录态，输入框内容仍是「游客试问一句」 |
| 点快捷入口「博客」 | 弹浮层；Esc 可关闭 |
| 公开博客页 `/b/admin/7823900a` 评论框点「登录后发表」 | 弹浮层，提示「登录后即可发表评论」，已输入内容保留 |
| 顶栏「✗ 退出登录」 | 回到游客首页（不再回登录页） |

控制台无 401 报错（游客态不发鉴权请求；`/api/stats/collect` 本就匿名开放）。
`pnpm --filter @aiwb/web exec tsc --noEmit` 通过。

## 四、遗留

- 游客从首页无法直达 `/b /p /t /c` 公开页：这些 URL 需要站点主人的 username，目前没有公开接口暴露，游客点快捷入口只能看到登录提示。若要"游客也能从首页逛公开内容"，需要加一个匿名接口返回站点主人 username；
- 游客能"看到"面板入口但不能看面板内容——面板接口都需要 JWT，若要游客只读浏览面板，得在服务端开匿名只读路由，范围较大；
- `api()` 在无 user 时仍会直接发请求并抛服务端原文（`Unauthorized`），入口已拦，暂未做统一话术。
