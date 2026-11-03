# 036 · 文件操作遗留收尾

- 日期：2026-11-03
- 状态：已完成

## 目标

清掉 035 遗留的三条：`target` 模式不支持二进制、`file` 与文本都空时报错太晚、列表类工具返回全文撑上下文。

验收：`target` 模式能读 PDF/DOCX；缺参时执行前就报错；`*.list` 工具返回的长正文被裁剪。

## 决策

- **抽取逻辑收敛**：新建 `common/file-text.ts`，简历导入与工具侧 `--file` 共用一份 PDF/DOCX/纯文本抽取；`resume.extract.ts` 改为委托，避免两套实现漂移。
- **空参在入口拦**：`file` 带 `target` 且对应文本字段为空时，执行前直接抛「二选一」错误，不再等接口读完文件才失败。
- **裁剪只作用于列表**：仅 `action.endsWith(".list")` 的返回值做 800 字符截断（附 `…(已截断)`），`*.get` 保持全文，详情仍可按需读取。
- **CLI 不解二进制**：CLI 侧对 `.pdf/.docx/.doc` 明确报错并引导走 `resume.import`，避免把二进制当 UTF-8 塞进知识库；解析能力只放在服务端。

## 实现

- `apps/server/src/common/file-text.ts`（新增）：`extractTextFromBuffer()` 按扩展名走 `unpdf` / `mammoth` / UTF-8；`unpdf` 为纯 ESM，用 `new Function("s","return import(s)")` 加载。
- `apps/server/src/resume/resume.extract.ts`：改为调用通用抽取，保留简历场景的空文本提示与 `MAX_IMPORT_CHARS` 截断。
- `apps/server/src/tools/operation-tools.service.ts`：加空参前置校验；`readTextFile()` 支持 `.pdf/.docx`；新增 `shrinkListPayload()` 处理列表返回。
- `apps/cli/src/cli.ts`：加同样的空参前置校验；`readTextFile()` 拒绝二进制文档。
- `packages/shared`：`OperationParam` 的 `target` / `maxBytes` 保持 035 定义，本次未改目录。

## 验证

- 三个包构建通过（`shared` / `server` / `cli`）。
- CLI：`kb.documents.ingest --title "空参数测试"` → exit 2，提示「需要 --file 或 --content（二选一）」。
- CLI：`kb.documents.ingest --title "PDF 测试" --file /tmp/aiwb-fake.pdf` → 提示「CLI 暂不支持二进制文档」。
- CLI：`resume.import --file /tmp/aiwb-cv.txt` → `source=text, chars=14, basics.name=张三`（重构后链路正常）。
- 抽取单测（直接调用 `extractTextFromBuffer`，样例用 `cupsfilter` / `textutil` 生成）：PDF → `source=pdf`，正文两行完整；DOCX → `source=docx`，正文完整。

## 遗留

- 列表裁剪按字符数截断，不区分字段；若后续需要分页语义，可在目录层给 `*.list` 加 `limit` 并透传给接口。
- 仍不支持图片 OCR；扫描版 PDF 依旧提示「请粘贴文本」。
- 仍是自定义 `▸TOOL` 协议，未切 OpenAI 原生 function calling。
