# 093 · Hero 打字机占位文案

日期：2026-11-10 ｜ 分支：main ｜ 类型：feat

## 一、来源

`docs/prototype/index.html` 的 `phLoop`（原型用一个叠加层 `#ph` 做占位文案，因为原生 `placeholder` 属性无法逐字动画）：

```586:601:docs/prototype/index.html
async function phLoop(){
  const ph = $('#ph');
  while(S.state==='hero'){
    const t = PHS[phIdx % PHS.length]; phIdx++;
    for(let i=0;i<=t.length;i++){
      if(S.state!=='hero' || $('#heroInput').value) break;
      ph.textContent = t.slice(0,i) + '▌'; await wait(42);
    }
    await wait(1800);
    ...
  }
}
```

## 二、决策

- **不搬叠加层**：原型用绝对定位的 `#ph` 盖在 input 上，需要处理点击穿透、聚焦、值同步。React 侧直接用受控 `placeholder` 属性，少一层 DOM 与一段同步逻辑。
- **用 Hook 而不是在组件里写异步循环**：循环要能随「输入框是否为空」中断，`useEffect` 依赖 `[active]` 天然满足；`alive` 标志 + `clearTimeout` 保证卸载/依赖切换后不再 `setState`。
- **回删要删干净**：最初为了「不闪空」把回删停在首字（`i >= 1`），实际观感与原型不符——原型是整条删空后再打出下一条。改为 `i >= 0` 删到空，占位符在删空间隙显示为空（原型 `ph.textContent = i ? '▌' : ''` 同样如此），300ms 后下一条重新逐字打出。
- **reduced-motion 降级**：`matchMedia("(prefers-reduced-motion: reduce)")` 命中时只静态显示首条，不启动循环。
- **文案与原型对齐**：前四条照抄原型 PHS，末条换成「分析这周的访问统计」，多覆盖一个统计面板入口（原型的第 4 条 Agent 类占位保留）。

## 三、实现

`apps/web/src/shell/HeroState.tsx`：

| 位置 | 改动 |
|---|---|
| 模块顶层 `PHS` | 5 条占位文案 |
| `useTypedPlaceholder(active)` | 打字 → 停 1800ms → 回删到空（14ms/字）→ 停 300ms → 下一条（42ms/字）；`active=false` 立刻清空 |
| `HeroState` 内 | `const typedPh = useTypedPlaceholder(text.length === 0)`；`const placeholder = text ? PHS[0] : typedPh ? \`${typedPh}▌\` : ""` |
| hero `<input>` | `placeholder={placeholder}` |

输入框一旦有内容即 `active=false`，循环终止、`typed` 清空；清空输入后自动重新开始。删空间隙那 300ms 内 `typed` 为空，占位符随之清空，紧接着下一条首字出现。

## 四、验证

- `pnpm --filter @aiwb/web build` 通过（2429 modules，351ms）；`read_lints` 0 诊断。
- 手工：首页停留可见占位文案逐字打出、停顿、回删、切换；输入任意字符动画立即停止；清空后恢复；系统开启「减弱动态效果」时只显示静态首条。

## 五、待办

原型里 `phLoop` 还带光标闪烁（`▌` 常亮，未做 blink），当前只拼了静态字符。若要对齐到闪烁效果，需改用叠加层方案，权衡后暂不做。
