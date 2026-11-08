# Agent Team 能力调研与决策存档

- 日期：2026-11-08
- 状态：**暂不做实现**，仅存档调研结论，供后续评估
- 触发：用户复盘「AI 助手模块只是单 LLM + 人设 + 工具筛选」，想评估是否引入 Agent Team（多智能体协作）

## 1. 现状盘点（单 Agent 形态）

| 模块 | 本质 | 关键代码 |
|---|---|---|
| AI 助手（agents） | 单 LLM + personaPrompt + toolsJson + 预算；会话绑定 agentId = 换 system prompt + 裁剪工具集 | `db/schema.ts:50-66`、`chat.gateway.ts:241-253` |
| phase 阶段 | Agent 内部顺序接力：每 phase 可换模型/工具/目标，共享对话上下文；线性写死，无分支/循环/并行/路由 | `chat.gateway.ts:367-424` |
| pipe 流水线 | 离线文本批处理：步骤间 prior 传递（截 3000 字）、断点重试、AI 可按名调起；无工具调用、SOP 级单模型；与 agent 体系互不引用 | `pipe.service.ts:394-621` |

**已预留未实现（空壳）**：trace 事件 `sub.started/sub.done`（`packages/shared/src/agents.ts:76-77`，注释"子 Agent 包裹"，无发出方）；`AgentBudget.maxConcurrency/maxDepth`（"子会话派生"预算，无消费方）。

**已有地基**：ToolRegistry 动态注册（`tool-registry.service.ts:50-58`）、完整 tool-call 循环（防死循环/缓存/迹线/预算熔断）、agent_executions 运行记录、权限双保险。

## 2. 主流设计调研

### 2.1 Claude Code「Agent Teams」（重型团队模式）

四组件：Team Lead（拆解/派生/汇总，不可转让）+ Teammates（独立上下文实例）+ 共享任务列表（三态 + 文件锁防抢 + 依赖自动解锁）+ Mailbox（JSON 邮箱，任意成员互发）。

关键设计：
- **实验性、默认关闭**（Anthropic 自己不建议默认开）
- teammate 不继承主会话历史，只拿 spawn prompt（提示词须自带完整上下文）
- 权限提示统一上浮主会话；消息投递前分类器审查（防 agent 间提示注入）；teammate 不能代用户批准
- 建议 3-5 队友、每队 5-6 任务；**不支持嵌套团队**；会话不可恢复
- 最适场景：并行研究/审查、竞争假设辩论、跨层分工——"边界清晰、输出可独立验证"
- 代价：token 线性增长、协调开销大、任务状态易滞后

### 2.2 OpenAI Agents SDK（轻量编排，更主流）

- **Agents as Tools**（manager 模式）：主 agent 把其他 agent 当工具调用，专家只产出子任务结果不接管对话——适合"一个大脑负责最终答案"
- **Handoffs**（交接模式）：分诊 agent 移交控制权，专家接管后续对话——客服分流类
- **代码编排**（确定性）：分类路由 / 链式串联 / 评估循环 / Promise.all 并行
- 选型逻辑：开放式任务 → LLM 决策编排；确定流程 → 代码编排（我们的 phase/pipe 已是链式串联变体）

## 3. 能力差距（若做 Agent Team 需补）

1. 子代理派生：无 spawn 工具，agent 不能调 agent
2. 动态编排：phase 无条件分支/循环/并行/按产出路由；`requireConfirm` 声明未实现
3. agent 间通信：无子任务结果回传协议、无共享黑板（pipe prior 是最近雏形）
4. 编排实体：无 Team/DAG/workflow 定义；pipe 与 agent phase 两套平行体系未打通
5. 任务持久化：无独立 task/job 表；长任务暂停/恢复、人工审批节点均无

## 4. 决策与理由

**决策：暂不做。** 理由：
- 重型团队是多人协作开发场景，个人工作台协调开销 > 收益（Claude Code 自身都标实验默认关）
- 现有 agents + phase + pipe 已覆盖"角色/多步/批处理"三层需求
- 真实价值点（复杂任务分派、长上下文隔离）未来可用极小切口补上，见 §5

**未来若做，推荐路径（Agents as Tools 模式，非重型团队）**：
- MVP：内置工具 `agent.spawn(agentId, task)`——主 agent 派子任务给任意已配置 agent，子 agent 独立上下文跑完整 tool-call 循环，结果以工具结果文本回传；消费 `maxDepth/maxConcurrency` 预算（防递归爆炸）、发 `sub.started/sub.done` 迹线（Trace 面板按父子层级显示）。改造成本集中在 chat.gateway 编排层，数据模型无需推倒。
- 二期：phase 条件路由（按上一步产出决定是否执行）、子 agent 并行 fan-out。
- **不建议**：mailbox 消息系统、共享任务列表、嵌套团队、teammate 常驻会话。

## 5. 重新评估的触发条件

满足任一条时可重启本项：
- 用户频繁手动串联多个 agent/pipe 完成同一复杂任务（编排需求真实出现）
- 出现需要隔离上下文的长链路工具任务（主对话被工具输出撑爆）
- 多用户/团队版上线，出现跨 agent 协作的真实场景
