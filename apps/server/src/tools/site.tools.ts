import { Injectable } from "@nestjs/common";
import { findOperation, OPERATIONS, operationsOfModule, type ToolContext, type ToolSchemaDto } from "@aiwb/shared";
import { RegisterTool } from "./register-tool.decorator";
import { ToolRegistry } from "./tool-registry.service";

/** 模块导航元信息：解释「这是什么、入口在哪」，与操作目录（工具清单）互补。
 *  新增业务模块时在这里加一行，AI 的能力地图与 site.capabilities 自动同步。 */
interface ModuleMeta {
  title: string;
  /** 前端面板 id（PanelZone / 斜杠命令），null = 没有独立面板 */
  panel: string | null;
  /** 人话入口：斜杠命令 / 顶栏图标 / 主区域 */
  entry: string;
  summary: string;
}

const MODULE_META: Record<string, ModuleMeta> = {
  site: {
    title: "站点总览",
    panel: null,
    entry: "直接问我就好，无需打开面板",
    summary: "查询全部模块、入口与可执行工具",
  },
  web: {
    title: "联网检索",
    panel: null,
    entry: "由 AI 直接调用，无需打开面板",
    summary: "Bing 搜索与网页正文抓取",
  },
  search: {
    title: "跨域检索",
    panel: null,
    entry: "由 AI 直接调用，无需打开面板",
    summary: "同时搜索网页、GitHub 与本地知识库并去重",
  },
  chat: {
    title: "对话",
    panel: null,
    entry: "主聊天区（左侧会话列表）",
    summary: "会话列表、消息历史与删除",
  },
  kb: {
    title: "AI 知识库",
    panel: "kb",
    entry: "/kb（先上传文档，右侧问答页提问）",
    summary: "文档上传与异步摄入、检索问答（quick/deep）、引用来源",
  },
  blog: {
    title: "博客",
    panel: "blog",
    entry: "/blog（面板内文章列表；公开阅读页 /b/:username/:slug）",
    summary: "已发布文章的列表与全文检索、文章编辑与评论审核；访客可在公开页评论",
  },
  mail: {
    title: "邮件管理",
    panel: "mail",
    entry: "顶栏信封图标 或 /mail",
    summary: "多邮箱 IMAP 聚合收发、AI 分类、写信/回复、附件下载、账户配置",
  },
  notify: {
    title: "站内信",
    panel: "notify",
    entry: "顶栏铃铛 或 /notify",
    summary: "站内信收发、已读与未读摘要",
  },
  models: {
    title: "模型管理",
    panel: "models",
    entry: "/models",
    summary: "接入 OpenAI 兼容模型、连接测试、设为默认",
  },
  agents: {
    title: "AI 助手",
    panel: "agents",
    entry: "/agents",
    summary: "Agent 人设、工具子集、预算与多阶段编排，可绑定到新对话",
  },
  tools: {
    title: "自定义工具",
    panel: "aitools",
    entry: "/aitools",
    summary: "自定义 HTTP 工具的创建、启停、测试与删除",
  },
  projects: {
    title: "项目管理",
    panel: "projects",
    entry: "/projects",
    summary: "项目、项目文档的组织管理",
  },
  code: {
    title: "代码管理",
    panel: "code",
    entry: "/code",
    summary: "代码仓库、代码文件与内容维护",
  },
  resume: {
    title: "个人简历",
    panel: "resume",
    entry: "/me 或 /resume",
    summary: "简历维护、解析与对外展示",
  },
  profile: {
    title: "如何联系我",
    panel: null,
    entry: "顶栏名片图标 或 /c/:username 公开页",
    summary: "公开联系信息页、首选渠道、响应时间与渠道可见性",
  },
  toolbox: {
    title: "百宝箱",
    panel: "tools",
    entry: "/tools",
    summary: "链接与文件类小工具的收藏、上传、调用与下载",
  },
  schedule: {
    title: "日程管理",
    panel: "cal",
    entry: "/cal 或 /schedule",
    summary: "日程任务的增删改查与未来 N 天安排",
  },
  commerce: {
    title: "商业化管理",
    panel: "biz",
    entry: "/biz 或 /commerce",
    summary: "订阅方案、支付流水、退款、广告位与经营概览",
  },
  crm: {
    title: "客户管理",
    panel: "crm",
    entry: "/crm",
    summary: "客户档案、跟进时间线与流失/管道概览",
  },
  pipe: {
    title: "流水线工厂",
    panel: "pipe",
    entry: "/pipe",
    summary: "SOP 编排与运行记录（含失败重试）",
  },
  storage: {
    title: "对象存储",
    panel: null,
    entry: "由 AI 直接调用（MinIO，文件读写 / 预签名链接）",
    summary:
      "文件存取：小文本直接读写（≤256KB），大文件走预签名上传/下载链接；列对象、删除（限 ai-workbench/ 前缀）",
  },
  github: {
    title: "GitHub 观察窗",
    panel: "gh",
    entry: "/gh",
    summary:
      "只读观察窗：账号概览、我的仓库列表、最近推送；所有数据本地快照，限流下返回旧快照。所有可操作对象深链回 GitHub，不在工作台写操作。",
  },
  stats: {
    title: "访问统计",
    panel: "stats",
    entry: "/stats",
    summary: "PV / UV / 趋势 / 热门页面与埋点采集",
  },
  auth: {
    title: "账号与登录",
    panel: null,
    entry: "登录页 / 顶栏账户菜单",
    summary: "登录、注册、刷新令牌与当前用户信息",
  },
  health: {
    title: "系统健康",
    panel: null,
    entry: "无需入口（服务自检）",
    summary: "服务存活检查",
  },
  custom: {
    title: "自定义工具",
    panel: "aitools",
    entry: "/aitools",
    summary: "用户自建 HTTP 工具（custom.*）",
  },
};

interface CapabilityHighlight {
  name: string;
  summary: string;
}

export interface CapabilityModuleRow {
  id: string;
  title: string;
  /** 前端面板 id，null = 无独立面板 */
  panel: string | null;
  entry: string;
  summary: string;
  tools: number;
  /** 只读工具数 */
  read: number;
  /** 写入 / 破坏性工具数 */
  write: number;
  highlights: CapabilityHighlight[];
}

function moduleOf(toolName: string): string {
  const i = toolName.indexOf(".");
  return i === -1 ? toolName : toolName.slice(0, i);
}

/** 常用工具排序：列表/概览类更适合「看一眼能力」，其次详情，最后其它 */
function highlightRank(name: string): number {
  if (/\.(list|digest|overview|upcoming)$/.test(name)) return 0;
  if (/\.(get|ask|check|download)$/.test(name)) return 1;
  return 2;
}

function toolSummary(schema: ToolSchemaDto): string {
  const op = findOperation(schema.name);
  if (op) return op.summary;
  // 内置工具描述可能带括号补充，取第一段即可
  return schema.description.split(/[（(]/)[0].trim();
}

/** 按可见工具清单聚合成模块能力地图（角色权限过滤后的结果） */
export function buildCapabilityModules(schemas: ToolSchemaDto[]): CapabilityModuleRow[] {
  const grouped = new Map<string, ToolSchemaDto[]>();
  for (const s of schemas) {
    const id = moduleOf(s.name);
    const list = grouped.get(id);
    if (list) list.push(s);
    else grouped.set(id, [s]);
  }

  const order = [...Object.keys(MODULE_META), ...[...grouped.keys()].filter((k) => !(k in MODULE_META))];
  const rows: CapabilityModuleRow[] = [];
  for (const id of order) {
    const tools = grouped.get(id);
    if (!tools || tools.length === 0) continue;
    // 未登记元信息的模块（多半是新加的工具命名空间）至少给出可读的入口说明，
    // 避免能力地图里出现「—」让模型以为没有入口
    const meta = MODULE_META[id] ?? {
      title: id,
      panel: null,
      entry: "由 AI 直接调用，无需打开面板",
      summary: `（${id} 模块暂未登记说明）`,
    };
    let read = 0;
    let write = 0;
    for (const t of tools) {
      const risk = findOperation(t.name)?.risk ?? "read";
      if (risk === "read") read += 1;
      else write += 1;
    }
    const highlights = [...tools]
      .sort((a, b) => highlightRank(a.name) - highlightRank(b.name) || a.name.localeCompare(b.name))
      .slice(0, 3)
      .map((t) => ({ name: t.name, summary: toolSummary(t) }));
    rows.push({
      id,
      title: meta.title,
      panel: meta.panel,
      entry: meta.entry,
      summary: meta.summary,
      tools: tools.length,
      read,
      write,
      highlights,
    });
  }
  return rows;
}

/** 由操作目录生成的能力文档（每模块一篇 markdown），用于灌入知识库做语义检索。
 *  内容比 capabilityGuide 更详细：包含每个工具的方法/路径/参数，回答「怎么用」时可被检索到。 */
export function buildCapabilityDocs(): { id: string; title: string; content: string }[] {
  const docs: { id: string; title: string; content: string }[] = [];
  for (const id of Object.keys(MODULE_META)) {
    const meta = MODULE_META[id]!;
    const ops = operationsOfModule(id);
    if (ops.length === 0) continue;
    const lines: string[] = [
      `# ${meta.title}（${id}）`,
      "",
      `- 模块 ID：\`${id}\``,
      `- 入口：${meta.entry}`,
      `- 职责：${meta.summary}`,
      "",
      "## 可用工具",
      "",
    ];
    for (const op of ops) {
      const riskLabel = op.risk === "read" ? "只读" : op.risk === "destructive" ? "破坏性" : "写入";
      const params = (op.params ?? [])
        .filter((p) => p.name)
        .map((p) => `${p.name}${p.required ? "*" : ""}(${p.in}:${p.type})`)
        .join("、");
      lines.push(`### \`${op.key}\``);
      lines.push(`- 说明：${op.summary}`);
      lines.push(`- 方法：${op.method} ${op.path}（${riskLabel}，权限 ${op.permission ?? "无需"}）`);
      if (params) lines.push(`- 参数：${params}`);
      lines.push("");
    }
    docs.push({ id, title: `能力手册 · ${meta.title}`, content: lines.join("\n") });
  }
  return docs;
}

/** 全部模块的一行摘要（用于意图路由时给模型看的极简清单，避免路由调用也爆 token） */
export function moduleDigest(): string {
  const lines: string[] = [];
  for (const id of Object.keys(MODULE_META)) {
    const meta = MODULE_META[id]!;
    lines.push(`- ${id}｜${meta.title}｜${meta.summary}`);
  }
  return lines.join("\n");
}

/** 注入 system prompt 的「能力地图」：一行一个模块，让模型不用逐个工具试探 */
export function capabilityGuide(schemas: ToolSchemaDto[]): string {
  const rows = buildCapabilityModules(schemas);
  if (rows.length === 0) return "";
  const lines = rows.map((r) => {
    const entry = r.panel ? `${r.entry}（面板 ${r.panel}）` : r.entry;
    return `- ${r.title}｜${r.summary}｜入口：${entry}｜工具 ${r.tools} 个（只读 ${r.read} / 写入 ${r.write}）｜常用：${r.highlights.map((h) => h.name).join("、")}`;
  });
  return [
    "【站点能力地图】以下模块都已接入本工作台，可直接用工具操作：",
    ...lines,
    "",
    "回答开放性问题的规则：",
    "1. 「这个站点能做什么」先调用一次 site.capabilities 拿全量清单，再概括回答；严禁为了试探能力逐个模块调用 list/get。",
    "2. 「在哪开通 / 入口在哪 / 怎么操作」直接回答面板路径与斜杠命令（如 /mail、/kb），不需要调用任何写工具。",
    "3. 只有需要实时数据（未读数、文档列表、订单金额等）才调用对应模块的 list/get，一次取够；同一工具同一参数不要重复调用（重复会被自动短路）。",
  ].join("\n");
}

/** 站点能力总览工具：一次返回所有模块与入口，开放性问题不再逐工具探索 */
@Injectable()
export class SiteTools {
  constructor(private readonly registry: ToolRegistry) {}

  @RegisterTool({
    name: "site.capabilities",
    description:
      "站点能力总览：一次返回全部模块（职责、前端入口、工具数与常用工具）。回答「这个站点能做什么 / 在哪开通 / 入口在哪」等开放性问题时先调用它",
    permission: "tools:read",
    argsSchema: {
      type: "object",
      properties: {
        module: {
          type: "string",
          description: "可选：只看某个模块，如 mail / kb / models；不填返回全部",
        },
      },
      additionalProperties: false,
    },
  })
  async capabilities(ctx: ToolContext, args: Record<string, unknown>): Promise<unknown> {
    const schemas = this.registry.listForRole(ctx.role);
    const modules = buildCapabilityModules(schemas);
    const want = typeof args.module === "string" ? args.module.trim().toLowerCase() : "";
    if (!want) return { totalModules: modules.length, totalTools: schemas.length, modules };
    const picked = modules.filter((m) => m.id === want || m.title.includes(want));
    if (picked.length === 0) {
      throw new Error(`没有模块「${want}」，可选：${modules.map((m) => m.id).join(", ")}`);
    }
    return { totalModules: modules.length, totalTools: schemas.length, modules: picked };
  }
}
