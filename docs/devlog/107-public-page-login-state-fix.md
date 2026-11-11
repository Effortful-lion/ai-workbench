# 107 · 公开页登录后「返回页面错乱 / 变回游客」

日期：2026-11-10 ｜ 分支：main ｜ 类型：fix / routing / state

## 一、现象

路径：游客首页 → 快捷入口「博客」（`/b/admin`）→ 点开一篇文章（`/b/admin/:slug`）→ 评论区点「登录后发表」→ 浮层登录成功 → 点返回。
结果：返回到的页面不对；继续返回首页后，登录态又显示成游客。

## 二、根因（两处）

### 1. hash 路由把博客公开页当工作台处理（页面错乱）

`lib/route.ts`：

```ts
const isPublicPath = () => /^\/(p|t|c)\//.test(window.location.pathname);
```

漏了 `/b`。游客时 `useHashRoute(!!user)` 的 `enabled === false`，一切正常；**登录成功后 `enabled` 变 true**，
该 hook 立刻在博客页上开始工作：

- 读路径：`applyRoute()` 会按 hash 还原面板/会话（此时 hash 为空 → `newChat()`）；
- 写路径：任意 panel/chat/ui store 变化都会 `history.replaceState(null, "", ...)`，
  把 `PublicBlogPage` 写入的 `{ blog: slug }` **清成 null**，并在状态与 URL 不同步时改写地址。

于是 `PublicBlogPage.close()` 里的 `window.history.state?.blog` 判断失效，返回逻辑走到 replaceState 分支，
历史栈被污染 —— 这就是"返回的页面不对"。

### 2. bfcache 恢复没有重新水合登录态（登录态变游客）

真实浏览器「后退」回到首页时，若命中 bfcache，页面**不会重新执行初始化**：React 树与 zustand store
都停留在离开前的内存快照（也就是游客态），而 `localStorage` 里已经是登录用户。
`persist` 只在初始化时读存储，所以顶栏仍按 `user === null` 渲染 —— 表现为"登录后又变回游客"。

## 三、修复

`apps/web/src/lib/route.ts`

- `isPublicPath` 纳入博客：`/^\/(p|t|c|b)(\/|$)/`，公开页（含 `/b/:username/:slug`）不再被 hash 路由接管；
- `write()` 改为 `history.replaceState(history.state, ...)`，保留其他代码写入的 `{ blog: slug }`，不再一律清空。

`apps/web/src/App.tsx`

- 新增 `pageshow` 监听：`event.persisted === true`（bfcache 恢复）时
  `useAuthStore.persist.rehydrate()` 从 localStorage 重新水合，若恢复了用户但内存里没有 accessToken，
  再跑一次 `refreshSession()` 补票（随后 `connect()` 才会连上 socket）。

## 四、验证（playwright-cli，1280×900）

完整路径：退出登录 → `/`（游客）→「博客」→ 点卡片 → 阅读层评论框 → 点「登录后发表」→ 浮层登录 admin → 返回。

| 检查点 | 结果 |
|---|---|
| 阅读层 URL | `/b/admin/7823900a`，无 `#/...` 污染 |
| `history.state` | 登录前后都是 `{"blog":"7823900a"}`，未被清空 |
| 点「返回博客」 | 回到 `/b/admin`，卡片墙正常，阅读层已关闭 |
| 再后退到 `/` | 顶栏 `admin [owner]`，未变游客；`localStorage.aiwb-auth` 仍为 admin |
| 登录浮层 | 登录成功后自动关闭，已填评论内容保留 |

说明：headless Chromium 未命中 bfcache（`window` 标记在后退后丢失、`navigation.type = back_forward` 为重新加载），
因此 bfcache 那条修复无法在该环境端到端复现，属于按真实浏览器行为做的防御性修复；
hash 路由与 history.state 两处修复已实测通过。

`pnpm --filter @aiwb/web exec tsc --noEmit` 通过。

## 五、遗留

- `PublicBlogPage.close()` 仍以 `history.state?.blog` 判断是否为站内打开，若将来有代码再清 state 会退回 replaceState 分支；
- 公开页在登录态下不做 hash 路由投影，返回首页后由首页自己按 hash 还原，属预期行为。
