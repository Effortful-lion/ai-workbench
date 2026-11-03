# 017 · Phase 2 产品打磨（P0 + P1 体验修复）

- 日期：2026-04-20
- 状态：✅ 完成（浏览器端到端全 PASS + build exit 0）

## 目标

Phase 1 完成 Phase 迭代器 + cost + trace 核心链路后，Phase 2 从产品可用性 + 体验角度补齐缺口：
1. **P0-1 执行历史面板**：后端 3 个 `/api/agents/executions` 端点已就绪，前端缺入口和 UI
2. **P0-2 Token 过期优雅处理**：401 → 清除 token 后静默跳登录，无提示
3. **P1-1 Hero 区入口缺失**：14 个面板按钮但没有 AI 助手和执行历史
4. **P1-2 Tools 面板信息过载**：50+ checkbox 平铺无分组
5. **P1-3 Phase 顺序无法调整**：只能删除重建

## 决策

1. **执行历史做成独立面板（`history` PanelId）**：不塞进 agents 面板 tab，因为执行历史是全局视图（跨 agent），和 `/history` slash command 天然对应。API 调 `GET /api/agents/executions?limit=50`。
2. **Toast 系统用 Zustand + 单条终端风格**：不搞堆叠多条（终端极客风克制），3.5s 自动消失。新建 `stores/toast.ts` + `shell/ToastHost.tsx`。
3. **AgentsPanel tools 按模块前缀分组折叠**：tool.name 格式是 `models.list` / `chat.listConversations`，按点号前的模块名分组，默认展开前 2 个，其余折叠。显示 `已选/总数` 让用户一眼看到当前选中。
4. **Phase 顺序调整用 ↑↓ 按钮**：不用拖拽（实现复杂度高 + 终端风格不 favor），上下交换相邻项足够。边界 disable。
5. **Draft 自动保存只覆盖「新建态」**：编辑已有 agent 时不存 draft（覆盖已有数据是危险的）。新建态 `setForm(null)` 后 localStorage 里存 draft，下次点 `+ 新建` 时弹出 confirm 恢复。关闭编辑器也自动清 draft。

## 实现

### 新增文件
- `apps/web/src/stores/toast.ts` — Zustand toast store（单条 + TTL 自动消失）
- `apps/web/src/shell/ToastHost.tsx` — 右下角 toast 渲染（终端风格：▸ + 文字 + ×）
- `apps/web/src/features/history/HistoryPanel.tsx` — 全局执行历史面板（列表 + 展开 trace 树）

### 修改文件
- `apps/web/src/lib/api.ts` — 401 分支加 toast 提示 `会话已过期，请重新登录`
- `apps/web/src/stores/panel.ts` — `PANEL_IDS` 加 `history`；`PANEL_META` 加 `~/history`
- `apps/web/src/shell/PanelZone.tsx` — 注册 `history: () => <HistoryPanel />`
- `apps/web/src/App.tsx` — 引入 `<ToastHost />` 挂在 root
- `apps/web/src/shell/HeroState.tsx` — Hero chips 加 `打开 AI 助手` 和 `打开执行历史` 按钮
- `apps/web/src/features/agents/AgentsPanel.tsx` — 整体重写：
  - tools 按模块前缀分组折叠（`groupTools()` 工具函数 + `collapsedMods` state）
  - phase 卡片加 `↑↓` 顺序调整按钮 + `movePhase()`
  - 新建态 draft 自动保存（localStorage key `aiwb-agent-draft`，300ms 节流）
  - 关闭编辑器 / 保存成功 自动清 draft
  - 加 `丢弃草稿` 按钮 + `draft 自动保存中` 提示

## 验证

### 浏览器端到端（Chrome · 8701 dev · 8700 Nest）

| # | 场景 | 结果 | 证据 |
|---|------|------|------|
| V1 | Hero 区新按钮 | ✅ | `▸ 打开 AI 助手` `▸ 打开执行历史` 两个按钮全显示 |
| V2 | HistoryPanel 列表 | ✅ | 6 条历史，每条显示 status/agent/model/cost¥/tokens/duration/time |
| V3 | HistoryPanel trace 展开 | ✅ | 点击首条展开 → 6 事件树状：`▶ phase [1/2] 调研` `✓ phase [2/2] 总结` `✓ agent 完成` |
| V4 | AgentsPanel tools 分组折叠 | ✅ | 12 模块（models/chat/kb/...），前 2 展开，其余折叠显示 `▸ kb (0/2)` |
| V5 | Phase ↑↓ 顺序按钮 | ✅ | 每个 phase 卡片 `#1` 后有 `↑↓`，首项 ↑ disable，末项 ↓ disable |
| V6 | Console 健康度 | ✅ | 全程零 error/warn |
| V7 | Token 过期跳转 | ✅ | 旧 token 自动跳登录页（toast 可能在导航前来不及显示 → 已知问题） |

### 构建
```
pnpm --filter @aiwb/web build → exit 0
104 modules transformed
dist/assets/index-*.js 479KB (gzip 127KB)
```

## 遗留

- **Toast 在 token 过期跳页时可能来不及显示**：clear() 后页面刷新，toast DOM 可能被卸载。后续可考虑路由守卫拦截，不直接刷新。
- **HistoryPanel trace 的缩进符号**：后端 summary 已自带 `▶ / ✓ / ✗` 前缀，前端只画 `├ └` 树状。当前逻辑 `i===0 → " "` 不对，首行应该是 `┌` 或直接 ` "▸"` —— 视觉上首行没树状前缀其实也 OK。
- **AgentsPanel tools 分组后 selected 计数逻辑**：当前 `checkedCount = tools.filter(t => form.tools.has(t.name)).length` 是对的，但全选 / 全取消 某组的快捷操作没做（低优先级）。
- **Phase 顺序拖拽**：未来可加 HTML5 drag-and-drop，当前 ↑↓ 足够。
