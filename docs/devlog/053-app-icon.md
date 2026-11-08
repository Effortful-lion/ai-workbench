# 053 · 接入应用头像

- 日期：2026-11-06
- 状态：已完成

## 目标

把用户提供的头像（AI 工作台科幻元素，2048×2048 PNG）接入为应用品牌标识：浏览器标签页图标、iOS 主屏图标、登录页与顶栏 Logo。

## 决策

- **多尺寸静态资源，不走构建期处理**：原图 4MB，直接引用会拖慢首屏；用 `sips` 预生成 16/32/180/192/512 五档放进 `apps/web/public/icons/`，由 Vite 原样复制到 `dist/icons/`，零运行时开销。
- **只做图标与页内 Logo，不引入 webmanifest**：当前不是 PWA，加 manifest 会产生无实际收益的额外配置；后续要做安装能力时再补。
- **裁掉水印，不擦除**：原图右下角有「豆包 AI 生成」水印。用 `sips -c 1860 1860 --cropOffset 0 94` 居中裁成 1860×1860 —— 水印全在 y≥1884 区域，被裁掉；圆环（约 x 248–1800、y 140–1830）完整保留，无拉伸变形。

## 实现

- `apps/web/public/icons/icon-{16,32,180,192,512}.png`：新增，由去水印后的 1860 方形源图等比缩放。
- [index.html](file:///Users/lion/workspace/gocode/ai-workbench/apps/web/index.html#L6-L9)：标签页标题改为「AI 工作台 · 智能协作中枢」；新增 favicon 16/32 与 apple-touch-icon 180。
- [TopBar.tsx](file:///Users/lion/workspace/gocode/ai-workbench/apps/web/src/shell/TopBar.tsx#L65-L71)：顶栏 `⌘` 占位符替换为 18px 圆角图标。
- [LoginScreen.tsx](file:///Users/lion/workspace/gocode/ai-workbench/apps/web/src/features/auth/LoginScreen.tsx#L45-L52)：登录页品牌区加 48px 图标。

## 验证

- `pnpm --filter @aiwb/web build` 通过。
- `apps/web/dist/icons/` 已产出五档图标，说明 public 资源链路正常。
- 浏览器标签页与登录页/顶栏在 dev 热更新后直接可见。

## 遗留

- 如需 PWA / macOS 桌面图标，再补 `site.webmanifest` 与 `icon-1024.png`。
