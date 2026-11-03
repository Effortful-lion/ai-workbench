# 034 · 文件上传：目录 + multipart

- 日期：2026-11-03
- 状态：已完成

## 目标

补齐两个 multipart 接口——`resume/import`（简历文件解析）与 `toolbox/items/upload`（文件类工具上传），让 AI 与 CLI 都能「拿本机一份文件」走同一条上传链路，而不必在工具层另写一套上传逻辑。

验收：`GET /api/tools` 出现 `resume.import` / `toolbox.items.upload`；CLI `--file` 可上传；WS 真实模型能调用 `resume.import` 并拿到解析结果。

## 决策

- **上传也进操作目录，不单独写工具**：给 `OperationParam.in` 增加 `"file"`，参数值语义是「本机绝对路径」，由执行层读盘后转 multipart。新增接口仍然只改 `operations.ts` 一处，CLI / Tool / 文档三端自动同步。
- **服务端读盘再回打本机 API**：与 032 的临时 JWT + 本机 HTTP 一致，`FileInterceptor` 的 50MB / 10MB 上限、扩展名校验、解析逻辑全部复用 Controller，工具层只负责「路径 → FormData」。
- **服务端只接受绝对路径 + 拒绝隐藏文件**：AI 的路径来自模型输出，可能被提示词注入带偏。`realpath` 解析软链后再逐段检查 dotfile（`.ssh` / `.env` 等一律拒绝），并限制 ≤50MB，避免敏感文件被传进公开可下载的 `/api/toolbox/files/:id`。
- **CLI 允许相对路径**：CLI 是本机人操作的，`--file ./cv.pdf` 按当前目录解析最顺手；风险边界在服务端，不在 CLI。

## 实现

- `packages/shared/src/operations.ts`：`OperationParamIn` 增加 `"file"`；新增 `resume.import`（`POST /resume/import`，`me:write`）与 `toolbox.items.upload`（`POST /toolbox/items/upload`，`tools:write`，带 `name/category/desc` 表单字段）。目录 120 → 122 条。
- `apps/server/src/tools/operation-tools.service.ts`：`buildRequest` 收集 `files`；`callOperation` 有文件时读盘 → `FormData`（文件 + body 字段）→ fetch 不手写 `content-type`（boundary 由 undici 生成）。`readUploadFile` 做绝对路径 / realpath / dotfile / 50MB / 普通文件校验，按扩展名补 MIME。
- `apps/cli/src/http.ts`：`callApi` 增加 `form?: FormData`，有 form 时不设 `application/json`。
- `apps/cli/src/cli.ts`：`runOperation` 遇 `in === "file"` 读盘（相对路径按 cwd）；`printOperation` 参数位置显示「文件」。

## 验证

- `pnpm --filter @aiwb/shared build && pnpm --filter @aiwb/server build && pnpm --filter @aiwb/cli build` 通过。
- `GET /api/tools`：118 条（116 目录工具 + 2 web），`resume.import` 参数 `file`、`toolbox.items.upload` 参数 `file/name/category/desc`。
- CLI：`toolbox.items.upload --file /tmp/aiwb-upload-test.txt --name 上传测试工具` 返回 id / fileName / fileSize=105；随后 `toolbox.items.delete --id … --yes` 清理成功。
- CLI：`resume.import --file /tmp/aiwb-upload-test.txt` 返回 `{source:"text", chars:66, profile:{basics:{name:"张三", …}}}`。
- WS 直跑（豆包 `doubao-seed-2-0-lite-260428`）：「把 /tmp/aiwb-upload-test.txt 导入为我的简历」→ trace `LLM 请求工具 resume.import` → `tool.done ✓ 13ms` → 回复「姓名：张三；技能：React、TypeScript、Node.js」。

## 遗留

- CLI 上传的 MIME 已由 035 按扩展名补齐（`mimeOfFileName`，工具箱落库兜底）。
- 工具侧上传只支持「本机已有文件路径」，尚不支持 AI 生成内容直接落盘再上传。
- 服务端 50MB 读盘上限对 `resume.import`（10MB）偏宽松，最终由 multer 拦截，错误信息来自 Controller。
