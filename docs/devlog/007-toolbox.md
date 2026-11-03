# 007 · toolbox 百宝箱

- 日期：2026-11-02
- 状态：✅ 完成（接口 curl 全 PASS；前端浏览器验证 owner 新增/计数、member 只读、游客公开页 PASS）

## 目标

把「百宝箱」做成**快捷指令墙**，而不是工具表格：

- 卡片形态 `▸ name / host / 简介 / ↗ N 次 / #分类`，分类 chips 过滤（`#all` + 去重分类）。
- 新增尽量不填表：面板提供一行 `alias.new <url> #分类 简介` 命令（支持 `--name` / `--cat`）。
- 点击卡片在新标签打开工具，并累计使用次数；owner 可删除，member 只读。
- 游客通过 `/t/:username` 打开公开只读墙，无需登录。
- 能力同时注册为 AI Tool（`toolbox.list` / `toolbox.add`），供 Agent 在对话里读写。

## 决策

1. **独立表 `toolbox_items`**：总体设计 §7 已列该表；字段收敛为
   `id / owner_id / name / url / category / desc / use_count / created_at`，
   `owner_id` 外键级联删除，避免用户删除后残留孤儿卡片。
2. **权限沿用原型 ACL**：owner `rw`、member `ro`、guest `ro·公开`。权限点复用
   `tools:read` / `tools:write`；`tools:write` 只由 owner 的 `"*"` 覆盖，**不改 roles 权限表**，
   member 因此天然只读。前端 `canWrite = role === "owner"` 只做展示层收缩，服务端 Guard 兜底。
3. **新增入口是命令行而不是表单**：`alias.new <url> #分类 简介` 一行解析出 url/name/category/desc，
   延续终端气质；同时注册 `toolbox.add` 让 Agent 用自然语言添加，两条路径共用同一 service 校验。
4. **URL 只接受 http(s)**：`normalizeUrl` 用 `new URL()` 解析并 `toString()` 规范化，
   拒绝 `javascript:` 等协议，避免公开墙上出现可执行伪协议；同时限制 URL 500 / 名称 40 / 简介 200。
5. **别名可省略**：无 `--name` 时从 hostname 第一段推导（`cursor.sh → cursor`），
   保证一行命令也能得到可读的 alias；分类缺省 `misc`。
6. **使用计数放在独立 `POST /use`**：前端先同步 `window.open` 再异步计数，避免请求后窗口被浏览器拦截；
   计数失败不影响打开工具。计数权限用 `tools:read`（member 也能计数），删除/新增才需 `tools:write`。
7. **公开页复用组件、但点击不计数**：`PublicToolboxPage` 复用 `ToolboxWall`，只传 `canWrite=false` 且不传
   `onDelete`；游客点击仅打开链接，不写库，公开页保持纯只读。
8. **排序即热度**：列表按 `use_count DESC, created_at DESC`，常用工具自然浮到前排，不做手工拖拽排序。

## 实现

- 共享协议：[toolbox.ts](file:///Users/lion/workspace/gocode/ai-workbench/packages/shared/src/toolbox.ts)
  （`ToolboxItemDto` / `ToolboxItemInput`），由 [index.ts](file:///Users/lion/workspace/gocode/ai-workbench/packages/shared/src/index.ts) 导出。
- 服务端：
  - [schema.ts](file:///Users/lion/workspace/gocode/ai-workbench/apps/server/src/db/schema.ts)
    新增 `toolbox_items` 表（已 `drizzle-kit push --force` 建表）。
  - [toolbox.service.ts](file:///Users/lion/workspace/gocode/ai-workbench/apps/server/src/toolbox/toolbox.service.ts)
    `normalizeUrl` / `deriveName` / `normalizeCategory` / `list` / `listPublic` / `create` / `remove` / `touch`。
  - [toolbox.controller.ts](file:///Users/lion/workspace/gocode/ai-workbench/apps/server/src/toolbox/toolbox.controller.ts)
    `GET/POST /api/toolbox/items`、`DELETE /api/toolbox/items/:id`、`POST /api/toolbox/items/:id/use`、
    `GET /api/toolbox/public/:username`（无守卫）。
  - [toolbox.tools.ts](file:///Users/lion/workspace/gocode/ai-workbench/apps/server/src/toolbox/toolbox.tools.ts)
    `toolbox.list`（`tools:read`，可选 category 过滤）、`toolbox.add`（`tools:write`）。
  - [toolbox.module.ts](file:///Users/lion/workspace/gocode/ai-workbench/apps/server/src/toolbox/toolbox.module.ts)
    与 [app.module.ts](file:///Users/lion/workspace/gocode/ai-workbench/apps/server/src/app.module.ts) 接线。
- 前端：
  - [ToolboxWall.tsx](file:///Users/lion/workspace/gocode/ai-workbench/apps/web/src/features/tools/ToolboxWall.tsx)
    分类过滤 + 卡片阵列；删除按钮 `stopPropagation`，避免误触打开工具。
  - [ToolboxPanel.tsx](file:///Users/lion/workspace/gocode/ai-workbench/apps/web/src/features/tools/ToolboxPanel.tsx)
    `parseAlias` 命令解析、owner 新增、点击计数、确认删除、复制公开链接。
  - [PublicToolboxPage.tsx](file:///Users/lion/workspace/gocode/ai-workbench/apps/web/src/features/tools/PublicToolboxPage.tsx)
    `/t/:username` 公开只读页与 404 态。
  - [PanelZone.tsx](file:///Users/lion/workspace/gocode/ai-workbench/apps/web/src/shell/PanelZone.tsx) 映射
    `tools: () => <ToolboxPanel />` 并移除已无用的 Placeholder；
    [HeroState.tsx](file:///Users/lion/workspace/gocode/ai-workbench/apps/web/src/shell/HeroState.tsx) 新增
    「▸ 打开百宝箱」chip；
    [App.tsx](file:///Users/lion/workspace/gocode/ai-workbench/apps/web/src/App.tsx) 在登录判断前识别
    `/t/:username`，复用 `decodeURIComponent` 解用户名。

## 验证

- 构建：shared `tsc` 通过；server / web `tsc --noEmit` 0 错误；web `vite build` 通过（73 modules）。
- curl（owner 用 dev secret 手工签发 JWT）：
  - 无 token `GET /toolbox/items` → 401；公开 `GET /toolbox/public/nobody` → 404。
  - owner `GET /toolbox/items` → 200；`POST` 5 条演示工具（cursor/#dev、raycast/#dev、claude/#ai、
    figma/#design、portainer/#ops）→ 201，URL 均被规范化为带尾斜杠。
  - owner `POST /items/:id/use` → `{"useCount":1}`；`POST` 非法 `javascript:` URL → 400
    `url 仅支持 http / https`；owner `POST` + `DELETE` → 201/200，列表数 1 → 0。
  - member `kbtest`：`GET /toolbox/items` → 200；`POST` → 403；`DELETE` → 403。
  - `GET /tools`（owner）返回 `toolbox.list` / `toolbox.add`，与既有工具同列。
- 浏览器（960×640）：
  1. 游客打开 `/t/lion`：终端标题 `~/t/lion/aliases` + `read-only`，5 张卡片（cursor/raycast/claude/
     figma/portainer），chips `#all/#dev/#ai/#design/#ops`，无新增输入框、无删除按钮。
  2. `tbmember` 登录（临时账号）→ 首页 chip「▸ 打开百宝箱」→ 面板 `~/tools · 百宝箱`，
     有 `read-only` 徽标与只读提示行，无 `alias.new` 输入框、无删除按钮，正常显示 2 张卡片。
  3. `tbowner` 登录（临时账号）→ `alias.new http://localhost:8701/t/lion #test 公开页` 提交后
     出现卡片与 `✓ alias.localhost #test 已加入`；点击卡片打开新标签后回到面板，计数变为 `↗ 1 次`。
     删除按钮可由脚本触发并移除卡片；该条随后从 DB 消失。
  4. 临时账号 tbowner/tbmember 及测试卡片验证后已从 DB 删除；lion 的 5 条演示数据保留。
- 说明：无 `--name` 时 `http://localhost:8701/...` 会按 hostname 推导为 `localhost`，属预期行为；
  展示用别名建议显式写 `--name`。

## 遗留

- 浏览器自动化直接点击卡片右上角 `✗` 时容易被卡片本体拦截（代码已 `stopPropagation`），
  本轮改由脚本触发完成删除；后续可把删除入口移到卡片底部工具条或二次菜单，降低误触与自动化难度。
- 分类是自由文本：同一语义可能产生 `dev` / `Dev` / `开发` 多个 chips，后续可做归一化或预设分类。
- 无编辑能力（只能新增/删除）；改 URL/分类需删除重建。
- 无图标、无拖拽排序、无收藏/置顶、无「最近使用」时间（只有次数）。
- 公开页固定展示全部工具，没有单项隐藏或整墙开关；游客无法按分类之外的条件搜索。
- `toolbox.add` 只支持新增，没有 `toolbox.remove` / 搜索工具，Agent 无法帮用户整理已有卡片。
- 点击卡片直接 `window.open` 外链，没有内嵌预览或危险链接提示（仅靠协议白名单兜底）。
