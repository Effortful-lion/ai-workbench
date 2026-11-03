# 035 · 文件类操作扩展 + 遗留收尾

- 日期：2026-11-03
- 状态：已完成

## 目标

把「本机文件」能力从 multipart 上传扩展到**内容型接口**：知识库入库、项目文档、代码文件不必再让 AI 拼长文本，直接给一个本机路径即可；同时收掉 034 的两个遗留（CLI 上传 MIME、文本上限）。

验收：`kb.documents.ingest` / `projects.docs.create|update` / `code.files.create|update` / `resume.parse` 都支持 `file` 参数；CLI 与 AI 工具两条路径都能用。

## 决策

- **`in:"file"` 分两种语义**：带 `target` = 读文本写入指定 body 字段；不带 = 按 multipart 文件上传。这样不用给内容型接口新增 multipart 路由，也不破坏已有上传。
- **只读纯文本**：`target` 模式按 UTF-8 读整文件，默认上限 4MB；PDF/DOCX 这类二进制仍走 `resume.import` 的解析链路，不在这里做通用文档抽取。
- **`content` / `text` 改为非必填**：file 与文本参数二选一；两边都空时由服务端返回业务错误，不在目录层编造默认值。
- **MIME 推断收敛到 shared**：新增 `mimeOfFileName`，服务端工具上传、CLI 上传、工具箱落库三处共用一份扩展名映射；工具箱对 `application/octet-stream` 兜底按文件名再推断。
- **服务端路径校验复用**：绝对路径 + realpath + 拒绝 dotfile + 必须是普通文件，抽成 `localFile()` 给上传和读文本共用，错误文案区分「上传 / 读取」。

## 实现

- `packages/shared/src/operations.ts`：`OperationParam` 增加 `target` / `maxBytes`；`kb.documents.ingest`、`resume.parse`、`projects.docs.create`、`projects.docs.update`、`code.files.create`、`code.files.update` 增加 `file` 参数，原文本参数改为非必填。
- `packages/shared/src/file.ts`（新增）：`mimeOfFileName()`，`index.ts` 导出。
- `apps/server/src/tools/operation-tools.service.ts`：`buildRequest` 拆 `files` / `textFiles`；执行前先读文本写回 `body[target]`；`localFile()` 统一校验，`readTextFile()` 限 4MB。
- `apps/cli/src/cli.ts`：`--file` 同样分两条路径（`target` 读文本进 body，否则 multipart），上传 Blob 带上推断出的 MIME；帮助输出位置显示「文件」。
- `apps/server/src/toolbox/toolbox.service.ts`：`mimetype` 为 octet-stream 时按文件名推断，修掉 CLI 上传的文件类型不准。

## 验证

- 三个包构建通过；`/api/tools` 仍 118 条（本次只扩参数，不新增操作）。
- CLI：`resume.parse --file /tmp/aiwb-resume-test.txt` → `source=text, chars=29, basics.name=张三`。
- CLI：`kb.documents.ingest --title "AIWB 上传测试" --file /tmp/aiwb-kb-test.md` → `size=88, status=embedded, chunkCount=1`；随后 `kb.documents.delete` 清理成功。
- WS 直跑（豆包 `doubao-seed-2-0-lite-260428`）：「解析本机 /tmp/aiwb-resume-test.txt」→ `resume.parse ✓ 5ms` → 回复「姓名：张三」。

## 遗留

- ~~`target` 模式只读 UTF-8 纯文本；PDF / DOCX / 图片仍需先转文本或走 `resume.import`。~~ → 036 已支持 PDF / DOCX（图片仍不支持）。
- ~~省略 `content` 时若 file 文件过大/为空，错误来自执行层而非接口校验，提示略早于真实调用。~~ → 036 改为执行前前置校验。
- ~~列表类工具仍返回全量字段含正文，后续可加 `limit` 或裁剪。~~ → 036 对 `*.list` 做 800 字符裁剪。
- 仍是自定义 `▸TOOL` 协议，未切 OpenAI 原生 function calling。
