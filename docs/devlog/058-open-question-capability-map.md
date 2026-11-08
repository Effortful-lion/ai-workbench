# 058 · 开放性问题：能力地图 + 聚合工具 + 工具预算去重

- 日期：2026-11-07
- 状态：已完成

## 目标

「这个网站能做什么？」「服务器在哪开通？」这类开放性问题，模型此前会逐个模块调用 `*.list` 试探能力，一次提问跑满 8+ 个工具后撞上 `MAX_TOOL_CALLS=12`，被硬截断成「工具调用次数达上限（防死循环）」，体验等同于客服答不出来。

验收标准：

1. 开放性问题在 1～2 次工具调用内答完，不再触发上限；
2. 答案包含模块职责与前端入口（面板 / 斜杠命令）；
3. 需要实时数据时仍能正常 `list/get`，但同一工具同一参数不会重复消耗预算。

## 决策

- **能力地图注入 system prompt，而不是把 122 个工具全塞进提示词**：每个模块一行（职责 / 入口 / 只读写入数 / 常用工具），约 20 行 ≈ 600 字，既能让模型「知道有什么」，又不额外膨胀上下文；工具明细仍由 `tools` 参数承载。
- **新增聚合工具 `site.capabilities`**：一次返回全部模块的结构化清单，模型不必再靠逐个 `list` 反推站点能力。可选 `module` 参数支持单模块下钻。
- **能力地图数据来自操作目录，不手写第二份清单**：模块职责/入口放在 `MODULE_META`（导航语义），工具数量与常用工具从 `OPERATIONS` 与角色可见工具动态聚合，新增接口自动出现在地图里。
- **预算按「唯一工具 + 参数」计数，上限 12 → 20**：重复调用命中缓存直接复用、不计数，避免模型试探时被硬截断。
- **另设 40 步总上限**：重复短路不计数，但仍需硬上限防止模型原地刷同一工具；命中时照旧标记 `budget.hit`。
- **重复调用回给模型的载荷带 `repeated` 标记**：提示「参数相同、已复用结果、不要再次调用」，比静默返回同结果更能打断循环。
- **不做第三层 `site.guide` 帮助文档**（用户未选）：站点能力是可枚举的，帮助文案可由模型基于地图即时生成，暂不引入独立知识库。

## 实现

- 新增 [site.tools.ts](file:///Users/lion/workspace/gocode/ai-workbench/apps/server/src/tools/site.tools.ts)：
  - `MODULE_META`：20 个模块的中文名、面板 id、人话入口、职责摘要；
  - `buildCapabilityModules()`：按可见工具聚合模块（工具数 / 只读写入数 / 常用工具），常用工具优先 `list`/`digest`/`overview`；
  - `capabilityGuide()`：生成注入 system prompt 的「站点能力地图」+ 三条开放性问题规则；
  - `SiteTools.capabilities`：`@RegisterTool("site.capabilities")`，按 `ctx.role` 过滤后返回 `{totalModules, totalTools, modules}`。
- [tools.module.ts](file:///Users/lion/workspace/gocode/ai-workbench/apps/server/src/tools/tools.module.ts)：注册 `SiteTools`。
- [chat.gateway.ts](file:///Users/lion/workspace/gocode/ai-workbench/apps/server/src/chat/chat.gateway.ts)：
  - `MAX_TOOL_CALLS = 20`（唯一调用）、`MAX_TOOL_STEPS = 40`（总步数）；
  - `stableStringify()` 规范化参数（键排序），`${tool}:${args}` 作为缓存键；
  - 工具循环：命中缓存 → 复用结果 + `tool.done` 轨迹「↺ 复用上次结果」+ 不占预算；未命中 → 正常执行并写入缓存；总步数先扣减；
  - phase system prompt 追加 `capabilityGuide(phaseSchemas)`，地图随当前 phase 可见工具集变化；
  - 重复调用仍写一条 `tool` 消息保证 assistant `tool_calls` 配对完整，历史回放不会出现孤儿 tool 消息。

## 验证

- `npx tsc --noEmit`（server）通过；`npx nest build` 通过。
- `GET /api/tools` 返回 122 个工具，含 `site.capabilities`。
- WS 实测（deepseek-flash）提问「网站当前可以做什么？用一段话概括，并告诉我入口在哪。」：
  - 轨迹：`agent.started → phase.started → tool site.capabilities ✓ 1ms → phase.done → agent.done`；
  - **只调用 1 次工具**，答案覆盖知识库、邮件、站内信、模型、Agent、项目、代码、简历、百宝箱、日程、商业化、客户、流水线、统计等模块，并列出 `/kb`、`/mail`、`/me`、`/cal`、`/biz` 等入口；
  - 未出现 `budget.hit`。

## 遗留

- system prompt 现在含 122 个工具定义 + 能力地图，单轮输入约 3.3 万 tokens；后续可对 `tools` 参数做按需裁剪（如只下发当前 phase 模块）。
- 能力地图的模块职责是静态文案，若某模块接口大改需同步更新 `MODULE_META`。
- 用户未选的 `site.guide`（帮助文档 / 操作步骤问答）留待后续。
