# 046 · kb 页面重构（问答/文档分离）与文档操作

- 日期：2026-11-04
- 状态：已完成

## 目标
知识库页面重新设计：问答与文档管理分离；问答页对齐主流 RAG 产品形态（消息流 + 底部输入框）；文档管理提供操作能力。

## 决策
- 模块内页签（问答 / 文档）而非新增路由：项目面板体系由 panelStore 驱动，无子路由，页签改动最小。
- 问答页做成多轮会话形态（本地 state 保存本轮会话的 Q&A 列表，不落库）：主流 RAG 页都是对话流；会话持久化留给后续接 chat 模块。
- 新增 `POST /kb/documents/:id/retry` 重试操作，而不是让用户删除重传：原文已归档在 data/uploads，可直接重建索引。

## 实现
- [KbPanel.tsx](../../apps/web/src/features/kb/KbPanel.tsx) 整体重写：
  - 问答页：消息流（用户气泡右、AI 卡片左，引用可折叠）+ 底部固定输入框，空态提示已索引文档数，新回答自动滚底。
  - 文档页：上传表单（选文件/粘贴/拖拽）+ 文档树，行内操作 `↻ 重试`（error 态）/ `✗ 删除`。
- [api.ts](../../apps/web/src/lib/api.ts)：加默认 60s 超时（`AbortSignal.timeout`），超时抛「请求超时」；修复服务端重启导致 fetch 永远 pending、按钮卡死的问题。ask 调用单独放宽到 130s。
- [kb.controller.ts](../../apps/server/src/kb/kb.controller.ts) / [kb.service.ts](../../apps/server/src/kb/kb.service.ts)：新增 retryIngest —— 校验归属与状态（pending 拒绝重试）→ 读归档原文 → 置 pending → 后台重跑 processDocument。
- [lightrag.service.ts](../../apps/server/src/kb/lightrag.service.ts)：新增 waitDeleted —— LightRAG 删除是异步任务，删除完成前 insert 同 file_source 会被 409 拒绝（实测连续踩两种 409：重复插入 / pipeline 清理中），retry 前必须 deleteDoc + waitDeleted。

## 验证
- retry 接口实测：首次调用返回 pending，pending 中重复调用被 400 拒绝（「文档正在处理中，无需重试」）。
- 修复两个 409 后重试链路可走到 LightRAG 图谱合并阶段（实测 70 entities / 91 relations，deepseek-flash 合并耗时数分钟）。
- 前端 tsc 无新增错误；HMR 生效。

## 遗留
- 问答会话仅前端内存态，刷新即清空；后续可接 chat 模块持久化。
- LightRAG 图谱抽取速度受 LLM 影响大（单文档可达 5 分钟以上）；如需更快可考虑换更快的模型或减少抽取轮次。
