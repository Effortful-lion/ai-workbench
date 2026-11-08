# 070 · 文件正文可读性确认 + 路径编码 / 404 修复

日期：2026-11-07
状态：已完成

## 用户疑问

「仓库里的文件的内容是不可读的，是吧？」——误以为文件 Tab 只能看文件名。

## 核实结论

**完全可读**。浏览器实测：仓库 → 文件子 tab → 点根目录 `package.json`，右侧 pane 正确渲染完整 JSON 正文，无报错。后端 `/tree` 返回 287 个条目，`/file` 返回 raw 正文（上限 256KB，超出提示去 GitHub）。

用户可能被 `README.md` 的报错误导——该仓库确实没有 README 文件。

## 顺带修复两个瑕疵

1. **路径编码不规范**：`encodeURIComponent(path)` 会把分隔符 `/` 编成 `%2F`。GitHub 虽能解码，但不符合 REST 路径语义。改为逐段编码：`path.split("/").map(encodeURIComponent).join("/")`。
2. **文件不存在返回 500**：`throw new Error` 被全局过滤器当未知错误。改为 `NotFoundException`，正确返回 404。

## 验证

- `/file?path=apps/server/package.json` → 正文正确返回
- `/file?path=NOPE.md` → HTTP 404（原为 500）
