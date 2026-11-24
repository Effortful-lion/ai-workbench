# 108 · 启用 React Query（方案 A）

日期：2026-11-11 ｜ 分支：main ｜ 类型：perf / refactor

## 一、背景

`@tanstack/react-query` 早已在 `apps/web/package.json` 里，但全项目 0 处使用。
所有面板 `useEffect` 挂载即 `api()`，`PanelZone` 只渲染当前激活项，切走卸载、切回重新请求并闪 loading。
实测本地 SQLite 接口 1–10ms、GitHub 快照 TTL 内 1.5–2ms，瓶颈不在服务端，而在**重复请求**。
用户选择方案 A：统一接入 React Query。

## 二、基础设施

- `lib/query.ts`：`queryClient`，默认 `staleTime: 30s` / `gcTime: 5min` / `retry: 1` /
  `refetchOnWindowFocus: true` / `refetchOnReconnect: true`；
- `QK`：统一 query key（models / blog posts / comments / moderation / notify digest+list / resume / toolbox）；
- `invalidate(...keys)`：写操作后按 key 失效并后台校准；
- `useAuthStore.subscribe`：user.id 变化（登录/登出/换账号）立即 `queryClient.clear()`，私有数据不串号；
- `main.tsx`：包一层 `QueryClientProvider`。

## 三、改造范围

| 文件 | 改动 |
|---|---|
| `ModelsPanel` | `useQuery(QK.models)`；删除乐观删除用 `setQueryData`；写后 invalidate |
| `BlogPanel` | 文章 / 审核队列（含 filter key）/ 阅读页评论三个 `useQuery`；审核、发评论后 invalidate |
| `NotifyPanel` | digest + list 两个 `useQuery`；乐观读/删/全部已读改为 `setQueryData`，红点事件保持不变；摘要变化同步顶栏 |
| `ResumePanel` / `ToolboxPanel` | `useQuery`；保存/导入/新增/删除直接改缓存或 invalidate |
| `HeroState` / `ModelPicker` / `ChatColumn` / `AgentsPanel` / `PipePanel` | 共用 `QK.models`，同一时刻只发一次 `/models` |
| `stores/agents.ts` | `loadedFor = userId` 去重 + 请求前占位（修掉 StrictMode 双跑 effect 造成的并发重复 `/agents` `/tools`）；写操作 `load(true)` 强制刷新 |

游客态不触发鉴权查询：HeroState 的 `/models` 用 `enabled: !!user`，其余面板本身只在登录态挂载。

## 四、实测（playwright-cli，dev 8701，admin）

按 `#/p=xxx` 打开面板 → 关闭 → 重开，统计 `/api` 请求：

| 面板 | 首次打开 | 30s 内重开 |
|---|---|---|
| 百宝箱 `tools` | `/agents` `/tools` `/toolbox/items` 各 1 | 0 |
| 博客 `blog` | `/blog/posts` `/blog/moderation/comments?status=pending` | 0 |
| 站内信 `notify` | `/notify/digest` `/notify/notifications` | 0 |
| 模型 `models` | 0（模型缓存已由首页建立） | 0 |
| 简历 `resume` | `/resume/me` | 0 |

补充验证：

- 重开简历面板 DOM 文本长度与首次一致（2226 字符）、无错误提示 —— 缓存确实渲染了数据；
- 退出登录 → 游客态 → 重新登录 → 打开简历，`/resume/me` 重新请求 1 次 —— 换账号缓存已清；
- 控制台无 React Query 报错；`pnpm --filter @aiwb/web exec tsc --noEmit` 通过。

## 五、遗留

- GitHub、邮件、知识库、日历、统计、CRM 等面板仍是 `useEffect + api()`，每次打开会重新请求，可继续迁移；
- GitHub 冷启动 0.9–1.2s 来自外部 API（服务端已有 profile 30min / repos 15min / calendar 24h 快照 TTL），前端缓存只能减少重复进入时的等待，不能消除首次；
- 生产包仍是单个约 922KB 的 JS，首屏体积可后续做代码分割；
- dev 模式 Vite 转译开销与接口缓存无关。
