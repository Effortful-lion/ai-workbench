# 000 · Monorepo 骨架

- 日期：2026-11-02
- 状态：已完成

## 目标

按《总体设计》§5 落地 pnpm monorepo：`packages/shared` + `apps/server` + `apps/web`，server 健康检查与 web 首屏渲染跑通，作为后续所有模块的地基。

## 决策

- **TypeScript 锁定 ^6**：latest 已到 7.0.2，砍掉了 Nest CLI 依赖的编程式编译器 API（7.1 才回归）。
- **模块系统走 CJS 经典路线**：shared/server 均用 `module: nodenext`（TS6 中 `node`/`node10` 已废弃为错误；CJS 包内 nodenext 发射 CommonJS）。否决全 ESM 方案——NestJS 装饰器生态在 CJS 下最稳，且免去全部相对 import 加 `.js` 后缀的负担。
- **shared 出双产物前先 CJS 单产物**：`main/types/exports` 指向 `dist/`，Vite 通过预打包正常消费，tree-shaking 损失对本项目可忽略。
- **Tailwind v4 CSS-first**：`@theme inline` 把语义色映射到 CSS 变量，双色系（dark/warm）通过 `:root` 与 `[data-theme="warm"]` 两套变量整体切换——与原型 token 一一对应。
- **pnpm 11 构建审批用 `allowBuilds` 映射**：`onlyBuiltDependencies` 列表写法在 pnpm 11 不生效，且 pnpm 会自动向 yaml 插入占位行，需手工清理重复键。
- 端口：server 8700（`/api` 前缀），web 8701（proxy `/api` 与 `/socket.io`）。

## 实现

- 根：`package.json`（dev/build 编排）、`pnpm-workspace.yaml`、`tsconfig.base.json`、`.gitignore`
- 共享包：[roles.ts](file:///Users/lion/workspace/gocode/ai-workbench/packages/shared/src/roles.ts)（owner/member/guest + `hasPermission` + `filterByRole`）、[tool.ts](file:///Users/lion/workspace/gocode/ai-workbench/packages/shared/src/tool.ts)（ToolDef/ToolContext/ToolResult 协议）
- 服务端：[main.ts](file:///Users/lion/workspace/gocode/ai-workbench/apps/server/src/main.ts)、[db.module.ts](file:///Users/lion/workspace/gocode/ai-workbench/apps/server/src/db/db.module.ts)（better-sqlite3 + WAL + 外键）、[schema.ts](file:///Users/lion/workspace/gocode/ai-workbench/apps/server/src/db/schema.ts)（users/sessions 两表）、health 控制器
- 前端：[index.css](file:///Users/lion/workspace/gocode/ai-workbench/apps/web/src/index.css)（双色系 token）、[App.tsx](file:///Users/lion/workspace/gocode/ai-workbench/apps/web/src/App.tsx)（boot 页：健康探测 + 主题切换持久化）

## 验证

- `pnpm -r build`：shared / server / web 全部通过（TS6 + nest build + vite build）。
- `curl localhost:8700/api/health` → `{"ok":true,...}`；SQLite 文件自动创建于 `data/workbench.db`。
- 浏览器子代理验证 http://localhost:8701：boot 文案 ✓、绿色 `● ok` 状态（代理链路通）✓、主题按钮切换 warm 纸面色系且 localStorage 持久化 ✓ —— 3/3 PASS。

## 遗留

- drizzle-kit 已装但未跑首次 push（users/sessions 建表随模块 001-auth 一起做）。
- Socket.io gateway、shadcn 组件、xterm.js 均未接入，随对应模块引入。
- 后台进程管理：`Shell &` 派生进程会被回收，服务需用 run_in_background 启动。
