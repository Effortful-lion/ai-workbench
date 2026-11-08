# 082 · 模型选择器（方案 A：芯片 + 浮层）

- 日期：2026-11-08
- 状态：已完成

## 目标

主页 Hero 输入框与 KB 面板问答输入框均无模型选择。经原型对比（A 芯片+浮层 / B 内嵌 select / C 斜杠命令），用户拍板方案 A：芯片置于元信息行，不新增视觉层级；浮层完全终端风定制。

## 决策

- **主页**：芯片放输入框下方 `// 模型` 注释行，状态复用 chat store 的 `pendingModelId`，与聊天栏顶部既有 select 同源联动。
- **KB 问答**：芯片放「// 检索深度」行右端（`ml-auto`），面板内局部 state；后端打通 `KbAskInput.modelId` → controller 透传 → `ask()` 第 5 参 → `pickModel(modelId)`（优先级：指定 → isDefault → 首个 ok）。
- 否决原生 `<select>`（方案 B）：浮层样式不可控、移动端挤压输入区；斜杠 `/model`（方案 C）发现性差，本期不做。
- 浮层仅列 `kind=chat && status=ok` 模型；首项「◎ 自动」= 服务端默认；★标全局默认；状态灯 ok/untested/error。
- LightRAG 链路 `ask` 不消费 modelId（答案由图谱服务产出，回显 model=lightrag），行为不变。

## 实现

- `apps/web/src/shell/ModelPicker.tsx`（新）：芯片 + 浮层组件，↑↓/⏎/Esc 键盘导航、外点关闭、状态灯；`align` 控制浮层左/右对齐。
- `apps/web/src/shell/HeroState.tsx`：输入框下注释行接入。
- `apps/web/src/features/kb/KbPanel.tsx`：检索深度行右端接入，`kbModelId` 随 `/kb/ask` 携带。
- `packages/shared/src/kb.ts`：`KbAskInput.modelId?`。
- `apps/server/src/kb/kb.controller.ts` / `kb.service.ts`：透传并 `pickModel(modelId)`。
- 原型：`docs/prototype/model-selector.html`（三方案对比，静态服务 :8799 预览用，验收后可删）。

## 验证

- shared/server/web 构建通过；server 重启正常。
- E2E：`POST /kb/ask` 带 `modelId`（volces-ark/doubao）→ 日志显示请求已路由到该模型（因厂商账号欠费 403 按设计降级 extractive，链路本身生效）；mock 模型按设计跳过 LLM。
- 浮层交互（键盘导航/联动）为前端行为，构建通过，待浏览器手测。

## 遗留

- 斜杠命令 `/model` 快捷切换（方案 C 组合，本期未做）。
- 模型芯片进入 KB 面板每次重新拉取模型列表（未做缓存）。
- volces-ark 账号欠费待充值，否则该模型始终降级。
