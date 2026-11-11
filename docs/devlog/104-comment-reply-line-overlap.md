# 104 · 二级评论连接线与头像不再重叠

日期：2026-11-10 ｜ 分支：main ｜ 类型：fix / ui

## 一、问题

`CommentThread` 的二级回复容器用 `border-l` 画竖向连接线，内边距 `pl-8`（32px）；
而桌面端（`lg`）`CommentRow` 的头像用 `absolute -left-10`（-40px）外移，宽 24px。
两者相减：头像覆盖容器左边缘 -8px ~ +16px，正好压在 0 处的 1px 连接线上，视觉互相遮挡。

## 二、改动

`apps/web/src/features/blog/CommentThread.tsx`：

```diff
- <div className="mt-4 flex flex-col gap-6 border-l border-line/70 pl-8">
+ {/* lg 下头像外移 40px（-left-10），内边距需大于 40px 才不会压到连接线 */}
+ <div className="mt-4 flex flex-col gap-6 border-l border-line/70 pl-8 lg:pl-12">
```

只改桌面内边距，**不动头像定位**：

- `lg`：48px 内边距 → 头像左边缘落在容器 +8px，与连接线留 8px 空隙（8px 栅格）；
- 移动端（`<lg`）：头像本就在流内，`pl-8` 不变，维持原缩进。

## 三、验证（playwright-cli，1280×900 / 390×844，公开阅读页 `/b/admin/7823900a`）

| 视口 | 连接线 x | 头像左边缘 x | 结论 |
|---|---|---|---|
| 1280 桌面 | 422 | 431 | 间隔 9px（含 1px 线），不重叠 |
| 390 移动 | 24 | 57 | 流式布局，间隔 33px |

放大截图（`.screenshots/reply-zoom.png`）可见竖线在最左、头像方块独立在右侧，无叠压。
`pnpm --filter @aiwb/web exec tsc --noEmit` 通过。

## 四、遗留

- 二级正文由 32px 缩进变为 48px，层级更深；若之后要压平层级，需要连同头像外移策略一起调整；
- 连接线仍贯穿「展开其余 N 条回复」按钮高度，暂未做渐隐收尾。
