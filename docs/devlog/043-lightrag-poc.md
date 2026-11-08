# 043 · LightRAG 知识图谱 RAG PoC

- 日期：2026-11-04
- 状态：✅ 完成（insert/query 五种检索模式全 PASS）

## 目标

验证 LightRAG 作为「可复用图谱 RAG 底座」的可行性，为 ai-workbench（TS）与后续 siftops（Go）
共用同一 RAG 服务探路。验收标准：

- 服务独立部署、配置全靠 env，二开边界清晰，目录可整体迁移。
- 云端 LLM + 本地 embedding 跑通中文文档的入库（图谱抽取）与检索问答。
- 多项目隔离机制（workspace）确认可用。

## 决策

1. **用官方 Docker 镜像零代码集成，不 fork、不写自研壳**：官方 server 已提供完整 REST API
   与 WebUI，env 注入即可换 LLM/embedding/存储后端，官方升级零成本。服务落在独立目录
   `services/lightrag/`，与主仓代码零耦合。
2. **LLM=deepseek-flash（云端），embedding=ollama bge-m3（本地）**：DB 里火山 key 已欠费、
   DeepSeek 无 embedding 接口；本地 bge-m3 零成本且中文效果好。embedding 后续要换云端
   （百炼/SiliconFlow/火山）只需改 4 行 env 并重建索引。
3. **workspace 做项目级隔离**：`WORKSPACE=aiwb`，数据落在 `rag_storage/aiwb/` 子目录；
   对应 siftops 侧规划中的 `system_id` 隔离，一项目一 workspace。
4. **开启 `LIGHTRAG_API_KEY` 鉴权**：服务绑定 0.0.0.0（容器内），调用方必须带
   `X-API-Key` header，符合官方安全基线。
5. **Ollama 并发与保活调优**：`OLLAMA_NUM_PARALLEL=8` + `OLLAMA_KEEP_ALIVE=24h` +
   `EMBEDDING_TIMEOUT=120` + `EMBEDDING_FUNC_MAX_ASYNC=4`。不加这组参数时，默认
   num_parallel=1 导致并发 embedding 排队，撞上 LightRAG 60s worker 超时，向量 flush
   静默失败——表现为图谱文件在但实体/关系 VDB 为空，仅 naive 模式可检索。

## 实现

- [docker-compose.yml](file:///Users/lion/workspace/gocode/ai-workbench/services/lightrag/docker-compose.yml)
  lightrag（ghcr.io/hkuds/lightrag:latest，端口 9621）+ ollama（仅容器网络内可达）。
- [.env.example](file:///Users/lion/workspace/gocode/ai-workbench/services/lightrag/.env.example)
  配置模板；真实 `.env` 由脚本从模型管理 DB 解密 deepseek key 生成，不入库
  （.gitignore 已加 `services/lightrag/.env` 与 `services/lightrag/data/`）。
- 数据卷：`./data/rag_storage`（JsonKV + NanoVectorDB + NetworkX 文件存储）。

## 验证

- `GET /health` → `status:healthy`，core 1.5.7，workspace=aiwb 生效。
- 入库一篇中文 SRE 故障手册（POST /documents/text，`file_source` 必填，v1.5 行为）：
  抽取 **26 实体 / 37 关系 / 1 chunk**，三个 VDB 全部落盘且带向量。
- `POST /query`「payment-gateway 大量 502 的根因和处置」：
  hybrid / mix / local / global / naive **五种模式全部命中**，答案均正确给出
  「clearing-svc 慢查询 → 连接池耗尽」根因链与处置步骤。
- 过程中排掉两个坑：v1.5 `/documents/text` 必须传 `file_source`；embedding 并发超时
  导致首次入库向量静默缺失（上文决策 5）。

## 遗留

- embedding 换云端后的重建索引流程未验证；rerank 模型未配置（日志有 WARNING 提示）。
- ai-workbench 主仓对接（kb 模块检索层切换 / LightRAG client）未做，下一步。
- siftops 侧 Go client 封装未开始，待 ai-workbench 验证充分后推进。
- 官方 lite 镜像更小（无文档解析模型），当前用 latest 全量镜像，PoC 后可评估换 lite。
