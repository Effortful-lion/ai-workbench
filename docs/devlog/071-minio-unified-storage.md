# 071 · 统一对象存储：知识库 / 工具箱迁入 MinIO（分桶）

日期：2026-11-07
状态：已完成

## 目标

用户上传的文件、二进制、安装包等全部统一进 MinIO，不同模块用不同的桶；本地磁盘只作迁移期兜底。

## 桶设计

| 桶 | 用途 | 访问方 |
|---|---|---|
| `aiwb-kb` | 知识库原文存档（key：`<userId>/<docId>.txt`） | 仅服务端 kb 模块 |
| `aiwb-files` | 工具箱二进制/安装包（key：`<toolId>/<fileName>`） | 仅服务端 toolbox 模块 |
| `aiwb` | AI 工具临时产物（`ai-workbench/` 前缀） | storage.* AI 工具（唯一暴露） |

启动时自动建桶；可通过 `MINIO_BUCKET_KB` / `MINIO_BUCKET_FILES` 环境变量覆盖。

## 改动

- [storage.service.ts](file:///Users/lion/workspace/gocode/ai-workbench/apps/server/src/storage/storage.service.ts)：新增 `BUCKETS` 映射与模块桶内部读写 `putObject/getObjectBuffer/getObjectStream/removeObject`（不暴露给 AI 工具，无 256KB 内联上限——那是模型上下文护栏不是存储限制）；onModuleInit 建全部桶
- [kb.service.ts](file:///Users/lion/workspace/gocode/ai-workbench/apps/server/src/kb/kb.service.ts)：ingest 原文写 `aiwb-kb`（替代 `data/uploads` 落盘）；retryIngest 经 `readArchive()` 优先 MinIO、遗留本地兜底；removeDocument 双清。object key 由 DB 行推导，**无 schema 变更**
- [toolbox.service.ts](file:///Users/lion/workspace/gocode/ai-workbench/apps/server/src/toolbox/toolbox.service.ts)：createFile 写 `aiwb-files`（`storagePath` 列值同时就是 object key，**无 schema 变更**）；fileFor 返回 MinIO 流（controller 改 `StreamableFile(f.stream)`），遗留本地文件兜底；remove 双清
- kb/toolbox 两个 module 引入 StorageModule
- 新增迁移脚本 [migrate-to-minio.mjs](file:///Users/lion/workspace/gocode/ai-workbench/apps/server/scripts/migrate-to-minio.mjs)：幂等扫 `data/uploads` / `data/toolbox` 入桶，`--delete` 可清本地源

## 验证（真实回环）

- 迁移脚本：1 篇存量 KB 文档（4994B）入 `aiwb-kb`
- KB 新上传文档（109B）→ 直接落在 `aiwb-kb/<userId>/<id>.txt`
- 工具箱：上传 25B 文件 → `aiwb-files/<id>/loop.bin` → 下载字节一致 → 删除后桶内清空
- 启动日志：`MinIO ready: localhost:9700 buckets=aiwb-kb,aiwb-files,aiwb`

## 遗留

- 本地 `data/uploads` 旧文件未删（MinIO 已验证有副本）；确认无误后可用 `node scripts/migrate-to-minio.mjs --delete` 清理
- LightRAG 索引、SQLite、日志不在对象存储范围内（自管状态）
