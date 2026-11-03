# 029 · 终端化客户端：aiwb CLI + 操作目录

- 日期：2026-11-03
- 状态：进行中（mail 模块已全量覆盖，其余模块待铺开）

## 目标

把工作台做成可被人与 Agent 直接操作的「客户端」：站点里能做的事，终端里都能做。

1. 新增 `aiwb` 命令，覆盖全部 HTTP 接口（不只读，含写/删）。
2. 新增「操作目录」作为单一定义来源：一个 Operation 同时产出 CLI 命令，后续再产出 Agent Tool schema。
3. 让 CLI 输出天然适合 Agent：默认 JSON、可 `--raw` 单行、`--quiet` 静默、失败返回非 0 退出码。
4. 未知接口不阻塞：`aiwb call <METHOD> <path>` 兜底任意 API。

## 决策

- **目录优先，不手写命令**：122 个接口逐条手写 CLI 必然与 API 漂移。改为 `packages/shared/src/operations.ts` 声明 `key / method / path / params / permission / risk`，CLI 从目录生成命令树；新增接口只需加一条。
- **CLI 走 HTTP + token**：复用现成的鉴权、PermissionGuard、审计语义，CLI 就是后端的完整客户端；不做进程内直连（会绕开权限、还要处理 DB 锁）。
- **凭证独立存放**：`~/.aiwb/config.json`（目录 0700、文件 0600），`login` 一次写入，`--token` 可临时覆盖；不读 `.env`、不落仓库。
- **风险分级**：`read / write / destructive`，destructive（删账户、删邮件）必须显式 `--yes`，避免 Agent 误触发不可逆操作。
- **兜底与兼容**：目录未声明的 flag 自动落到 query（GET）或 body（其它方法），所以接口先上线、目录后补齐也能用。
- **输出默认 JSON**：Agent 直接解析；`--raw` 单行便于管道，`--quiet` 只靠退出码判断成功。
- 被否决：在浏览器里做 xterm.js 假终端（[总体设计.md](../../docs/总体设计.md) 的旧方案）——它不能给 Agent 用来操作系统本身，只是好看的 UI。

## 实现

- `packages/shared/src/operations.ts`：`OperationDef / OperationParam / OperationRisk` 类型 + `MAIL_OPERATIONS` 15 条（账户 CRUD/试连、digest、messages CRUD/回复、classify、sync），`findOperation / operationsOfModule / operationModules`。
- `apps/cli/src/args.ts`：`--key value` / `--key=value` / `--flag` / `--no-flag`，kebab → camel。
- `apps/cli/src/config.ts`：`~/.aiwb/config.json` 读写，默认 server `http://localhost:8700`。
- `apps/cli/src/http.ts`：拼 `/api` 前缀、query 布尔转 `1/0`、统一错误提取（兼容 Nest 的 `message` 数组），401/403 提示重新登录或无权限。
- `apps/cli/src/cli.ts`：`login / logout / whoami / operations / call / version / help`，命令解析（`aiwb mail sync`、`aiwb mail.sync` 两种写法都认）、按目录拼 path/query/body、destructive 校验、JSON 输出。
- `apps/cli/package.json` + `tsconfig.json`：`bin.aiwb`，`node >= 20` 原生 fetch。
- 根 `package.json`：`cli` / `dev:cli` 脚本；`pnpm -r build` 自动按拓扑顺序构建 shared → cli。

## 验证

- 构建：`pnpm --filter @aiwb/shared build`、`pnpm --filter @aiwb/cli build` 通过。
- `aiwb help`：打印用法、模块（mail 15 个操作）、全局参数。
- `aiwb login --username admin --password admin` → `✓ 已登录 admin (owner)`，凭证写入 `~/.aiwb/config.json`。
- `aiwb operations --module mail` → 15 条目录，带 `✎`（写）/`!`（不可逆）标记。
- `aiwb mail accounts.list --raw` → 返回 QQ 账户，`status:ok`、`messageCount:51`、`unreadCount:46`。
- `aiwb mail messages.list --folder inbox --unread --raw` → 46 封未读，字段完整。
- `aiwb mail messages.get --id <id>` / `aiwb mail messages.patch --id <id> --is-starred true` → 200，`isStarred` 变化；随后 `--is-starred false` 复原。
- `aiwb mail messages.delete --id <id>`（不带 `--yes`）→ exit 2，未执行。
- `aiwb call GET /api/mail/digest --raw` → 正常返回概览（`/api` 前缀与不带前缀都兼容）。
- `aiwb mail sync --raw` → `created:1 / skipped:49 / failed:0`，IMAP 真实同步。
- 错误路径：`aiwb mail messages.get --id nope` → `✗ 邮件不存在`，exit 1。
- `aiwb whoami --raw` → 返回当前用户与角色。

## 遗留

- 目录已扩展到全站点 120 条操作 / 18 个模块（见 [030](030-operations-catalog.md)）；仍有三类接口未纳入：multipart 上传（`toolbox.items.upload`、`resume.import`）、WS 聊天发送。
- Agent Tool 尚未从目录生成：现有 54 个工具仍由 `@RegisterTool` 手写，下一步用同一目录生成 schema，消除两套定义。
- 尚未做交互式 shell 模式（`aiwb` 进入 REPL）、批量执行与管道输入。
- 增强工具（`web.search` / `web.fetch`）已确认要加，未实现。
