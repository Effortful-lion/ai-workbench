# 026 · 模型管理改造（分类 / 厂商预设 / 表单精简）

- 日期：2026-11-02
- 状态：✅ 完成
- 前置：025 AI 回复 Markdown 渲染

## 目标

模型管理此前只覆盖对话（推理）模型。后续知识库需要向量检索，因此必须同时管理 **embedding（向量）模型**。同时新增模型表单要贴近主流 AI 术语与用法：

- 模型分「对话 / 向量」两类，可筛选、分类型测试。
- 供应商改为主流厂商**下拉选择**，选定后自动填 baseURL。
- 模型名给出该厂商的**建议列表**（可选可填）。
- 字段命名对齐主流术语：`baseURL` / `apiKey` / `model`。
- 移除「输入 / 输出 token」定价输入（`priceIn` / `priceOut`）。
- 保留 `temperature` / `topK` 作为**可选**采样配置。

## 决策

| 问题 | 选择 | 原因 |
|------|------|------|
| 类型字段落库 | `models.kind`（`chat` / `embedding`），默认 `chat` | 向后兼容已有 5 条模型，无需回填 |
| 供应商来源 | 前端静态预设表（8 家） | 无需后端配置中心；预设含 baseURL 与模型清单 |
| 模型名输入 | `<datalist>` 建议，可手填 | 厂商模型迭代快，硬约束会阻碍新模型接入 |
| 字段命名 | UI 用 `baseURL` / `apiKey`；表列仍 `endpoint` | 只在表单层对齐术语，避免改动运行时全链路 |
| 定价字段 | 表单删除输入，卡片保留历史展示 | 接入阶段不强制定价；已存数据不丢失 |
| 类型测试 | `kind=embedding` 走 `/embeddings` | 与 OpenAI 兼容协议一致，回写状态灯与延迟 |
| meta 存储 | `temperature` / `topK` 放 `metaJson` | 可选配置，避免为低频字段加列 |

## 实现

- `packages/shared/src/models.ts`：新增 `MODEL_KINDS` / `ModelKind`；`ModelDto` 增加 `kind`，`meta` 增加 `temperature` / `topK`。
- `apps/server/src/db/schema.ts`：`models` 表增加 `kind`（enum，默认 `chat`）；已执行 `ALTER TABLE models ADD COLUMN kind text NOT NULL DEFAULT 'chat'`。
- `apps/server/src/models/models.service.ts`：`UpsertModelInput` 增加 `kind` / `temperature` / `topK`；create/update 写入 meta；`test()` 按 `kind` 分流，向量模型调用 `LlmAdapter.embed`，返回「N 条向量 · D 维」。
- `apps/server/src/models/models.tools.ts`：`models.list` 输出增加 `kind`。
- 新增 `apps/web/src/features/models/providers.ts`：8 家预设（OpenAI / DeepSeek / 通义千问 / Moonshot / 智谱 GLM / 火山方舟 / Ollama / 自定义），每家含 `baseURL` 与按 kind 分组的模型建议；`KIND_LABEL` 提供中文标签。
- `apps/web/src/features/models/ModelsPanel.tsx`：表单重写为 `type / provider / model / baseURL / apiKey / temperature / topK`；新增「全部 / 对话 / 向量」筛选与计数；卡片头显示 `provider · 对话/向量`；测试按钮按类型显示「对话测试 / 向量测试」。

## 验证

- 构建：`pnpm --filter @aiwb/shared build && pnpm --filter @aiwb/server build && pnpm --filter @aiwb/web build` 全通过。
- DB：`PRAGMA table_info(models)` 确认 `kind` 列存在；5 条既有模型均为 `chat`。
- 接口（admin 登录后）：
  - `GET /api/models` 每条均返回 `kind`。
  - `POST /api/models` 创建 chat（`temperature:0.7, topK:40`）→ `meta` 正确回传；创建 embedding → `kind=embedding`。
  - `POST /api/models/:id/test` 对 embedding 模型实际请求 `/embeddings`（返回 `Embeddings 401` 鉴权错误），状态灯落为 `error`。
  - 测试数据已 `DELETE` 清理。
- 页面（浏览器实测）：表单含 type/provider/model 建议/baseURL/apiKey/temperature(可选)/topK(可选)，无 priceIn/priceOut；筛选显示「全部 5 / 对话 5 / 向量 0」；卡片显示 `deepseek · 对话` 等类型标签。

## 遗留

- 向量模型 `mock://` 不支持 embedding，测试会报错，属预期；知识库落地时需选定真实 embedding 厂商。
- 表单未提供「测试连接」即时反馈，仍需先保存再点卡片测试。
