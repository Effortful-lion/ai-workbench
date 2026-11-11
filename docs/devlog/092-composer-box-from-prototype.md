# 092 · 输入框对齐原型（.box 规格）

日期：2026-11-10 ｜ 分支：main ｜ 类型：refactor

## 一、来源

`docs/prototype/index.html` 的 composer 规格：

```106:115:docs/prototype/index.html
.box{
  margin-top:34px; display:flex; align-items:center; gap:10px;
  border:1px solid var(--line); border-radius:8px; background:var(--bg1);
  padding:16px 16px; transition:border-color .15s, box-shadow .15s; position:relative;
}
.box:focus-within{border-color:var(--acc); box-shadow:var(--glow)}
.box .ps1{font-family:var(--mono); color:var(--acc); font-size:14px; flex:none}
.box input{flex:1; font-family:var(--mono); font-size:14px; caret-color:var(--acc)}
.kbd{font-size:10.5px; color:var(--tx3); border:1px solid var(--line); border-radius:4px; padding:3px 6px; flex:none}
```

## 二、落地范围

两处输入框各写各的，尺寸互不一致，本轮统一到同一份规格：

| 项 | 原型 | 改造前 | 改造后 |
|---|---|---|---|
| 圆角 | 8px | hero 8px / dock 4px | 均 8px（`rounded-lg`） |
| 内边距 | 16px | hero 16 / dock 10 | 均 `px-4 py-4` |
| 元素间距 | 10px | hero 12 / dock 8 | 均 `gap-2.5` |
| 提示符 | `›` 绿 14px | 两处都是 `▸` | `›` + `text-[14px]` |
| 输入字号 | 14px | hero 15 / dock 13 | 均 `text-[14px]` |
| 光标色 | `caret-color: acc` | 无 | `caret-acc` |
| 右侧键帽 | `⏎` + `⌘K`，10.5px/4px/3×6 | hero 仅 `⏎`；dock 纯文本 | 两处都两个键帽，同规格 |
| 聚焦反馈 | border acc + 12px 光晕 | hero 内联 color-mix；dock 仅变色 | 统一 `shadow-[var(--glow)]` |
| dock 外边距 | 12 / 14 / 16 | `p-3` | `px-3.5 pb-4 pt-3` |

新增 token（`index.css`）：

```css
--glow: 0 0 12px color-mix(in srgb, var(--acc) 13%, transparent);
```

用 `color-mix` 而不是固定 `--a22`，warm 主题下光晕会跟着 `--acc`（`#9A6200`）自动换色。

## 三、保留的既有能力

- `CommandSuggest` 下拉（`/` 命令补全）位置不变，仍在相对容器内展开；
- 流式输出时输入框禁用、右侧换成「■ 停止」按钮（键帽只在空闲态渲染）；
- hero 的 `autoFocus`、模型选择注释行不动。

## 四、验证

- `pnpm --filter @aiwb/web build` 通过，`read_lints` 0 诊断；
- 产物含 `caret-color:var(--acc)` 与 `--glow`（含 `color-mix` 降级）；
- 截图：首页 hero 与 `/p=mail` 面板左侧 dock，提示符、字号、键帽、圆角一致，聚焦态绿边可见。

## 五、待办

原型里还有若干交互未搬（快捷 chips 网格、hero 打字机占位、提示行 hints、CLI 全屏入口的键帽提示），本次只做输入框，其余等确认。
