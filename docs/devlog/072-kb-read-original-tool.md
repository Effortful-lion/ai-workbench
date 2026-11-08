# 072 · Agent 受控读取知识库原文（kb.documents.read 工具）

日期：2026-11-07
状态：已完成

## 背景

用户确认 MinIO 双层访问架构后，提出让 Agent 也能读取知识库原文。原则：**不给 Agent 新的 S3 客户端**，在工具层加一条受控只读路由。

## 实现

**路由**（[kb.controller.ts](file:///Users/lion/workspace/gocode/ai-workbench/apps/server/src/kb/kb.controller.ts)）：`GET /kb/documents/:id/original`，权限 `kb:read`

**服务**（[kb.service.ts](file:///Users/lion/workspace/gocode/ai-workbench/apps/server/src/kb/kb.service.ts)）：`readOriginal(userId, id)`
- 先查 DB 校验文档归属（ownerId 匹配）
- 复用 `readArchive()` 读 `aiwb-kb` 桶原文（MinIO 优先，遗留本地文件兜底）
- 返回 `{ id, title, status, content, createdAt }`

**工具目录**（[operations.ts](file:///Users/lion/workspace/gocode/ai-workbench/packages/shared/src/operations.ts)）：新增 `kb.documents.read`，risk=read，permission=kb:read

## 关键设计

- Agent 只知道 docId，**不知道桶名/object key 映射**——key 由 `archiveKey(userId, id)` 在服务端推导
- Agent 只能读自己 owner 的文档（DB where ownerId=userId）
- 全程走 `kb:read` 权限校验，不需要碰 storage:* 权限，也不暴露 aiwb-kb 桶
- 密钥仍只在服务端，Agent 持有的是 JWT，调用链：LLM → kb.documents.read → REST /kb/documents/:id/original → StorageService → MinIO

## 验证

- `/api/kb/documents/:id/original` 返回原文正文（从 aiwb-kb 桶读取）
- `/api/tools` 注册 `kb.documents.read`（总 145 工具）
- member 角色含 kb:read，可直接使用
- shared + server 构建通过
