# 002 · 模型管理 + LLM 适配层（models/llm）

- 日期：2026-11-02
- 状态：已完成

## 目标

全站模型能力的总开关：owner 自助接入各厂商模型（OpenAI 兼容协议），成员只读可用；提供真实对话测试与状态灯（可用/异常/未测）。验收：CRUD 权限矩阵正确、key 不明文出库/不出接口、test 端点真实调厂商并回写状态与延迟、前端卡片阵列可用。

## 决策

- **key 存储走 DB AES-256-GCM 加密**（总体设计开放问题 3 拍板）：[crypto.ts](file:///Users/lion/workspace/gocode/ai-workbench/apps/server/src/common/crypto.ts) 密钥 = sha256(env `MODEL_KEY_SECRET`)，密文格式 `iv.tag.data`（base64）；接口只回 `hasKey` 布尔，永不回明文。
- **适配层只认 OpenAI 兼容 `/chat/completions`**：[llm.adapter.ts](file:///Users/lion/workspace/gocode/ai-workbench/apps/server/src/llm/llm.adapter.ts)，endpoint 即接入点（deepseek/qwen/ollama 均兼容）；暂只非流式，流式留给对话模块。否决 LangChain 全家桶——本期只需一个 fetch。
- **权限判定收敛到 shared 一处**：`@RequirePerm('models:write')` + [permission.guard.ts](file:///Users/lion/workspace/gocode/ai-workbench/apps/server/src/common/permission.guard.ts) 直接调 `hasPermission(role, perm)`，HTTP 守卫与未来的 Tool 过滤共用同一权限表，贯彻"权限即边界"。
- **状态灯语义三态**：`ok/error/untested`；测试成功写 `latencyMs + lastCheckedAt`，失败写 `lastError`；价格备忘 `priceNote` 放 meta_json 不建列。

## 实现

- 数据：models 表（[schema.ts](file:///Users/lion/workspace/gocode/ai-workbench/apps/server/src/db/schema.ts)），`drizzle-kit push` 落库
- 共享：[models.ts](file:///Users/lion/workspace/gocode/ai-workbench/packages/shared/src/models.ts)（ModelDto/ModelTestResult）
- 服务端：[models.service.ts](file:///Users/lion/workspace/gocode/ai-workbench/apps/server/src/models/models.service.ts) CRUD+test、[models.controller.ts](file:///Users/lion/workspace/gocode/ai-workbench/apps/server/src/models/models.controller.ts)（读 `models:read` / 写 `models:write`）
- 前端：[ModelsPanel.tsx](file:///Users/lion/workspace/gocode/ai-workbench/apps/web/src/features/models/ModelsPanel.tsx) 卡片阵列（厂商/等宽模型名/状态灯/key 标记/延迟/测试按钮），owner 见接入表单与删除；[App.tsx](file:///Users/lion/workspace/gocode/ai-workbench/apps/web/src/App.tsx) 改为顶栏+面板区过渡布局（待 003 shell 收编）

## 验证

- curl 权限矩阵：owner 创建 ✓ → member 写 403 `requires models:write` ✓ → member 读 200 ✓ → 无 token 401 ✓
- test 端点真实到达 DeepSeek 返回 401（假 key 符合预期），回写 `status=error + lastError` ✓
- 浏览器子代理 3/3 PASS：卡片渲染（● 异常红/▣已配置）✓、对话测试出 ✗ 错误行 ✓、表单新增 testllm 卡片 ● 未测 ✓

## 遗留

- 流式输出未做（003 对话中枢接入 SSE/WS 时扩展 adapter）。
- 无批量测活/定时巡检；无用量统计（usage 字段已透传未落库）。
- 编辑入口只有新增/删除，PATCH 端点已备但 UI 未做。
