# 041 · 模型管理：卡片点击进入编辑

- 日期：2026-11-03
- 状态：✅ 已完成（REST + 浏览器 E2E PASS）

## 目标

模型保存后无法修改，可选配置（temperature / topK / apiKey / endpoint 等）一旦填错只能删了重建。用户指定交互：**点击卡片即进入编辑**。

## 决策

- 复用顶部表单做编辑态，不新开弹窗：`editing: ModelDto | null` 与 `showAdd` 互斥，点卡片回填表单并滚动到顶部；正编辑中的卡片 border 高亮 acc。
- **apiKey 留空 = 保持原 key**：服务端本就 `if (input.apiKey)` 才更新，前端只在非空时带上，placeholder 明示，避免"编辑一次把 key 清空"的事故。
- **可选字段可真正清除**：`UpsertModelInput.temperature/topK` 放宽为 `number | null`，编辑时留空传 `null` → meta 置空 = 回到厂商默认；此前 undefined 语义是"不动"，无法撤销已设值。

## 实现

- web `ModelsPanel.tsx`：新增 `startEdit/cancelEdit/saveEdit/closeForm`；表单头部显示「✎ 编辑模型 · provider/modelName」+ 取消；保存按钮按模式分流（PATCH vs POST）；provider 下拉对非预设值（如内置 mock）动态补 option；卡片内容区 `cursor-pointer` + `title="点击编辑该模型"`。
- server `models.service.ts`：`temperature/topK` 类型加 `| null`（赋值逻辑 `!== undefined` 天然兼容，无其他改动）。

## 验证

- REST：PATCH 设 `temperature:0.42, topK:40` → meta 写入；再 PATCH 传 `null` → meta 清除（其余字段如 lastError 不受影响）。
- 浏览器：点 deepseek-chat 卡片 → 表单回填正确、apiKey placeholder 正确；改名保存 → 卡片即时更新、表单关闭（验证后已恢复原名）。

## 遗留

- `temperature/topK` 目前仅存于 meta 展示，LLM 调用链（llm.adapter）尚未消费——属于另一独立缺口，需在 adapter 构建请求时注入。
- 价格字段（priceIn/priceOut/priceNote）后端 PATCH 已支持，表单未开放，后续需要时加两列输入即可。
