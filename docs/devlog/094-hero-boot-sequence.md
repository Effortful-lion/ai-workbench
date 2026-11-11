# 094 · Hero 首屏启动动画

日期：2026-11-10 ｜ 分支：main ｜ 类型：feat

## 一、来源

`docs/prototype/index.html` 的 `bootSeq()`：进首页先打出三行终端启动日志，再逐字打出招呼语，随后副标题、输入框、chips、页脚依次淡入。

```551:578:docs/prototype/index.html
async function bootSeq(){
  const lines = [`lion@workbench ~ $ wb init`, `[ok] session · ...`, `[ok] qdrant · ...`];
  for(const ln of lines){ ... await typeInto(div, plain, 7); div.innerHTML = ln; await wait(90); }
  await typeInto($('#greetTxt'), `${hello}，Lion。`, 55);
  sub.style.opacity=1;
  for(const id of ['#heroBox','#chips','#heroFoot']){ el.style.opacity=1; await wait(120); }
  $('#heroInput').focus(); phLoop();
}
```

## 二、决策

- **每字 `setState`，不搬 `innerHTML` 拼接**：原型直接改 DOM，React 侧把「已打完的启动行 / 当前正在打的行 / 招呼已打出的字符数 / 淡入层数」收进一个 `Intro` 状态对象，一次性驱动渲染，避免与虚拟 DOM 打架。
- **状态机而不是嵌套回调**：`phase`（0 启动行 / 1 招呼语 / 2 打字结束）+ `reveal`（1 副标题 / 2 输入框 / 3 快捷入口 / 4 最近提问）两个字段就够了，淡入用 `reveal >= n` 派生，不需要额外的布尔堆。
- **招呼语高亮不能丢**：原来是 `{greeting()}，<span class="text-acc">{username}</span>！`。逐字输出时按长度切片成 `headTxt / nameTxt / tailTxt` 三段，用户名始终保持 `text-acc`。
- **布局预留**：启动区固定 `min-h-[68px]`（三行 × 1.9 行高），`h1` 固定 `min-h-[38px]`，打字过程中高度不变，页面不会抖。
- **左对齐 / 同一条基准线**：原型 hero 是左对齐的，首版沿用旧的 `items-center + text-center`，启动块又只有 520px 宽，左边缘比下方输入框缩进约 100px，看起来像错位。改为容器去掉 `items-center`、启动块与引导行 `w-full`、日期/招呼/副标题 `text-left`，所有元素共享容器左边界。首行提示符里的 `lion` 也从写死改成登录用户名（`name || "user"` 兜底）。
- **占位打字等输入框出现再启动**：`useTypedPlaceholder(text.length === 0 && intro.reveal >= 2)`，否则开场 2 秒里文案在透明区域空转，露出来已是半句话。
- **reduced-motion 直接终态**：命中 `prefers-reduced-motion: reduce` 时不打启动行、不打字、不淡入，一次 `setIntro` 落到全部可见。
- **StrictMode 保护**：effect 开头先把 `Intro` 归零，开发态双次执行不会把启动行叠成六行。

## 三、实现

`apps/web/src/shell/HeroState.tsx`：

| 位置 | 改动 |
|---|---|
| `bootLines(who)` | 生成三行启动日志，首行取当前登录用户名（`${who}@workbench ~ $ wb init`），第二行含当前日期与时间（`[ok] session · YYYY-MM-DD HH:MM:SS`） |
| `useIntro(greetText)` | 启动行 7–17ms/字 + 90ms 行间隔 → 招呼 55–73ms/字 → `reveal` 每 120ms 加一层 |
| `fade(n)` | `opacity-0 pointer-events-none` ↔ `opacity-100`，`duration-500` |
| hero 顶部 | 启动行块（`[ok]` 绿色高亮、打字时带方块光标）+ 逐字 `h1`（打字时带 `animate-blink` 光标） |
| 副标题 / 表单 / 快捷入口 / 最近提问 | 分别挂 `fade(1..4)` |

## 四、验证

- `read_lints` 0 诊断；`pnpm --filter @aiwb/web build` 通过（exit 0）。
- 预期观感：进入首页 → 三行启动日志快速打出 → 招呼语逐字出现（光标闪） → 光标消失、副标题淡入 → 输入框淡入并开始打占位文案 → 快捷入口、最近提问依次淡入，全程约 2s。

## 五、待办

- 原型在动画结束后才 `focus()` 输入框；当前沿用 `autoFocus`，开场即聚焦（用户可抢在动画结束前直接输入，占位打字会立刻停）。若觉得光标闪得太早可改为动画完成再聚焦。
- 每字一次 `setState` 会带着整块 hero 重渲染，约 130 次/2s，桌面无感；若后续 chips 变多再考虑把打字状态抽成独立子组件。
