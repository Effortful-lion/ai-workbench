import { sqliteTable, text, integer, unique } from "drizzle-orm/sqlite-core";
import type { HttpToolSpec } from "@aiwb/shared";

/** 一期核心表（总体设计 §7），随模块开发逐步补全 */
export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  username: text("username").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  role: text("role", { enum: ["owner", "member", "guest"] }).notNull().default("guest"),
  profileJson: text("profile_json", { mode: "json" }).$type<Record<string, unknown>>(),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  refreshToken: text("refresh_token").notNull().unique(),
  expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
});

export const conversations = sqliteTable("conversations", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  title: text("title").notNull().default("新会话"),
  agentId: text("agent_id"),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const messages = sqliteTable("messages", {
  id: text("id").primaryKey(),
  conversationId: text("conversation_id")
    .notNull()
    .references(() => conversations.id, { onDelete: "cascade" }),
  role: text("role", { enum: ["user", "assistant", "tool"] }).notNull(),
  content: text("content").notNull(),
  /** 原生 function calling 扩展字段：assistant 消息带 tool_calls；tool 消息带 tool_call_id */
  meta: text("meta", { mode: "json" }).$type<{
    toolCalls?: { id: string; name: string; arguments: string }[];
    toolCallId?: string;
  } | null>(),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const agents = sqliteTable("agents", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  personaPrompt: text("persona_prompt").notNull().default(""),
  /** 勾选的工具名子集：string[]（Tool Registry name 列表） */
  toolsJson: text("tools_json", { mode: "json" }).$type<string[]>().notNull().default([]),
  /** 阶段化流程（可选）：按阶段切换模型/目标 */
  phasesJson: text("phases_json", { mode: "json" }).$type<unknown[]>().default([]),
  /** 运行预算（可选）：超预算自动停止 */
  budgetJson: text("budget_json", { mode: "json" }).$type<Record<string, unknown>>(),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

/** Agent 执行迹线：一次运行一条，events 以 JSON 整体落库（避免事件表行数爆炸） */
export const agentExecutions = sqliteTable("agent_executions", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  agentId: text("agent_id").references(() => agents.id, { onDelete: "set null" }),
  conversationId: text("conversation_id").references(() => conversations.id, { onDelete: "set null" }),
  modelId: text("model_id"),
  modelName: text("model_name").notNull().default(""),
  phaseName: text("phase_name").notNull().default(""),
  eventsJson: text("events_json", { mode: "json" }).$type<unknown[]>().notNull().default([]),
  status: text("status", { enum: ["running", "done", "failed", "budget"] }).notNull().default("running"),
  durationMs: integer("duration_ms").notNull().default(0),
  tokensUsed: integer("tokens_used").notNull().default(0),
  costYuan: integer("cost_yuan").notNull().default(0),
  error: text("error"),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const kbDocuments = sqliteTable("kb_documents", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  /** 终端文件树风格的虚拟路径 ~/kb/<title> */
  path: text("path").notNull(),
  mime: text("mime").notNull().default("text/plain"),
  size: integer("size").notNull().default(0),
  status: text("status", { enum: ["embedded", "pending", "error"] })
    .notNull()
    .default("pending"),
  chunkCount: integer("chunk_count").notNull().default(0),
  error: text("error"),
  /** 主归属目录 id（原始上传路径），可空=未归类；额外挂载不覆盖它 */
  primaryFolderId: text("primary_folder_id"),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

/** kb 目录树：纯视图容器（面向人），不持有文档本体、不向量化、不参与检索 */
export const kbFolders = sqliteTable("kb_folders", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  /** 父目录 id，null=根；不使用外键，环检测在 service 层做（移动时拒绝进自身子树） */
  parentId: text("parent_id"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

/** kb 软链接：文档 ↔ 目录多对多挂载，仅引用关系——不复制文档、不重复切片、不重复入向量 */
export const kbLinks = sqliteTable(
  "kb_links",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    documentId: text("document_id")
      .notNull()
      .references(() => kbDocuments.id, { onDelete: "cascade" }),
    folderId: text("folder_id")
      .notNull()
      .references(() => kbFolders.id, { onDelete: "cascade" }),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [unique("kb_links_doc_folder_uq").on(t.documentId, t.folderId)],
);

/** 博客文章：展示层副本——内容生产在 KB（kbDocId 回链），博客只管 slug/摘要/分类/状态 */
export const blogPosts = sqliteTable("blog_posts", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  /** 公开页 URL 段 /b/:username/:slug，8 位短码 */
  slug: text("slug").notNull().unique(),
  title: text("title").notNull(),
  summary: text("summary").notNull().default(""),
  contentMd: text("content_md").notNull(),
  category: text("category", { enum: ["kb", "agent", "pipe", "essay"] })
    .notNull()
    .default("essay"),
  tagsJson: text("tags_json", { mode: "json" }).$type<string[]>().notNull().default([]),
  status: text("status", { enum: ["draft", "published", "archived"] })
    .notNull()
    .default("draft"),
  kbDocId: text("kb_doc_id"),
  publishedAt: integer("published_at", { mode: "timestamp" }),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

/** 博客评论：树形（root_id + parent_id + 深度压平），写时冗余被回复人；审核状态机在 status */
export const blogComments = sqliteTable("blog_comments", {
  id: text("id").primaryKey(),
  postId: text("post_id")
    .notNull()
    .references(() => blogPosts.id, { onDelete: "cascade" }),
  userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
  nickname: text("nickname").notNull(),
  content: text("content").notNull(),
  /** 顶级评论 = 自身 id；回复 = 所属根评论 id */
  rootId: text("root_id").notNull().default(""),
  /** 空串 = 顶级；回复指向根评论（超过 2 级一律压平） */
  parentId: text("parent_id").notNull().default(""),
  /** 冗余：被回复人 id / 昵称，渲染时不再联表 */
  replyToUserId: text("reply_to_user_id"),
  replyToUsername: text("reply_to_username"),
  /** 0 = 顶级，1 = 回复 */
  depth: integer("depth").notNull().default(0),
  status: text("status", { enum: ["pending", "approved", "rejected", "hidden"] })
    .notNull()
    .default("approved"),
  /** 审核备注（拒绝原因 / 人工标记） */
  reviewNote: text("review_note"),
  reviewedAt: integer("reviewed_at", { mode: "timestamp" }),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const toolboxItems = sqliteTable("toolbox_items", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  /** 载体类型：link = 外链，file = 上传文件 */
  kind: text("kind", { enum: ["link", "file"] }).notNull().default("link"),
  /** 别名，缺省由 URL 主机名 / 文件名推导 */
  name: text("name").notNull(),
  /** link 用外链；file 用站内下载路径 */
  url: text("url").notNull(),
  /** 文件类工具的原文件名 */
  fileName: text("file_name"),
  /** 文件类工具的字节数 */
  fileSize: integer("file_size").notNull().default(0),
  /** 文件类工具的 MIME */
  mimeType: text("mime_type"),
  /** 相对 data/toolbox 的存储路径，如 <id>/<file> */
  storagePath: text("storage_path"),
  category: text("category").notNull().default("misc"),
  desc: text("desc").notNull().default(""),
  useCount: integer("use_count").notNull().default(0),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  /** 项目名，同时作为文档树目录名，如 ai-workbench */
  name: text("name").notNull(),
  title: text("title").notNull().default(""),
  status: text("status", { enum: ["active", "paused", "done"] }).notNull().default("active"),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const projectDocs = sqliteTable("project_docs", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  /** 文件名，如 需求准备.md */
  title: text("title").notNull(),
  content: text("content").notNull().default(""),
  size: integer("size").notNull().default(0),
  /** 版本号，内容/标题每次变更 +1，为后期 git 语义预留 */
  version: integer("version").notNull().default(1),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const codeRepos = sqliteTable("code_repos", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  /** 主语言标签，如 typescript / go / shell */
  language: text("language").notNull().default("text"),
  /** 当前分支，一期仅展示 */
  branch: text("branch").notNull().default("main"),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const codeFiles = sqliteTable("code_files", {
  id: text("id").primaryKey(),
  repoId: text("repo_id")
    .notNull()
    .references(() => codeRepos.id, { onDelete: "cascade" }),
  /** 相对路径，如 src/index.ts */
  path: text("path").notNull(),
  content: text("content").notNull().default(""),
  size: integer("size").notNull().default(0),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const scheduleTasks = sqliteTable("schedule_tasks", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  notes: text("notes").notNull().default(""),
  /** 地点 / 会议链接 */
  location: text("location").notNull().default(""),
  startsAt: integer("starts_at", { mode: "timestamp" }).notNull(),
  durationMin: integer("duration_min").notNull().default(60),
  /** 提醒时间；null 表示不提醒 */
  remindAt: integer("remind_at", { mode: "timestamp" }),
  priority: text("priority", { enum: ["low", "normal", "high"] }).notNull().default("normal"),
  status: text("status", { enum: ["pending", "done", "canceled"] }).notNull().default("pending"),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const mailAccounts = sqliteTable("mail_accounts", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  /** 账户显示名，如「工作邮箱」 */
  name: text("name").notNull(),
  address: text("address").notNull(),
  /** 来源类型：qq / 163 / gmail / outlook / custom */
  provider: text("provider").notNull().default("custom"),
  /** 授权码 / 应用专用密码（AES-GCM 加密存储） */
  passwordEnc: text("password_enc"),
  imapHost: text("imap_host").notNull().default(""),
  imapPort: integer("imap_port").notNull().default(993),
  imapSecure: integer("imap_secure", { mode: "boolean" }).notNull().default(true),
  smtpHost: text("smtp_host").notNull().default(""),
  smtpPort: integer("smtp_port").notNull().default(465),
  smtpSecure: integer("smtp_secure", { mode: "boolean" }).notNull().default(true),
  /** 连接状态：ok / error / untested */
  status: text("status", { enum: ["ok", "error", "untested"] }).notNull().default("untested"),
  lastError: text("last_error"),
  lastSyncedAt: integer("last_synced_at", { mode: "timestamp" }),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const mailMessages = sqliteTable("mail_messages", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  accountId: text("account_id")
    .notNull()
    .references(() => mailAccounts.id, { onDelete: "cascade" }),
  folder: text("folder", { enum: ["inbox", "sent", "drafts", "trash"] })
    .notNull()
    .default("inbox"),
  direction: text("direction", { enum: ["inbound", "outbound"] }).notNull().default("inbound"),
  fromName: text("from_name").notNull().default(""),
  fromAddress: text("from_address").notNull().default(""),
  toAddress: text("to_address").notNull().default(""),
  subject: text("subject").notNull().default(""),
  body: text("body").notNull().default(""),
  /** 原始 HTML 正文（IMAP 解析所得，纯文本邮件为 null） */
  bodyHtml: text("body_html"),
  /** 附件元信息：{ index, filename, contentType, size, inline, path }，内容落盘 */
  attachmentsJson: text("attachments_json", { mode: "json" })
    .$type<
      {
        index: number;
        filename: string;
        contentType: string;
        size: number;
        inline: boolean;
        path: string | null;
      }[]
    >()
    .default([]),
  /** 稳定外部标识，演示同步与真实 message id 复用 */
  externalId: text("external_id"),
  receivedAt: integer("received_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
  isRead: integer("is_read", { mode: "boolean" }).notNull().default(false),
  isStarred: integer("is_starred", { mode: "boolean" }).notNull().default(false),
  category: text("category", { enum: ["important", "subscription", "spam", "normal"] })
    .notNull()
    .default("normal"),
  aiReason: text("ai_reason").notNull().default(""),
  classifiedAt: integer("classified_at", { mode: "timestamp" }),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const notifications = sqliteTable("notifications", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  type: text("type", { enum: ["system", "schedule", "mail", "blog"] }).notNull().default("system"),
  title: text("title").notNull(),
  body: text("body").notNull().default(""),
  isRead: integer("is_read", { mode: "boolean" }).notNull().default(false),
  /** 关联业务 id（日程任务 / 邮件），用于跳转面板 */
  sourceId: text("source_id"),
  /** 扫描幂等键，如 schedule:<taskId>:<remindAt> / mail:<messageId> */
  dedupeKey: text("dedupe_key"),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const commercePlans = sqliteTable("commerce_plans", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  /** 可选关联项目；项目删除时一并清理 */
  projectId: text("project_id").references(() => projects.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  /** 价格（元），一期按整数记账 */
  price: integer("price").notNull().default(0),
  cycle: text("cycle", { enum: ["monthly", "yearly"] }).notNull().default("monthly"),
  status: text("status", { enum: ["active", "archived"] }).notNull().default("active"),
  /** 订阅人数，手动维护的运营数据 */
  subscribers: integer("subscribers").notNull().default(0),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const commerceOrders = sqliteTable("commerce_orders", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  projectId: text("project_id").references(() => projects.id, { onDelete: "cascade" }),
  /** 关联订阅方案；方案删除后流水保留 */
  planId: text("plan_id").references(() => commercePlans.id, { onDelete: "set null" }),
  customerName: text("customer_name").notNull(),
  item: text("item").notNull().default(""),
  /** 金额（元） */
  amount: integer("amount").notNull().default(0),
  channel: text("channel", { enum: ["alipay", "wechat", "manual", "other"] })
    .notNull()
    .default("manual"),
  status: text("status", { enum: ["pending", "paid", "refunded"] }).notNull().default("pending"),
  paidAt: integer("paid_at", { mode: "timestamp" }),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const commerceAds = sqliteTable("commerce_ads", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  projectId: text("project_id").references(() => projects.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  channel: text("channel", { enum: ["web", "social", "search", "other"] })
    .notNull()
    .default("web"),
  /** 预算 / 消耗（元） */
  budget: integer("budget").notNull().default(0),
  spend: integer("spend").notNull().default(0),
  status: text("status", { enum: ["planned", "active", "paused", "ended"] })
    .notNull()
    .default("planned"),
  startedAt: integer("started_at", { mode: "timestamp" }),
  endedAt: integer("ended_at", { mode: "timestamp" }),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const crmCustomers = sqliteTable("crm_customers", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  /** 可选关联项目；项目删除时一并清理 */
  projectId: text("project_id").references(() => projects.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  company: text("company").notNull().default(""),
  /** 联系人方式：邮箱 / 微信 / 电话 */
  contact: text("contact").notNull().default(""),
  stage: text("stage", { enum: ["lead", "contacted", "proposal", "negotiation", "won", "lost"] })
    .notNull()
    .default("lead"),
  /** 预计成交金额（元 / 年） */
  value: integer("value").notNull().default(0),
  source: text("source").notNull().default(""),
  /** 线索评分 0–100 */
  score: integer("score").notNull().default(0),
  notes: text("notes").notNull().default(""),
  /** 最近一次跟进时间，由跟进记录推导 */
  lastContactAt: integer("last_contact_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const crmFollowUps = sqliteTable("crm_followups", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  customerId: text("customer_id")
    .notNull()
    .references(() => crmCustomers.id, { onDelete: "cascade" }),
  kind: text("kind", { enum: ["lead", "call", "meeting", "email", "quote", "note"] })
    .notNull()
    .default("note"),
  content: text("content").notNull().default(""),
  happenedAt: integer("happened_at", { mode: "timestamp" }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

/** 流水线 SOP：步骤以 JSON 落库，顺序即执行顺序 */
export const pipeSops = sqliteTable("pipe_sops", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  status: text("status", { enum: ["idle", "running", "paused"] }).notNull().default("idle"),
  /** 展示用周期文案，本期不接调度器 */
  schedule: text("schedule").notNull().default(""),
  /** 指定模型；为空时按状态挑选第一个可用模型 */
  modelId: text("model_id"),
  stepsJson: text("steps_json", { mode: "json" })
    .$type<{ id: string; name: string; instruction: string }[]>()
    .notNull()
    .default([]),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

/** 流水线运行：SOP 名快照 + 输入输出 + 步骤进度 */
export const pipeRuns = sqliteTable("pipe_runs", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  sopId: text("sop_id").references(() => pipeSops.id, { onDelete: "set null" }),
  sopName: text("sop_name").notNull().default(""),
  input: text("input").notNull().default(""),
  output: text("output").notNull().default(""),
  error: text("error"),
  status: text("status", { enum: ["running", "done", "failed"] }).notNull().default("running"),
  stepTotal: integer("step_total").notNull().default(0),
  stepDone: integer("step_done").notNull().default(0),
  /** 总耗时（毫秒） */
  durationMs: integer("duration_ms").notNull().default(0),
  startedAt: integer("started_at", { mode: "timestamp" }).notNull(),
  finishedAt: integer("finished_at", { mode: "timestamp" }),
});

/** 运行中的单步明细：输入拼装、模型产出、失败原因 */
export const pipeRunSteps = sqliteTable("pipe_run_steps", {
  id: text("id").primaryKey(),
  runId: text("run_id")
    .notNull()
    .references(() => pipeRuns.id, { onDelete: "cascade" }),
  stepIndex: integer("step_index").notNull().default(0),
  name: text("name").notNull().default(""),
  status: text("status", { enum: ["pending", "running", "done", "failed", "skipped"] }).notNull().default("done"),
  input: text("input").notNull().default(""),
  output: text("output").notNull().default(""),
  error: text("error"),
  durationMs: integer("duration_ms").notNull().default(0),
});

export const models = sqliteTable("models", {
  id: text("id").primaryKey(),
  provider: text("provider").notNull(),
  modelName: text("model_name").notNull(),
  endpoint: text("endpoint").notNull(),
  /** 模型类型：chat = 对话，embedding = 向量 */
  kind: text("kind", { enum: ["chat", "embedding"] }).notNull().default("chat"),
  apiKeyEnc: text("api_key_enc"),
  status: text("status", { enum: ["ok", "error", "untested"] }).notNull().default("untested"),
  /** 默认模型：聊天未指定 modelId 时优先选用（全局唯一，由 setDefault 保证） */
  isDefault: integer("is_default", { mode: "boolean" }).notNull().default(false),
  /** 输入价格（元 / 1k tokens），0 = 未知/不计费 */
  priceIn: integer("price_in").notNull().default(0),
  /** 输出价格（元 / 1k tokens），0 = 未知/不计费 */
  priceOut: integer("price_out").notNull().default(0),
  metaJson: text("meta_json", { mode: "json" }).$type<Record<string, unknown>>(),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

/**
 * 访问统计：每条记录 = 一个 session 内的一次 page_view
 * 口径：
 *   - PV = COUNT(*)：每次前端路由切换（mode 变化 / panel 切换）算 1 次
 *   - UV = COUNT(DISTINCT sessionId)：同一浏览器 session 算 1 次
 *   - 会话时长 = MAX(endAt) - MIN(startAt) per sessionId
 *   - 热门页面 = GROUP BY path ORDER BY COUNT(*) DESC LIMIT 10
 *   - 7 日趋势 = GROUP BY date(createdAt) 聚合
 */
export const visits = sqliteTable("visits", {
  id: text("id").primaryKey(),
  /** 匿名访客也有 session（localStorage 生成，浏览器关闭后仍留存直到清理） */
  sessionId: text("session_id").notNull(),
  userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
  /** 当前页面：/ /models /agents /chat /kb ... */
  path: text("path").notNull(),
  /** 来源：直接输入 / 内部跳转 / 外部 URL（一期仅存） */
  refUrl: text("ref_url"),
  ua: text("ua").notNull().default(""),
  /** 本页停留时长（毫秒），前端在离开时上报 */
  durationMs: integer("duration_ms").notNull().default(0),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

/** 自定义工具：AI 自写 / 面板手工创建的声明式 HTTP 工具。
 *  enabled=false 默认停用，人工启用后才注册进 ToolRegistry（human-in-the-loop） */
export const customTools = sqliteTable("custom_tools", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  /** 强制 custom. 前缀，全局唯一（注册名） */
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  /** 工具类型：http 已实现；shell/database/mcp 为预留（数据模型先行，执行器后续迭代） */
  kind: text("kind", { enum: ["http", "shell", "database", "mcp"] }).notNull().default("http"),
  specJson: text("spec_json", { mode: "json" }).$type<HttpToolSpec>().notNull(),
  argsSchemaJson: text("args_schema_json", { mode: "json" }).$type<Record<string, unknown>>(),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(false),
  createdBy: text("created_by", { enum: ["ai", "user"] }).notNull().default("user"),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

/** GitHub 账号（每人一条）。PAT 用 AES-GCM 加密存储，与 mail_accounts.password_enc 同一套。
 *  只读：PAT 只勾 Contents/Metadata/PR/Issues/Actions/Notifications 的 Read 权限。 */
export const githubAccounts = sqliteTable("github_accounts", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  /** GitHub 用户名，首次 profile 拉取后回填 */
  username: text("username").notNull().default(""),
  /** fine-grained PAT（AES-GCM 加密），展示时只回 ghp_••••xxxx */
  tokenEnc: text("token_enc"),
  /** 连接状态：ok / error / untested */
  status: text("status", { enum: ["ok", "error", "untested"] }).notNull().default("untested"),
  lastError: text("last_error"),
  updatedAt: integer("updated_at", { mode: "timestamp" }),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

/** GitHub 只读快照。所有面板/AI 取数都先落这里，UI 只读快照。
 *  kind: profile | repos | repo | readme | commits | languages | contributions | inbox | notifications | runs | search_repos
 *  key: 如 Effortful-lion/ai-workbench，聚合类为空串 */
export const githubSnapshots = sqliteTable("github_snapshots", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  key: text("key").notNull().default(""),
  /** 原始 JSON（压缩后存） */
  payload: text("payload").notNull(),
  /** ETag，条件请求用 */
  etag: text("etag"),
  fetchedAt: integer("fetched_at", { mode: "timestamp" }).notNull(),
  expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
});
