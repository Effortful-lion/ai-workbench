# AI-WORKBENCH

个人 AI 工作台：一个**终端极客风**的自托管 Web 应用，把对话、知识库、多模型管理、AI 助手、流水线与日常事务模块整合进同一个工作面。所有能力以「模型 + 工具 + 权限」三要素组织，AI 与人共用同一套界面与接口。

## 核心特性

- **对话通道**：WebSocket 流式对话，原生 function-calling 工具循环（防死循环、调用缓存、预算熔断），多模型按轮切换
- **模型管理**：接入多家 LLM provider，健康探测（ok/untested/error 状态灯）、全局默认模型、按任务/阶段指定模型
- **AI 助手（Agents）**：人设提示词 + 工具子集 + 运行预算（token/费用/超时）+ 阶段化流程（每个 phase 可换模型与工具集），运行迹线可追溯
- **知识库（KB）**：文档扁平存储 + **软链接树形视图**（逻辑目录与物理存储解耦，文档可多目录挂载）；双模式检索（向量直取 quick / 图谱推理 deep，LightRAG）；目录范围问答；Agent 可用 `kb.search` 工具检索
- **流水线工厂（pipe）**：SOP 步骤编排，步骤间上下文传递、断点重试、后台异步执行，可被 AI 按名调起
- **事务模块**：邮件、站内信、日程、项目、代码管理、客户管理、简历/百宝箱公开页等
- **终端体验**：⌘K 命令面板、CLI 沉浸模式、斜杠命令、明暗双主题、响应式（移动端/平板适配）

## 架构

pnpm monorepo，TypeScript 全栈：

```
apps/
  server/   NestJS + SQLite(drizzle-orm) + Qdrant(向量) + MinIO(对象存储) + LightRAG(图谱RAG)
  web/      React 19 + Vite + Tailwind CSS（终端风 UI 体系）
  cli/      命令行客户端
packages/
  shared/   前后端共享类型与协议（REST 操作目录、DTO、权限模型）
services/
  lightrag/ 图谱 RAG 服务（docker）
  minio/    对象存储（docker，Web 控制台 :9701）
```

**设计思路**：

1. **权限即边界**——角色（owner/admin/member/guest）→ 权限点 → 工具可见性 → Agent 工具子集，层层收敛，服务端双保险校验
2. **一切皆面板**——功能模块统一为 PanelZone 内的面板，CLI/命令面板/快捷入口只是同一能力的不同入口
3. **ID 寻址、路径仅展示**——逻辑目录、文档、模型全部以唯一 ID 寻址，路径字符串只作人类可读展示，检索与工具链路不依赖路径
4. **AI 与人同权**——AI 通过工具调用的 API 与前端 REST API 同源，operations 目录即协议文档

## 快速开始

依赖：Node >= 20、pnpm、Docker（Qdrant/LightRAG/MinIO）。

```bash
make init        # 一键初始化：安装依赖 + 构建 + 建表（drizzle-kit push）
make dev         # 开发模式：server(watch) + web(HMR) 同时启动
make start       # 生产模式：构建并后台启动 server
make status      # 查看运行状态
make stop        # 停止后台进程
make restart     # 重启
make db-reset    # ⚠ 删除 workbench.db，清空全部数据
```

外部服务按需启动：`services/lightrag`、`services/minio`、Qdrant 容器（`kb_chunks_d256` 集合）。

## 文档

- `docs/devlog/`——按模块/里程碑的开发日志（含每期决策与遗留项）
- `docs/superpowers/specs/`——设计文档与调研存档（KB 树形视图、Agent Team 调研等）
- `docs/prototype/`——交互原型页
- `AGENTS.md`——面向 AI 代理的项目协作说明
- `TODO.md`——待办

## 期望 / 路线

- KB：存量向量回填、目录范围问答深化、导入导出 zip（冲突重命名兜底）
- 多智能体：调研结论见 `docs/superpowers/specs/2026-11-08-agent-team-research.md`——方向为 `agent.spawn`（agents-as-tools）+ phase 条件路由，触发条件与难度评估已存档，暂缓实现
- 调度：SOP 定时触发接入 cron
