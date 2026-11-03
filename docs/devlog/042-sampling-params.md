# 042 · 采样参数接入 LLM 请求链

- 日期：2026-11-03
- 状态：✅ 已完成（本地假 OpenAI 服务实测注入与清除语义）

## 目标

041 中 temperature / topK 只落 meta 展示，实际请求未携带——等于可选配置无效。本轮把这两个值一路注入到 `/chat/completions` 请求体。

## 实现

- `llm.adapter.ts`：`chat` / `chatStream` 新增可选 `temperature` / `topK`；私有 `applySampling()` 统一注入，**仅当值为有限数值才写**（`temperature` → `temperature`，`topK` → `top_k`），`null` / `undefined` 一律省略，交给厂商默认。
- `chat.service.ts` `pickModel()`：从 `metaJson` 解出 `temperature` / `topK` 一并返回，作为唯一模型上下文出口。
- 四处调用点接入：
  - `chat.gateway.ts` 流式对话（主链路）
  - `kb.service.ts` 知识库问答
  - `pipe.service.ts` 流水线单步（其私有 `pickModel` 同步带出 meta）
  - `models.service.ts` 模型连通性测试

## 验证

起本地假 OpenAI 服务（8799）回显请求体，建临时模型测完即删：

| 场景 | 请求体 |
| --- | --- |
| 设 temperature=0.42 / topK=40 | `{model, temperature: 0.42, top_k: 40}` |
| 未设置 | `{model}`（无采样字段） |
| PATCH 传 null 清除后 | `{}`（字段消失，回到厂商默认） |

临时模型已删除，原模型列表未受影响。注意 `topK` 映射为 OpenAI 协议字段 `top_k`（DeepSeek/豆包/OpenAI 均接受；个别厂商若用 `top_k` 以外的命名需各自适配）。

## 遗留

- `max_tokens` / `stop` / `presence_penalty` 等其余采样参数未纳入表单，扩展时沿用 `applySampling` 同一注入点即可。
- 模型表单未开放价格字段（priceIn/priceOut/priceNote），后端 PATCH 已支持。
