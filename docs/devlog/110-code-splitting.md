# 110 · 代码分割（首屏拆包）

日期：2026-11-11 ｜ 分支：main ｜ 类型：perf / build

## 一、背景

108/109 解决了接口重复请求，但生产包仍是单个 `index-*.js` 901KB：
19 个面板、4 套公开页、命令面板、CLI、对话列连同 react-markdown 全家桶全部静态打进首屏。

## 二、改动

| 位置 | 处理 |
|---|---|
| `shell/PanelZone.tsx` | 19 个面板由静态 import 改为 `React.lazy(() => import(...))`，内容区包 `Suspense`，加终端风占位 `⠋ 正在载入 ~/p/{title}` |
| `App.tsx` | 4 个公开页 + `ChatColumn` / `CliOverlay` / `CommandPalette` 改 lazy；`ChatPane` 包装对话列占位；`CommandPalette` 改为 `paletteOpen` 时才挂载（⌘K 才下载） |
| `features/blog/PublicBlogPage.tsx` | `BlogReader` 改 lazy：卡片墙列表页不再下载 markdown 全家桶，点开文章时才加载 |
| `vite.config.ts` | 补 `preview.proxy`（`/api`、`/socket.io` → 8700），便于用 `vite preview` 验证真实构建产物 |

保留静态：`TopBar` / `HeroState` / `StatusBar` / `PanelZone` / `ConfirmDialog` / `ToastHost` / `AuthModal`
（首屏或随时要弹的全局组件）；`PanelZone` 若也 lazy 会与面板 chunk 形成两跳串行加载。

## 三、构建结果（`pnpm --filter @aiwb/web build`）

| 指标 | 改前 | 改后 |
|---|---|---|
| 入口 `index-*.js` | 901 KB | **345 KB**（gzip 109.8 KB） |
| 首屏静态 JS 总数 | 901 KB | **≈356 KB**（index + react 0.6K + auth 2.2K + jsx-runtime 8.7K） |
| 拆分出的 chunk | 0 | 19 面板（2–38 KB）+ 4 公开页 + 阅读器 + 对话列 + CLI/命令面板 |
| 共享 markdown chunk | 在入口里 | `lib-*.js` 161 KB（gzip 48 KB），只在进入对话/阅读器/知识库时下载 |

入口 `index.html` 的 `modulepreload` 只有 `jsx-runtime`、`auth`、`react` 三个小 chunk；
`lib` / `src` / 各面板都是动态引用。

## 四、验证（`vite preview` 4173 + playwright-cli，真实构建产物）

| 场景 | 新增 JS chunk |
|---|---|
| 打开首页 `/` | `index` `react` `auth` `jsx` 共 4 个 |
| 登录成功 | **0** |
| 按 ⌘K | 仅 `CommandPalette` |
| 首次打开邮件面板 | `agents` `markdown` `ChatColumn` `MailPanel` `src` `lib`（对话列 + markdown 是 mode B 必需） |
| 关闭再打开同一面板 | **0** |
| 打开 `/b/admin` 列表 | 仅 `PublicBackLink` `PublicBlogPage` `BlogCardWall`，无 markdown |
| 点开文章进阅读层 | `BlogReader` + `lib`，阅读器渲染正常、无报错 |

控制台无 React/lazy 报错；`pnpm --filter @aiwb/web exec tsc --noEmit` 通过；预览服务验证后已关闭，4173 无残留。

## 五、遗留

- 首次打开某个面板/阅读层会多一次小 chunk 请求，已用 Suspense 占位承接；如需进一步消除，可在快捷入口 hover 时预取对应模块；
- `ChatColumn` 依赖 react-markdown 全家桶（161 KB 共享 chunk），首次进入对话状态必下，进一步瘦身要换轻量渲染器；
- 未做 `manualChunks` 手动拆 vendor：Vite 已自动拆出 react / jsx-runtime / 共享库，再加规则收益有限且容易引入 chunk 循环。
