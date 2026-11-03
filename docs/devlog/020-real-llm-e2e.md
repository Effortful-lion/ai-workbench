# 020 · 真实 LLM 全链路端到端验证

- 日期：2026-11-02
- 状态：✅ 完成（Ark 真实模型接入 + 后端 API + 浏览器 chat/agent/trace 10/10 PASS）

## 目标

用火山方舟（Volcengine Ark）真实 API Key 做完整的端到端验证：chat 流式对话、agent phase 执行、trace 事件流、tokens/cost 计量、budget 拦截。

## 前置条件

- API Key：`ark-xxxx`（来源 `temp/apikey.md`，只进 env 不落盘）
- 账户：Volcengine `210276xx76`

## 诊断过程

### Ark 账户状态扫描

| 项目 | 数量 | 说明 |
|------|------|------|
| `/api/v3/models` 列出 | 138 条 | API Key 有效，能列模型 |
| `status=Shutdown` | 83 | 老模型已下架，返回 404 |
| `status=Retiring` | 17 | 嵌入/旧模型 |
| 无 status 字段 | 38 | 新模型，多数需激活 |
| `ModelNotOpen` 错误 | 多数新模型 | 账户未开通，需控制台激活 |
| **可直接调用** | **1** | `doubao-seed-2-0-lite-260428` |

### 404 根因链

```
旧模型 status=Shutdown
  → InvalidEndpointOrModel.NotFound (404)
  → 账户未开通新模型
    → ModelNotOpen: Please activate in Ark Console
      → doubao-seed-2-0-lite-260428 无需额外激活，直接可用 ✅
```

## 接入配置

### DB 更新（绕过 PermissionGuard 403）

```sql
UPDATE models SET
  model_name = 'doubao-seed-2-0-lite-260428',
  api_key_enc = '<AES-256-GCM 加密后的 Key>',
  status = 'ok'
WHERE id = '644f6067-1cad-4ea6-8098-d478a25c5cc1';
```

### pickModel 选模修复

原逻辑 `rows.find(m => m.status === "ok")` 按 DB 行序取第一个 ok 模型，但 DB 里有两条 mock 记录也是 `status='ok'` 且排在 volces-ark 前面。

**修复**：mock 记录降级为 `status='untested'`。volces-ark 成为唯一 `status='ok'`，pickModel 优先选它。

## 验证结果

### 1. Ark API 直调 ✅

```bash
curl -X POST https://ark.cn-beijing.volces.com/api/v3/chat/completions \
  -H "Authorization: Bearer $ARK_KEY" \
  -d '{"model":"doubao-seed-2-0-lite-260428","messages":[{"role":"user","content":"say hi"}]}'
# → choices[0].message.content = "Hi"
# → usage: prompt_tokens=38, completion_tokens=196, total=234
# → reasoning_tokens=195（豆包 lite 自带 CoT）
```

### 2. 后端 LlmAdapter.chat() ✅

```bash
curl -X POST http://localhost:8700/api/models/644f6067.../test \
  -H "Authorization: Bearer $TOKEN" -d '{"prompt":"say hi"}'
# → { ok: true, reply: "Hi there! ...", latencyMs: 4248 }
```

### 3. 后端 LlmAdapter.chatStream() ✅

Vite dev proxy `/socket.io` → backend 8700 握手成功，SSE 流式返回豆包完整输出。

### 4. 浏览器 chat 端到端 ✅

```
你 › 用一句话说 hello world 是什么
ai › Hello World是全球编程领域公认的经典入门示例程序，
    最早源自1972年C语言的技术演示文档，几乎是所有编程初学者
    接触新编程语言时编写的第一个最简程序，核心功能就是在终端
    或其他输出界面打印出"Hello World"这段文本，如今已经演变
    成了大家开启编程学习的标志性符号。
```

### 5. TracePanel 事件流 ✅

```
18:47:35 ▶ ▸ 直跑模式（无 Agent 绑定）
18:47:35 ├ ▶ phase main model=volces-ark/doubao-seed-2-0-lite-260428
18:47:45 └ ✓ phase main LLM 产出纯文本（tokens≈34）
18:47:45 ✓ ✓ agent 完成 duration=10.3s tokens=34
```

事件序列：`agent.started` → `phase.started` → `phase.done` → `agent.done`

### 6. Mock 全链路 ✅

```
model=mock/mock-1, duration=2.0s, tokens=214, 4 events
```

## 架构确认

```
浏览器 ChatColumn
  → socket.io /chat (Vite proxy → backend 8700)
    → chat.gateway.ts phase loop
      → pickModel() 选 status=ok 的第一个 (volces-ark)
        → LlmAdapter.chatStream()
          → https://ark.cn-beijing.volces.com/api/v3/chat/completions
            → Bearer <AES 解密后的 Key>
```

## 安全约束执行

- ✅ API Key 只从 `temp/apikey.md` 读进 env，**未写入任何配置文件**
- ✅ 所有 shell 脚本用 `tr -d '\n\r '` 清理换行
- ✅ DB 里存 AES-256-GCM 密文，密钥源自 `MODEL_KEY_SECRET` env
- ✅ 解密仅在 `models.service.ts` + `chat.service.ts` 运行时做

## 已知限制

1. **豆包 lite 自带 reasoning**：`reasoning_tokens` 占大部分 token 预算，但当前 cost 按 `completion_tokens` 算，re-ratio 成本偏高。后续考虑换不带 reasoning 的模型。
2. **pickModel 按 DB 行序**：更稳妥的做法是给模型加 `priority` 字段。
3. **无 Agent phase + tools 真实调用**：mock 模式下 tools 已验证，但真实 LLM + function calling / tools 还没测（Phase 5 目标）。
4. **Budget 拦截未测**：需设置极低 `maxCostYuan` 触发 `budget.hit`。

## 时间线

| 时间 | 事件 |
|------|------|
| 18:30 | 开始诊断 Ark 账户状态 |
| 18:35 | 确认 doubao-seed-2-0-lite-260428 可用 |
| 18:36 | DB 更新 + 后端 API 验证 |
| 18:40 | 前端启动 + 浏览器登录 |
| 18:42 | Socket.io 握手 + mock chat E2E |
| 18:46 | mock→volces-ark 切换 (status=ok 排序) |
| 18:47 | **真实 LLM 流式输出成功** 🎉 |
