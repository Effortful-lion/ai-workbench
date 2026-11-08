# 057 · 邮件富文本正文与附件

- 日期：2026-11-06
- 状态：已完成

## 目标

邮件详情此前只显示 `body` 纯文本：HTML 邮件被 `stripHtml` 降级成纯文本，内嵌样式/表格/链接全部丢失；附件（含图片、PDF、二进制）完全没有入口。本次让详情支持：

1. 渲染 HTML 正文，并保留「纯文本」切换；
2. 解析并展示附件（文件名 / 类型 / 大小 / 图片占位缩略图）；
3. 附件二进制落盘，可下载。

## 决策

- **HTML 用沙箱 iframe + CSP，而不是 dangerouslySetInnerHTML**：邮件 HTML 不可信。`sandbox=""` 禁止脚本/表单/同源访问；注入 `default-src 'none'; style-src 'unsafe-inline'; img-src data:`，保留内联样式与 base64 图片，阻断外部图片/字体/iframe（同时避免 IP 泄漏）。
- **外部图片换占位块**：非 `data:` 的 `<img>` 替换为斜纹占位（「图片占位 · 外部图片已屏蔽」），既防止追踪像素，也让用户知道这里原本有图。
- **二进制不随列表下发**：DB 只存附件元信息 `{index, filename, contentType, size, inline, path}`；内容写 `data/mail-attachments/<messageId>/`，按 `GET /mail/messages/:id/attachments/:index` 下载。避免把几 MB base64 塞进列表 JSON。
- **单附件 25MB 上限、HTML 300KB 上限**：超出时附件只存元信息（`available=false`），HTML 截断。
- **老数据一次性回填**：`bodyHtml IS NULL` 表示「尚未解析」；同步时对命中的旧邮件用已拉取的 raw 重新 `simpleParser`，补 HTML/附件后写 `""`（表示已解析但无 HTML），避免每次同步重复解析。
- **inline 资源不列附件区**：`cid`/`related` 的内嵌图只在 HTML 中出现，不作为附件。

## 实现

后端：
- [schema.ts](file:///Users/lion/workspace/gocode/ai-workbench/apps/server/src/db/schema.ts)：`mail_messages` 新增 `body_html`、`attachments_json`（json，默认 `[]`）。
- [mail.service.ts](file:///Users/lion/workspace/gocode/ai-workbench/apps/server/src/mail/mail.service.ts#L38-L96)：`persistMessageAttachments()` 落盘并生成元信息；`attachmentFile()` 反查路径（带 `ATTACH_ROOT` 前缀校验防目录穿越）；删除邮件时清理附件目录。
- 同文件同步逻辑：新邮件写入 `bodyHtml` + 附件；`known.bodyHtml === null` 的旧邮件补全一次。
- [mail.controller.ts](file:///Users/lion/workspace/gocode/ai-workbench/apps/server/src/mail/mail.controller.ts#L105-L126)：`GET messages/:id/attachments/:index`，`StreamableFile` + RFC5987 中文文件名。
- [shared/mail.ts](file:///Users/lion/workspace/gocode/ai-workbench/packages/shared/src/mail.ts)：`MailAttachmentDto`；`MailMessageDto` 增加 `bodyHtml` / `attachments`。

前端：
- [MailPanel.tsx](file:///Users/lion/workspace/gocode/ai-workbench/apps/web/src/features/mail/MailPanel.tsx)：正文区 HTML / 纯文本切换；`HtmlMailBody` iframe 渲染；附件卡片（IMG/PDF/ZIP/DOC 角标、图片棋盘格占位、大小、下载）。
- [api.ts](file:///Users/lion/workspace/gocode/ai-workbench/apps/web/src/lib/api.ts)：新增 `apiBlob()`，带鉴权头下载二进制。

## 验证

- `drizzle-kit push` 加列成功（`body_html TEXT`、`attachments_json TEXT default '[]'`），DB 已备份为 `data/workbench.db.bak`。
- `tsc --noEmit`（server）通过；web build 通过（web 存在 4 处与本改动无关的历史类型错误）。
- 实际同步 QQ 邮箱：77 封收件箱邮件中 47 封解析出 HTML、28 封含附件；附件全部 `available=true`。
- 附件下载实测：`content-type: message/rfc822`、`content-length: 3840`、`content-disposition: attachment; filename="mail.eml"`，字节一致。

## 遗留

- 附件不支持「全部打包下载」；HTML 中的内嵌图若为 `cid:` 引用不会显示（数据 URI 的可以）。
- 列表接口仍返回 HTML 正文，邮件量很大时可改为详情接口按需加载。
- 草稿/发件箱的富文本未做（目前发送正文仍是纯文本）。
