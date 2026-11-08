# 073 · 默认模型（is_default）

日期：2026-11-08
状态：已完成

## 目标

聊天未指定模型时，服务端优先选用用户在模型管理里标记的「默认模型」，避免每次先打到不可用模型报错、再手动切换的体验。

## 决策

- **全局唯一默认**：`is_default` 全局最多一条（不设唯一索引，由 `setDefault` 事务式先清后立保证）。不设 per-user 默认——模型池本身就是 owner 维护的全局资源。
- **不落库失败**：drizzle-kit push 加列时需 TTY 交互确认（not-null 无默认值），管道无法绕过 → 直接 `sqlite3 ALTER TABLE models ADD COLUMN is_default INTEGER NOT NULL DEFAULT 0`。
- **选择顺序**：`pickModel` = 显式 modelId → isDefault → status=ok → pool[0]，显式选择永远优先。

## 实现

- schema：[schema.ts](file:///Users/lion/workspace/gocode/ai-workbench/apps/server/src/db/schema.ts) models 表加 `is_default` 列（boolean，默认 false）
- DTO：[models.ts](file:///Users/lion/workspace/gocode/ai-workbench/packages/shared/src/models.ts) `ModelDto.isDefault`（**改 shared 后需单独 `pnpm --filter @aiwb/shared build`**）
- 服务：[models.service.ts](file:///Users/lion/workspace/gocode/ai-workbench/apps/server/src/models/models.service.ts) `pickModel` 选择链插入 `pool.find((m) => m.isDefault)`；新增 `setDefault(id)`（先清所有 true 再置顶目标）
- 路由：[models.controller.ts](file:///Users/lion/workspace/gocode/ai-workbench/apps/server/src/models/models.controller.ts) `POST /models/:id/default`，权限 `models:write`
- 前端：[ModelsPanel.tsx](file:///Users/lion/workspace/gocode/ai-workbench/apps/web/src/features/models/ModelsPanel.tsx) 卡片「默认」徽章 + footer「★ 设为默认」按钮；[ChatColumn.tsx](file:///Users/lion/workspace/gocode/ai-workbench/apps/web/src/shell/ChatColumn.tsx) 模型选择器首项显示 `◎ 自动（{默认模型名}）`，默认项后缀 ★

## 验证

- SQL：`SELECT ... FROM models` 确认 `deepseek/deepseek-flash is_default=1`；切换默认后旧值自动清 0（唯一性成立）
- 端到端冒烟：[smoke-default-model.mjs](file:///Users/lion/workspace/gocode/ai-workbench/apps/server/scripts/smoke-default-model.mjs) 注册临时账号 → WS 连 `/chat` → **不传 modelId** 发消息 → `started` 事件命中 `deepseek/deepseek-flash`，流式 delta 与 done 正常
- web tsc 零错误；server 构建通过并重启

## 坑

- 冒烟脚本首次 timeout 与功能无关：`/auth/login` 缺全局前缀 `/api`、admin/admin 非有效凭据，脚本在登录阶段就失败。正确姿势：`POST /api/auth/register` 拿 `tokens.accessToken`（响应嵌套在 tokens 下），WS 连 `http://host/chat`（namespace 不带 /api 前缀）。

## 遗留

- 无 per-user 默认；如未来多用户各自维护模型池再考虑。
