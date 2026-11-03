# 019 · 访问统计 Bug 修复 + 端到端验证

- 日期：2026-11-02
- 状态：✅ 完成（4 个 bug 修复 + curl API 全通 + 浏览器 8/8 PASS）

## 目标

修复 018 实现的 Stats 模块中遗漏的 bug（单位不一致、外键、Zustand subscribe 用法、循环依赖），然后做完整端到端验证。

## Bug 清单与修复

### BUG 1 · 原生 SQL 毫秒 vs 秒（严重，数据全错）
**位置**：`stats.service.ts` 第 127 行、第 149 行
**现象**：`date(createdAt, 'unixepoch')` 能正确工作（DB 存 unix epoch 秒），但原生 SQL 模板字符串 `${visits.createdAt} < ${Date.now() - 86400 * 1000}` 直接嵌入毫秒时间戳。
**根因**：Drizzle 的 `gt(col, new Date(x))` 会自动把 Date 对象转秒，但 `` sql`${col} < ${ms}` `` 不会转换。
**修复**：原生 SQL 里手动 `Math.floor(ms / 1000)` 转秒；`countAfter` 方法参数改名 `startMs/endMs` 显式语义。

### BUG 2 · 外键约束 500
**位置**：`StatsService.bulkInsert`
**现象**：curl 测试带假 userId 时 `FOREIGN KEY constraint failed` → 500。
**根因**：`visits.user_id REFERENCES users(id)` 但 collect 是**无鉴权**接口，恶意请求可伪造不存在的 userId。
**修复**：collect 接口**不信任前端传来的 userId**，bulkInsert 里强制 `userId: null`。userId 关联后续走有鉴权的补录接口。

### BUG 3 · panelStore.subscribe 不是函数（前端白屏崩溃）
**位置**：`collector.ts`
**现象**：浏览器打开 `TypeError: panelStore.subscribe is not a function`，整个 React 应用崩溃白屏。
**根因**：`const panelStore = usePanelStore()` 返回的是**状态对象**（无 subscribe），`.subscribe()` 在 **store 函数本身** 上：`usePanelStore.subscribe(...)`。
**修复**：删掉 `const panelStore = usePanelStore()`（useEffect 里根本不需要状态），改调用 `usePanelStore.subscribe(callback)`。

### BUG 4 · 条件 require 死代码 + 实际循环依赖不存在
**位置**：`collector.ts`
**现象**：`getCurrentPath()` 和 `getPanelPath()` 定义了但从未被调用，其中 `require("../stores/chat")` 是之前为了"怕循环依赖"加的条件加载。
**验证**：grep 确认 `stores/chat.ts` 没有 import collector → 实际不存在环。
**修复**：删除两个死函数 + 条件 require 代码。

## 附加改进

### Rate limit（防刷）
**位置**：`StatsService.bulkInsert`
**实现**：内存 Map `sessionId → lastCollectTs`，同 sessionId 10s 内最多 1 次 collect。每 20s 清理过期条目（`RATE_WINDOW_MS * 2`）。前端 batch flush 本身是 30s 心跳，所以这个限制对正常用户无感，但能防脚本疯狂刷。

### 前端 userId 传递（预留）
collector.ts 的 `enterPage()` 已经读取登录用户的 `useAuthStore.getState().user?.id` 并写入 batch row，但后端 bulkInsert 目前强制 null（因为无鉴权）。后续可加有鉴权的 `/api/stats/link-user` 接口补录 userId。

## 验证

### curl API（后端）
```bash
# collect（无鉴权，带假 userId 也能进，因为后端强制 null）
POST /api/stats/collect → {"ok":true,"inserted":1}  # rate limit 去重同 sessionId 批量

# login + overview
GET  /api/stats/overview?days=7 → {
  pv: 11, uv: 10, todayPv: 11, yesterdayPv: 0,
  totalDurationMs: 45000, avgDurationMs: 4091,
  trend: [{date:"2026-11-02", pv:11, uv:10}],
  topPages: [{path:"/chat", pv:5}, {path:"/", pv:3}, {path:"/stats", pv:2}],
  activeSessions1h: 10, newVisitors24h: 10
}
```
全部字段与 DB 实际数据一致。

### 浏览器端到端（8/8 PASS）
1. ✅ 页面正常渲染（非空白，无崩溃）
2. ✅ 注册 testuser 并自动登录
3. ✅ Hero 区显示"打开访问统计"按钮，点击进入 StatsPanel
4. ✅ 数字卡片：总 PV 11、总 UV 10、今日 PV 11、活跃 1h 10
5. ✅ 会话时长文本：总停留 45.0s，平均 4.1s/页
6. ✅ 热门页面 Top 4，ASCII bar chart（■□）：~/chat 5、~/ (首页) 3、~/stats 2、~/models 1
7. ✅ 7 日趋势 ASCII bar chart：2026-11-02 PV 11 UV 10
8. ✅ 无空白态、无空数据提示、无崩溃

## 经验教训

1. **Drizzle 的 Date 自动转换只对 ORM 方法有效**，原生 SQL 模板字符串必须手动处理时间单位。
2. **Zustand 的 subscribe 在 store 函数上**，`const store = useStore()` 返回的状态对象没有 subscribe — 新手高频踩坑。
3. **外键约束 + 无鉴权写接口** = 必然 500。要么去掉外键，要么不信任前端传的关联 ID。
4. **死代码里藏着循环依赖的假恐惧** — 之前为了"怕环"加了条件 require，实际 grep 一下就知道根本没环。
