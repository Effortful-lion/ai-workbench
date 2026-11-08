# 045 · kb 异步摄入与状态可见性

- 日期：2026-11-04
- 状态：已完成

## 目标
上传文档后前端按钮长时间停在「切分 / 向量化中」无任何反馈（LightRAG 图谱抽取走 LLM，单文档分钟级）。
要求：接口立即返回、处理状态可见、有超时上限。

## 决策
- 摄入改异步：`POST /kb/documents` 只落库 pending 行 + 归档原文即返回（实测 ~11ms），切分/向量化放后台执行，状态翻转 `pending → embedded / error`。否决「前端长等待 + loading」——阻塞 UI 且无法感知进度。
- 超时不另起机制，复用 `waitProcessed` 的轮询上限，超时即落 error。
- 超时默认值 180s → 600s（`LIGHTRAG_INGEST_TIMEOUT_MS` 可调）：LightRAG 是单 worker 串行队列，需排队等前序文档；180s 实测会在「前序文档仍在 merging」时误判超时。
- 前端用轮询而非 WebSocket：存在 pending 行时每 3s 拉一次列表，收敛后自动停止；改动最小。

## 实现
- [kb.service.ts](../../apps/server/src/kb/kb.service.ts)：ingest 拆为同步部分（校验/落库/存档，返回 pending 行）+ 私有 `processDocument`（两条 provider 分支统一进后台，catch 落 error）。
- [lightrag.service.ts](../../apps/server/src/kb/lightrag.service.ts)：`INGEST_POLL_TIMEOUT_MS` 默认 600_000。
- [KbPanel.tsx](../../apps/web/src/features/kb/KbPanel.tsx)：新增 pending 轮询 effect（3s，组件卸载清理）；上传提交后立即收表单刷新列表，pending 态复用既有「处理中」黄点。

## 验证
- `tsc --noEmit` + `nest build` 通过。
- curl：POST 文档 11ms 返回 `status=pending`；轮询 `GET /kb/documents` 观察翻转。
- 超时路径实测：旧 180s 配置下队列拥堵时翻转为 `error: lightrag 文档处理超时`，状态/错误信息可见性符合预期。

## 遗留
- 进程重启会让 pending 行悬死（后台任务随进程消失）；需要启动清扫（pending → error「服务重启中断」）或任务持久化，下期处理。
- LightRAG 侧文档可能在 kb 已判 error 后继续处理完成，此时两侧状态不一致（kb=error / lightrag=processed）；删除该文档时会连带清掉 LightRAG 侧数据，可接受。
