# 062 · 三方对象存储：MinIO 接入（services 模式 + AI 工具全链路）

日期：2026-11-07

## 背景

需要给工作台加一个三方对象存储，让 AI 助手能完成文件类任务（存报告、归档附件、分享大文件链接）。明确两个约束：

1. 服务放 `services/` 目录，与主仓零耦合（同 lightrag 模式：env 注入、可整体迁移）；
2. 不裸用 MinIO SDK——薄封装一层做**权限收口与护栏**，因为消费方是 AI。

## 决策

- **薄封装而非直通 SDK**：桶白名单（单桶 `aiwb`）、key 校验（禁 `..`/前导 `/`）、内联 256KB 上限、删除限 `ai-workbench/` 前缀。封装层只做护栏不扩展功能。
- **大文件绝不进模型上下文**：>256KB 强制走预签名 URL（默认 15 分钟、上限 1 小时），客户端/用户直连 MinIO，AI 只搬运链接。
- **走操作目录全链路**（非 @RegisterTool 孤立工具）：StorageController REST 端点 + `STORAGE_OPERATIONS` 注册进共享目录 → 自动生成 `storage.*` 工具、进入能力地图/意图路由/CLI，与 Controller 校验权限同一条链路。

## 改动

- [services/minio/](../..)：docker-compose（S3 API `:9700`、Web 控制台 `:9701`）+ `.env.example`（不入库）；数据卷 `./data` 已被根 `.gitignore` 的 `data/` 覆盖。
- [storage.service.ts](file:///Users/lion/workspace/gocode/ai-workbench/apps/server/src/storage/storage.service.ts)：MinIO Client 薄封装；启动自动建桶，不可达仅告警不阻塞（对齐 Qdrant 降级策略）。
- [storage.controller.ts](file:///Users/lion/workspace/gocode/ai-workbench/apps/server/src/storage/storage.controller.ts)：digest / objects 列表 / object 读写 / presign get+put / remove，挂 `storage:read|write` 权限。
- [operations.ts](file:///Users/lion/workspace/gocode/ai-workbench/packages/shared/src/operations.ts)：`STORAGE_OPERATIONS` 7 个操作（remove 标 `destructive`），注册进 OPERATIONS。
- [roles.ts](file:///Users/lion/workspace/gocode/ai-workbench/packages/shared/src/roles.ts)：member 角色补 `storage:read|write`。
- [site.tools.ts](file:///Users/lion/workspace/gocode/ai-workbench/apps/server/src/tools/site.tools.ts)：MODULE_META 补 storage 元信息——**注意** `buildCapabilityDocs()` 只遍历 MODULE_META 键，漏加会导致新模块有能力工具但没有能力手册。
- [app.module.ts](file:///Users/lion/workspace/gocode/ai-workbench/apps/server/src/app.module.ts)：挂载 StorageModule。

## 验证

- MinIO 容器健康；`MinIO ready: localhost:9700 bucket=aiwb`，首次启动自动建桶。
- REST 全通过：写文本（57B）→ 读回一致 → 列表 → digest（objects=1）；预签名下载 URL 直接 curl 拿到原文；护栏拦截 `other/*` 删除（400）、放行 `ai-workbench/*` 删除。
- 操作工具 116 → **123**（+7 storage）；能力手册增量摄入 1 篇（19 模块）——逐模块存在性检测在新增模块时自愈。
- Chat 端到端（AI 写文件→读回）：会话模型绑定 deepseek-flash 正常，但 **DeepSeek 持续 503（外部故障）**，最终链路未跑通，待服务恢复后复测。REST 层与工具注册层均已独立验证，chat 链路此前已被 mail 工具验证过，风险低。

## 遗留

- chat 链路复测（DeepSeek 恢复后）：问「存个文件再读回」，应路由到 storage 并调 `storage.object.put/get`。
- 预设路径约定（如 `ai-workbench/reports/`、`ai-workbench/attachments/`）可在后续文件类 SOP 中固化。
- 邮件附件归档到 MinIO（mail.attachments.* → storage）是自然的下一步集成点。
- MinIO 默认账号密码在 `services/minio/.env`，生产部署必须改并换用独立 access key（而非 root）。
