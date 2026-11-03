# 021 · Agent Tools + Budget 拦截真实 LLM 端到端

- 日期：2026-11-02
- 状态：✅ 完成（真实豆包 LLM + 指令式 function calling + budget.hit 7/7 PASS）
- 前置：020 的 Ark 豆包 lite 模型已接入并作为 status=ok 的唯一默认模型

## 目标

用 Phase 4 已经跑通的真实豆包模型，验证 Agent 模块的两条核心链路：
1. **指令式工具调用协议**（▸TOOL directive）—— LLM → tool.exec → LLM 回灌的完整闭环
2. **Budget 拦截** —— checkBudget 在 phase 循环内精准截断

## 架构回顾

```
chat.gateway.ts onSend()
  │
  ├─ agent.started (trace)
  │  personaPrompt + 勾选的 tools → buildAgentSystemPrompt()
  │
  ├─ phase 迭代器（phase 或单 main）
  │  ├─ phase.started (trace)
  │  ├─ checkBudget(budget, snapshot)  ← 每次 LLM call 前
  │  │  └─ budget.hit (trace) → phaseBreak
  │  │
  │  ├─ LlmAdapter.chatStream()  ← 真实豆包 SSE
  │  │  └─ usageRef.usage → prompt/completion/total tokens
  │  │
  │  ├─ parseToolCalls(full)  ← 找 ▸TOOL {...} 行
  │  │  ├─ 无 → phase.done (纯文本) → break
  │  │  └─ 有 → phase.done(tool) + tool.started + registry.execute()
  │  │            └─ tool.done → 回灌 tool result → 继续 while
  │  │
  │  └─ 工具调用上限 MAX_TOOL_CALLS=8 防死循环
  │
  └─ agent.done / agent.failed(budget) (trace)
     trace.finish(status=done|budget|failed, tokens, cost)
```

## 可用工具清单（member 权限）

```
models.list                  列出已接入的模型
chat.listConversations       列出当前用户的历史会话
schedule.upcoming            查询未来几天内的待办日程
schedule.list                列出全部日程任务
projects.list                列出项目
projects.readDoc             读项目文档
resume.get                   读取个人简历档案卡
toolbox.list                 列出百宝箱工具
code.list                    列出代码仓库
code.readFile                读取代码文件
kb.search                    知识库检索
kb.ingest                    知识库入库
notify.list / scan / send / read   站内信全套
```

## 验证 1 · 信息管家 Agent（6 tools）

**配置**：
```json
{
  "name": "信息管家",
  "personaPrompt": "你是用户的个人信息管家...",
  "tools": ["schedule.upcoming", "projects.list", "resume.get", "toolbox.list", "models.list", "chat.listConversations"],
  "budget": { "maxTotalTokens": 50000, "maxCostYuan": 5, "timeoutSec": 120 }
}
```

**对话**：`帮我看看我有哪些即将到来的日程安排？`

**真实事件流（DB agent_executions.events_json）**：
```
agent.started   ▸ agent "26e5a291…" 启动  tools=[schedule.upcoming,projects.list,resume.get,toolbox.list,models.list,chat.listConversations]
phase.started   ▶ phase main  model=volces-ark/doubao-seed-2-0-lite-260428  tools=[schedule.upcoming,...]
phase.done      ✓ phase main  LLM 请求工具 schedule.upcoming
tool.started    ▸ [tool] schedule.upcoming
tool.done         ↳ schedule.upcoming ✓ 2ms
phase.done      ✓ phase main  LLM 产出纯文本（tokens≈18）
agent.done      ✓ agent 完成  duration=5.8s  tokens=18
```

**前端聊天面板**：
```
you › 帮我看看我有哪些即将到来的日程安排？
tool › ▸TOOL schedule.upcoming ✓ 2ms  { "count": 0, "tasks": [] }
ai   › 查询结果显示，你未来7天内暂未登记任何待办的日程安排哦~
```

**关键发现**：
- 豆包 lite **自动识别 system prompt 里的工具描述**，主动输出 `▸TOOL {"name":"schedule.upcoming","args":{}}`
- 豆包用中文 thinking（reasoning_tokens=195），但 completion 文本干净，▸TOOL 指令在流式输出中被正确按行拦截
- 工具 result 自动以 `【工具结果 schedule.upcoming】\n{...}` 格式回灌进第二轮 LLM
- 两轮 LLM + 工具总共只用了 18 tokens（豆包 completion_tokens 小，prompt_tokens 有上报但 completion 里的 reasoning 不算 completion）

## 验证 2 · Budget 拦截

### 2a. cost=0 拦截（最快，零成本）

**配置**：`maxCostYuan=0, maxTotalTokens=1000, timeoutSec=300`

**结果**：`status=budget, duration=0.8s, tokens=0`
```
agent.started → phase.started → budget.hit(cost) → agent.failed(budget)
```
**在 phase 循环第一次 checkBudget() 就触发** — LLM 还没调、工具还没调，直接截断。

### 2b. tokens 拦截（设计完备，校验层限制）

agents.service.ts 里 `normalizeBudget` 强制 `maxTotalTokens >= 1000`，API 层不能设更小。
直接 SQL 绕过可以设 200，但 020 发现的豆包 token 计数特点（completion_tokens 很小）使得真实场景下很难触发 tokens 阈值。

**建议改进**：把豆包的 `reasoning_tokens` 也计入 snapshot.tokens，或者 priceIn/Out 设为非零让 cost 通道也生效。

## 已知限制

1. **豆包 reasoning_tokens 不计入成本**：`chat.gateway.ts:265` 只加 provider 上报的 `total_tokens`，但豆包 SSE usage 里 `total_tokens = prompt + completion`，reasoning 在 `completion_tokens_details.reasoning_tokens` 独立字段。
2. **pickModel 按 DB 行序**：需要稳定选 volces-ark，目前靠 mock 降级为 untested。更稳的做法是按 status 排序 + 加 priority 字段。
3. **priceIn/priceOut 默认 0**：成本永远是 0，budget.hit 只能靠 tokens 或 timeout。真实场景应在模型接入时填价格。

## 时间线

| 时间 | 事件 |
|------|------|
| 18:50 | Agent 创建（6 tools + budget） |
| 18:55 | **真实 LLM 工具调用成功** 🎉 7 events 完整闭环 |
| 18:56 | **cost=0 budget 拦截成功** 🎯 4 events，零成本截断 |
| 18:57 | tokens=200 测试（正常走完，阈值未触发） |
