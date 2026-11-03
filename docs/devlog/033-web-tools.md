# 033 · 联网工具 web.search / web.fetch

- 日期：2026-11-03
- 状态：已完成

## 目标

给 AI 补两只「手」：能搜互联网、能读网页正文。这两项没有对应的后端 API，属于操作目录之外的增强工具。

## 决策

- **搜索用 Bing HTML，不接第三方 API**：不需要 Key、开箱即用，`www.bing.com/search` 返回的 `li.b_algo` 结构稳定可解析；结果里的 `/ck/a?...&u=a1<base64>` 跳转链接在解析时还原成真实 URL。
  - 否决 DuckDuckGo：本机/内网环境 `html.duckduckgo.com` 连接失败（TLS 000），Bing 实测可用。
  - 否决百度：302 反爬跳转，解析成本高。
- **无 Key 的代价用 UA + 上限兜住**：伪装桌面 Chrome UA，单次最多 10 条结果、抓取 2MB / 20s 超时，失败直接报错，不静默返回空。
- **web.fetch 必须挡内网**：`localhost`、`127.*`、`10.*`、`172.16-31.*`、`192.168.*`、`169.254.*`、`::1`、`fc00::/7`、`fe80::`、单段主机名（如 `intranet`）一律拒绝，避免被提示词诱导去抓本机管理接口或云元数据。
- **权限挂在 `tools:read`**：member / guest 也能用；两项都是只读，不触碰业务数据。
- **HTML → 纯文本**：去 script/style/注释，块级标签换行，解码实体，压缩空白；JSON 自动 pretty；正文默认 12000 字符、上限 30000，超长标注截断。

## 实现

- `apps/server/src/tools/web.tools.ts`（新增）：`WebTools`，两个 `@RegisterTool` 方法。
  - `search(ctx, { query, count })` → `{ query, count, results: [{ title, url, snippet }] }`。
  - `fetch(ctx, { url, maxChars })` → `{ url, status, contentType, title, chars, content }`。
  - 辅助：`parseBingResults` / `realUrl` / `assertFetchable` / `readLimited` / `htmlToText` / `decodeEntities`。
- `apps/server/src/tools/tools.module.ts`：providers 增加 `WebTools`，随 DiscoveryService 自动注册。

## 验证

- 直接实例化（`node -e` 调 dist）：
  - `search({query:'trae ai ide',count:5})` → 5 条，标题/链接正常（`https://www.trae.cn/`、`https://www.trae.ai/` …）。
  - `fetch(trae.cn)` → 200、`text/html`、标题与正文可读；`maxChars=800` 生效。
  - `fetch(http://127.0.0.1:8700/api/health)` → 抛「禁止访问内网 / 本机地址」。
- `GET /api/tools`（owner）→ 116 条，含 `web.search` / `web.fetch`。
- WS 直跑（豆包 `doubao-seed-2-0-lite-260428`）问「帮我联网搜一下 TRAE 是什么，给我官网链接」：
  - trace：`LLM 请求工具 web.search` → `tool.done ✓ 522ms` → 纯文本总结，给出 trae.cn / trae.ai / docs.trae.cn 等链接。

## 遗留

- Bing 页面结构变化会让解析失效，届时需换搜索引擎或接正式 API。
- JS 渲染站点（如 trae.cn 首页）只能拿到静态骨架，正文可能很短；需要时后续可接渲染服务。
- 搜索无 API Key，依赖公网出口；完全离线环境下只能报错。
