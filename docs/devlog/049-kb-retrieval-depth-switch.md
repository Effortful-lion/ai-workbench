# 049 · kb 检索深度开关（quick / deep）

- 日期：2026-11-06
- 状态：已完成

## 目标
让用户按问题性质选择检索深度：简单事实走快速检索，需要跨文档推理时走图谱检索。之前只有服务端全局环境变量 `LIGHTRAG_QUERY_MODE`，前端无法切换。

## 决策
1. **对外只暴露两档，不暴露 LightRAG 的五个 mode**：
   - `quick` → `naive`：仅向量召回，跳过关键词/图谱抽取，适合「某句话在哪」「某字段是什么」。
   - `deep` → `mix`：图谱 + 向量，支持跨文档多跳与因果归纳。
   理由：`local` / `global` / `hybrid` 都属「图谱」一档，普通用户无法感知差异，暴露五档只增加选择成本；三档以上也没有真实的产品语义支撑。
2. **默认 deep**，保持既有行为与答案质量，需要省时的用户主动切 quick。
3. **底层映射可配**：`LIGHTRAG_QUICK_MODE`（默认 naive）、`LIGHTRAG_DEEP_MODE`（默认 mix，兼容旧 `LIGHTRAG_QUERY_MODE`），便于按语料/模型调整。
4. **纯检索接口不变**：`/kb/search` 无 mode 参数，沿用 `LIGHTRAG_SEARCH_MODE`（默认等于 deep）。
5. **缓存按 (问题, 模式) 分键**：同一问题在 quick 与 deep 下各自缓存，切换档位不会误命中另一档的答案。
6. qdrant 路径没有图谱能力，两个档位行为一致，仍回显用户选择的 `mode` 保持契约统一。
7. **deep 内部不再做二次模式选择，固定 `mix`**（2026-11-06 追加）。评估过三种做法：
   - 规则路由（按问句特征分到 local/global/hybrid）：零延迟、可解释，但规则粗糙时会静默选错档；
   - LLM 路由：多一次 1–3s 调用，多一个失败点，而主延迟来自答案生成，省不出时间；
   - 按结果升级（quick 失败再跑 deep）：只在需要时付图谱代价，但失败场景总延迟翻倍。
   结论：当前语料规模与问题分布下收益不足，保持 `mix` 兜底；若后续出现明显错配，优先做规则路由，不引入 LLM 路由。

## 实现
- [kb.ts](file:///Users/lion/workspace/gocode/ai-workbench/packages/shared/src/kb.ts#L40-L66)：新增 `KbAskMode`，`KbAskInput.mode`，`KbAskResultDto.mode`。
- [lightrag.service.ts](file:///Users/lion/workspace/gocode/ai-workbench/apps/server/src/kb/lightrag.service.ts#L172-L177)：`modeFor()` 档位映射；`query` / `queryData` 接受 mode 并纳入缓存键。
- [kb.service.ts](file:///Users/lion/workspace/gocode/ai-workbench/apps/server/src/kb/kb.service.ts#L264-L327)：`ask()` 接受 mode，LightRAG 两路调用与结果均带回档位。
- [kb.controller.ts](file:///Users/lion/workspace/gocode/ai-workbench/apps/server/src/kb/kb.controller.ts#L54-L60)：改用 `KbAskInput` 透传 mode。
- [KbPanel.tsx](file:///Users/lion/workspace/gocode/ai-workbench/apps/web/src/features/kb/KbPanel.tsx#L311-L357)：输入框上方新增 `⚡ quick / ◆ deep` 开关与档位说明；回答卡片头部显示本次实际档位。

## 验证
环境：`pnpm start:lightrag`，LightRAG 9621 在线；同问题「LangChain 属于哪个模块？」。

| 请求 | mode 回显 | 延迟 |
|---|---|---|
| `mode=quick` 首次 | quick | 13316 ms |
| `mode=deep` 首次 | deep | 29397 ms |
| 不传 mode | deep | 0 ms（命中 deep 缓存） |
| `mode=quick` 重复 | quick | 0 ms（命中 quick 缓存） |

- quick 约为 deep 的 2.2 倍速度；两档缓存互不串味；缺省值等价于旧行为。
- `tsc --noEmit`（server / web 改动文件）通过，`nest build` 通过，server 已重启。

## 遗留
- quick 仍是「检索 + LLM 组答案」，约 13s；若要真正秒级，需要新增「只返回检索片段、不生成答案」的第三种档位（类似 search 视图），未实现。
- 档位当前按单次提问生效，未记忆用户偏好（刷新后回到 deep）。
