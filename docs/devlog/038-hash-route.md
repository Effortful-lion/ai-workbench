# 038 · Hash 路由（刷新保持页面）

- 日期：2026-11-03
- 状态：✅ 已完成（构建通过 + 浏览器实测刷新还原 PASS）

## 目标

修复"在某个页面刷新后自动回到首页"的问题。正常的逻辑应该是：在某个页面刷新之后，仍然停留在那个页面。

## 根因

应用没有任何路由机制。面板（panelStore.open/active）、会话（chatStore.currentId）、CLI（uiStore.cliOpen）全部只存在内存 Zustand 里，刷新即丢；App.tsx 的三态计算（`currentId || pendingNew || panelCount > 0 ? "B" : "A"`）在刷新后全部归零 → 回落到 A 首页。

## 决策

- **hash 路由而非 react-router**：SPA 单页 + 已有公开页用 pathname（`/p/:user`、`/t/:user`）直连，引入 router 成本高；hash 方案零依赖、不需要服务端 rewrite 配置，刷新天然保留。
- **stores 是唯一事实源，hash 是投影**：不手写"点击时同时改 store 和 URL"的分散逻辑，而是订阅三个 store 的变化统一序列化写 URL；读路径只在初始化和 hashchange（手动改 URL / 前进后退）时灌回 stores。
- **写路径用 `history.replaceState`**：不触发 hashchange 事件，天然避免"写 → 读 → 写"循环；也不污染浏览器历史（每次状态变化不新增历史条目）。
- **URL 格式**：`#/p=mail,models&a=models&c=<convoId>&cli`——p=面板列表（保持 tab 顺序）、a=激活面板（等于首个时省略）、c=会话 id、cli=CLI 覆盖层；空状态为 `#/`（写路径时直接清掉 hash，保持 URL 干净）。
- **公开页豁免**：`/p/:user`、`/t/:user` 只读页面不参与 hash 同步（不会在公开简历页 URL 上挂应用状态）。
- **失败自愈**：会话 id 失效（已删除）时 openConversation 静默失败，后续任意状态变化会把 URL 重写为当前真实状态。

## 实现

- `apps/web/src/lib/route.ts`（新增）：
  - `parseHash` / `serializeHash`：hash ↔ RouteState 编解码，面板 id 用 PANEL_IDS 白名单过滤。
  - `currentHash()`：读三个 store 序列化当前状态（写路径与去重判断共用）。
  - `applyRoute(r)`：hash → stores；面板差异比对后 setState，cli 差异比对后 setCli，会话差异时 openConversation（异步 REST，失败静默）或 newChat。
  - `useHashRoute(enabled)`：读路径（hydrated ref 保证只初始化一次 + hashchange 监听，入参与 currentHash() 比对去重）；写路径（订阅 panel/chat/ui 三个 store，replaceState 写 URL）。
- `apps/web/src/App.tsx`：import useHashRoute，在所有早退 return（公开页、登录屏）之前调用 `useHashRoute(!!user)`，保证 hook 无条件执行。

## 验证

- `pnpm --filter @aiwb/web build` 通过（vite build 无错）。
- browser_use 实测：
  - 直接打开 `http://localhost:8701/#/p=mail` → 邮件管理面板（tab 条 + 邮箱账户/写邮件/同步收件箱等）正确渲染，无需任何点击。
  - 刷新页面 → URL 保持 `#/p=mail`，邮件面板依然可见。
- 后端 8700（server.sh 守护）+ 前端 8701（vite dev）常驻验证环境。

## 遗留

- 多 tab 面板的刷新还原已支持（p 列表 + a 激活位），但 fullscreen 状态不编码进 URL（刷新后退出全屏，属合理默认）。
- 会话还原走 REST 拉消息，大会话首次渲染略有加载间隙（可后续加骨架）。
