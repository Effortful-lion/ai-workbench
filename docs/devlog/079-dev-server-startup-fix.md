# 079 · make dev 启动失败排查（dist/main 缺失 / Vite 代理 ECONNREFUSED）

日期：2026-11-08
状态：已修复

## 现象

`make dev` 后 Vite 反复报 `/socket.io` 代理 `ECONNREFUSED`；`apps/server dev` 打印 `Found 0 errors. Watching for file changes.` 后，node 启动 `apps/server/dist/main` 报 `MODULE_NOT_FOUND` 并退出 code 1。`packages/shared dev Failed` / `Interrupt: 2` 是 Ctrl+C 结束 watcher 的表现。

## 实际排查

- `apps/server/tsconfig.json`：`outDir: "dist"`、`rootDir: "src"`；`package.json` 的 `start` 与 Nest 默认入口都是 `dist/main.js`，**路径一致**。
- `make clean` 后跑 `make dev`，`apps/server/dist/main.js` 正常生成，8700/8701 均监听，`/api/health` 与经 Vite 的 `/socket.io` 都返回 200 —— 端口与 `vite.config.ts` 的 proxy target（`http://localhost:8700`）**一致**，不是端口配错。
- 全仓 `find apps packages -name "*.tsbuildinfo"` 为空；`tsconfig.base.json` 未开启 `incremental`。**不存在「tsbuildinfo 在、dist 被清空、tsc 跳过 emit」的情况**。
- 真正的问题有两处：
  1. `apps/server/nest-cli.json` 配了 `deleteOutDir: true`。watch 启动/重启时 Nest 会先清空 `dist`，node 存在抢在 tsc emit 完成前启动的窗口，命中时就是 `dist/main` MODULE_NOT_FOUND，前端随之一直 ECONNREFUSED。
  2. 根 `dev` 把 4 个 watcher 同时拉起，`apps/cli dev` 在 `packages/shared/dist` 尚未生成时就编译，冷启动日志稳定出现 `TS2307: Cannot find module '@aiwb/shared'`；server 同理存在竞争窗口。

## 修改

- [package.json](file:///Users/lion/workspace/gocode/ai-workbench/package.json#L6)：`dev` 改为 `pnpm --filter @aiwb/shared build && pnpm -r --parallel run dev`，先产出 shared 的 `dist`，再并行启动 watcher，消除冷启动 TS2307 与 server 编译竞争。
- [apps/server/nest-cli.json](file:///Users/lion/workspace/gocode/ai-workbench/apps/server/nest-cli.json)：移除 `compilerOptions.deleteOutDir`（默认 false），watch 期间不再清空 `dist`，`dist/main.js` 不会被删掉。
- 未改 Vite proxy：target 本来就是 `http://localhost:8700`，与 server 一致。

## 复验

`make clean` → `make dev`：

- 启动顺序为先 `tsc -p tsconfig.json`（shared build），再 4 个 watcher；
- 日志无 `error TS` / `Cannot find module` / `MODULE_NOT_FOUND`；
- `apps/server/dist/main.js` 存在（739 bytes）；
- `:8700`、`:8701` 均 LISTEN；
- `GET http://localhost:8700/api/health` → 200；
- `GET http://localhost:8701/socket.io/?EIO=4&transport=polling` → 200（经 Vite 代理连通）。

验证后已停止全部 dev 进程，端口释放。

## 备注

`make dev` 被 Ctrl+C 时 pnpm 只会结束 watcher 父进程，子进程（nest/vite）可能残留占用 8700/8701，下一次启动 Vite 会顺延到 8702。遇到「端口被占」先 `make stop` 或按端口清理。这不是本次故障的原因，但会干扰复现。
