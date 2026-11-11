import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { and, asc, desc, eq, inArray, isNotNull } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { ImapFlow } from "imapflow";
import { simpleParser, type Attachment } from "mailparser";
import * as nodemailer from "nodemailer";
import type {
  MailAccountDto,
  MailAccountInput,
  MailAccountTestResult,
  MailCategory,
  MailClassifyResult,
  MailDigestDto,
  MailFolder,
  MailMessageDto,
  MailMessageInput,
  MailMessagePatchInput,
  MailProviderPreset,
  MailSyncResult,
} from "@aiwb/shared";
import { MAIL_PROVIDER_PRESETS } from "@aiwb/shared";
import { DB, type Db } from "../db/db.module";
import { mailAccounts, mailMessages } from "../db/schema";
import { decrypt, encrypt } from "../common/crypto";

const MAX_NAME = 40;
const MAX_ADDRESS = 120;
const MAX_HOST = 160;
const MAX_SUBJECT = 200;
const MAX_BODY = 20_000;
const MAX_REASON = 200;
const MAX_QUERY = 80;
/** 单次同步最多处理的邮件数（先按时间窗筛 UID，再截断，避免一次拉爆） */
const SYNC_LIMIT = 300;
/** 首次同步回看天数 */
const SYNC_FALLBACK_DAYS = 30;
/** 增量同步往前重叠的窗口：抵消服务器 INTERNALDATE 与本机时钟/时区的偏差 */
const SYNC_OVERLAP_MS = 24 * 60 * 60 * 1000;
const NET_TIMEOUT_MS = 15_000;
/** HTML 正文入库上限（超出截断，避免 SQLite 行过大） */
const MAX_HTML = 300_000;
/** 单个附件落盘上限，超出只存元信息 */
const MAX_ATTACH_BYTES = 25 * 1024 * 1024;
const ATTACH_ROOT = resolve(__dirname, "../../../..", "data", "mail-attachments");

/** 附件落盘后的元信息（DTO 不下发 path，下载按 index 反查） */
type StoredAttachment = {
  index: number;
  filename: string;
  contentType: string;
  size: number;
  inline: boolean;
  path: string | null;
};

function safeAttachmentName(raw: string, index: number): string {
  const base = raw
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "_")
    .trim()
    .slice(0, 120);
  return base || `attachment-${index + 1}`;
}

/** 附件二进制写入 data/mail-attachments/<messageId>/，返回可入库的元信息 */
async function persistMessageAttachments(
  messageId: string,
  attachments: Attachment[],
): Promise<StoredAttachment[]> {
  if (!attachments.length) return [];
  const dir = resolve(ATTACH_ROOT, messageId);
  const out: StoredAttachment[] = [];
  for (let i = 0; i < attachments.length; i++) {
    const a = attachments[i]!;
    const inline = Boolean(a.cid) || Boolean(a.related);
    const filename = (a.filename ?? "").trim() || `attachment-${i + 1}`;
    const size = Number(a.size ?? a.content?.length ?? 0);
    let path: string | null = null;
    if (a.content && a.content.length <= MAX_ATTACH_BYTES) {
      await mkdir(dir, { recursive: true });
      const file = `${i}-${safeAttachmentName(filename, i)}`;
      await writeFile(resolve(dir, file), a.content);
      path = `${messageId}/${file}`;
    }
    out.push({
      index: i,
      filename,
      contentType: a.contentType || "application/octet-stream",
      size,
      inline,
      path,
    });
  }
  return out;
}

const EMAIL_RE = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

/** 关键词权重：标题 2 分、正文 1 分；分数最高者胜，平分时重要 > 垃圾 > 订阅 */
const IMPORTANT_HINTS = [
  "到期", "续费", "账单", "发票", "报价", "合同", "评审", "review",
  "告警", "异常", "紧急", "会议邀请", "付款", "逾期", "权限", "部署失败",
  "incident", "invoice", "payment", "deadline", "approval", "故障", "宕机", "证书",
];
/** 「重要」的强信号：命中任一即判重要（与 IMPORTANT_HINTS 的弱信号分开，避免订阅邮件正文出现 security 被误判） */
const IMPORTANT_STRONG_HINTS = [
  "cve-", "dependabot", "vulnerability", "vulnerabilities", "安全漏洞",
  "high severity", "critical severity", "action required", "立即处理",
];
const SUBSCRIPTION_HINTS = [
  "订阅", "周刊", "周报", "日报", "digest", "newsletter", "unsubscribe", "退订",
  "weekly", "产品更新", "更新日志", "热门", "推广", "促销",
];
/** 已知订阅源发件域：命中直接判订阅，不再走关键词打分（避免推广周报正文带 security/安全 被误判） */
const SUBSCRIPTION_DOMAINS = [
  "freecodecamp.org", "ngrok.com", "substack.com", "medium.com",
  "mailchimpapp.com", "sendgrid.net", "mailgun.org", "campaign-archive.com",
];
const SPAM_HINTS = [
  "中奖", "抽奖", "恭喜您", "免费领取", "点击领取", "限时", "先到先得", "钓鱼",
  "解冻", "验证您的账户", "winner", "lottery", "claim", "bit.ly",
];

function text(v: unknown, max: number): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

function bodyText(v: unknown): string {
  return typeof v === "string" ? v.replace(/\r\n/g, "\n").slice(0, MAX_BODY) : "";
}

function snippetOf(body: string): string {
  return body.replace(/\s+/g, " ").trim().slice(0, 80);
}

function normalizeFolder(v: unknown, fallback: MailFolder = "inbox"): MailFolder {
  if (v === undefined || v === null || v === "") return fallback;
  const s = String(v).trim().toLowerCase();
  const map: Record<string, MailFolder> = {
    inbox: "inbox",
    sent: "sent",
    drafts: "drafts",
    draft: "drafts",
    trash: "trash",
    "收件箱": "inbox",
    "已发送": "sent",
    "草稿": "drafts",
    "垃圾箱": "trash",
  };
  const folder = map[s];
  if (!folder) throw new BadRequestException("folder 仅支持 inbox / sent / drafts / trash");
  return folder;
}

function normalizeCategory(v: unknown, fallback: MailCategory = "normal"): MailCategory {
  if (v === undefined || v === null || v === "") return fallback;
  const s = String(v).trim().toLowerCase();
  const map: Record<string, MailCategory> = {
    important: "important",
    subscription: "subscription",
    spam: "spam",
    normal: "normal",
    "重要": "important",
    "订阅": "subscription",
    "垃圾": "spam",
    "普通": "normal",
  };
  const c = map[s];
  if (!c) throw new BadRequestException("category 仅支持 important / subscription / spam / normal");
  return c;
}

function normalizeAddress(v: unknown): string {
  const s = text(v, MAX_ADDRESS);
  if (!s) throw new BadRequestException("邮箱地址不能为空");
  if (!EMAIL_RE.test(s)) throw new BadRequestException(`邮箱地址不合法：${s}`);
  return s.toLowerCase();
}

function normalizePort(v: unknown, fallback: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  const port = Math.trunc(n);
  if (port < 1 || port > 65535) throw new BadRequestException(`端口不合法：${port}`);
  return port;
}

function presetOf(provider: string): MailProviderPreset | undefined {
  return MAIL_PROVIDER_PRESETS.find((p) => p.value === provider);
}

/** IMAP / SMTP 原始错误转成可读描述：优先取服务端原文，再补中文提示 */
function describeMailError(e: unknown): string {
  const err = e as {
    message?: string;
    code?: string;
    response?: string;
    responseText?: string;
    responseStatus?: string;
    authenticationFailed?: boolean;
  } | null;
  const code = err?.code ?? "";
  const raw = (err?.responseText || err?.response || err?.message || String(e))
    .replace(/\s+/g, " ")
    .trim();
  const authFail =
    Boolean(err?.authenticationFailed) ||
    /EAUTH/i.test(code) ||
    /auth|credential|login|password|授权/i.test(raw);
  let hint = "";
  if (authFail) {
    hint = "认证失败：请填写邮箱的「授权码 / 应用专用密码」（不是登录密码），并确认已在邮箱设置中开启 IMAP/SMTP 服务";
  } else if (/ENOTFOUND|EAI_AGAIN/i.test(code)) {
    hint = "域名解析失败，请检查 IMAP / SMTP 服务器地址";
  } else if (/ECONNREFUSED/i.test(code)) {
    hint = "连接被拒绝，请检查端口与 SSL 开关";
  } else if (/ETIMEDOUT|timeout/i.test(`${code} ${raw}`)) {
    hint = "连接超时，请检查网络、端口与 SSL 开关";
  }
  return (hint ? `${hint} — 服务器返回：${raw}` : raw).slice(0, 300);
}

/** 规则式「AI」分类：可解释、可测试，真实 LLM 分类留到模型接入后替换。
 *  三层约束，按优先级从高到低：
 *  1. 已知订阅域（freeCodeCamp/ngrok 等）→ 直接订阅，避免正文出现 security 被误判；
 *  2. 强信号（CVE-XXXX / Dependabot / action required）→ 直接重要；
 *  3. 关键词打分：unsubscribe / 批量邮件特征会扣 important 分，避免推广周报误判。 */
function classifyContent(subject: string, body: string, fromName = "", fromAddress = ""): {
  category: MailCategory;
  reason: string;
} {
  const head = subject.toLowerCase();
  const full = `${subject}\n${body}\n${fromName}`.toLowerCase();
  const addr = fromAddress.toLowerCase();

  // 1. 已知订阅域短路：推广/周刊类邮件即使正文带 security 也判订阅
  if (addr && SUBSCRIPTION_DOMAINS.some((d) => addr.endsWith(`@${d}`) || addr.includes(`.${d}`))) {
    return { category: "subscription", reason: `来自订阅源 ${addr.split("@")[1] ?? addr}，可归档` };
  }

  // 2. 强信号短路：CVE / Dependabot / 明确行动号召 → 直接重要
  const strong = IMPORTANT_STRONG_HINTS.find((k) => full.includes(k));
  if (strong) {
    return { category: "important", reason: `命中强信号「${strong}」，建议今天处理` };
  }

  // 3. 关键词打分：unsubscribe / List-Unsubscribe 头（批量邮件特征）会削弱 important 得分
  const score = (hints: string[]) => {
    let n = 0;
    for (const k of hints) {
      if (head.includes(k)) n += 2;
      else if (full.includes(k)) n += 1;
    }
    return n;
  };
  const hit = (hints: string[]) => hints.filter((k) => full.includes(k));

  const hasUnsubscribe = full.includes("unsubscribe") || full.includes("退订");
  let important = score(IMPORTANT_HINTS);
  const subscription = score(SUBSCRIPTION_HINTS);
  const spam = score(SPAM_HINTS);

  // 批量邮件特征（unsubscribe）且没有强信号时，important 得分减半：
  // 避免 freeCodeCamp/ngrok 这类周报正文提到 security 就被判重要
  if (hasUnsubscribe && important > 0) important = Math.floor(important / 2);

  const pick = (hints: string[]) => hit(hints).slice(0, 2).join(" / ");

  let category: MailCategory = "normal";
  if (spam > 0 && spam >= important && spam >= subscription) category = "spam";
  else if (important > 0 && important >= subscription) category = "important";
  else if (subscription > 0) category = "subscription";

  const reason =
    category === "important"
      ? `命中「${pick(IMPORTANT_HINTS)}」，建议今天处理`
      : category === "subscription"
        ? "订阅 / 推广类内容，可归档，无需立即处理"
        : category === "spam"
          ? `含「${pick(SPAM_HINTS)}」等营销 / 钓鱼特征，建议删除`
          : "未命中重要 / 订阅 / 垃圾规则，归为普通邮件";

  return { category, reason: reason.slice(0, MAX_REASON) };
}

/** HTML 邮件降级为纯文本（无 mailparser text 时使用） */
function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

interface AccountConfig {
  provider: string;
  imapHost: string;
  imapPort: number;
  imapSecure: boolean;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
}

@Injectable()
export class MailService {
  private readonly log = new Logger("mail");
  /** 同一账号的同步互斥：定时任务与手动同步并发时，同一封邮件可能被插入两次 */
  private readonly syncing = new Set<string>();

  constructor(@Inject(DB) private readonly db: Db) {}

  private toDto(row: typeof mailMessages.$inferSelect, accountName: string): MailMessageDto {
    const atts = (row.attachmentsJson ?? []) as StoredAttachment[];
    return {
      id: row.id,
      accountId: row.accountId,
      accountName,
      folder: row.folder,
      direction: row.direction,
      fromName: row.fromName,
      fromAddress: row.fromAddress,
      toAddress: row.toAddress,
      subject: row.subject,
      body: row.body,
      // 空串是「已解析但无 HTML」的标记，对外统一为 null
      bodyHtml: row.bodyHtml || null,
      attachments: atts.map((a) => ({
        index: a.index,
        filename: a.filename,
        contentType: a.contentType,
        size: a.size,
        inline: a.inline,
        available: Boolean(a.path),
      })),
      snippet: snippetOf(row.body),
      receivedAt: row.receivedAt.getTime(),
      isRead: row.isRead,
      isStarred: row.isStarred,
      category: row.category,
      aiReason: row.aiReason,
      externalId: row.externalId,
      createdAt: row.createdAt.getTime(),
      updatedAt: row.updatedAt.getTime(),
    };
  }

  private toAccountDto(row: typeof mailAccounts.$inferSelect): MailAccountDto {
    return {
      id: row.id,
      name: row.name,
      address: row.address,
      provider: row.provider,
      imapHost: row.imapHost,
      imapPort: row.imapPort,
      imapSecure: row.imapSecure,
      smtpHost: row.smtpHost,
      smtpPort: row.smtpPort,
      smtpSecure: row.smtpSecure,
      hasPassword: Boolean(row.passwordEnc),
      status: row.status,
      lastError: row.lastError ?? undefined,
      lastSyncedAt: row.lastSyncedAt?.getTime() ?? undefined,
      messageCount: 0,
      unreadCount: 0,
      createdAt: row.createdAt.getTime(),
    };
  }

  /** 落地账户配置：缺省值取服务商预设，允许手改 */
  private resolveConfig(input: MailAccountInput): AccountConfig {
    const provider = text(input?.provider, 20).toLowerCase() || "custom";
    const preset = presetOf(provider);
    const imapHost = text(input?.imapHost, MAX_HOST) || preset?.imapHost || "";
    const smtpHost = text(input?.smtpHost, MAX_HOST) || preset?.smtpHost || "";
    if (!imapHost) throw new BadRequestException("请填写 IMAP 服务器地址");
    if (!smtpHost) throw new BadRequestException("请填写 SMTP 服务器地址");
    return {
      provider,
      imapHost,
      imapPort: normalizePort(input?.imapPort, preset?.imapPort ?? 993),
      imapSecure:
        input?.imapSecure === undefined ? (preset?.imapSecure ?? true) : Boolean(input.imapSecure),
      smtpHost,
      smtpPort: normalizePort(input?.smtpPort, preset?.smtpPort ?? 465),
      smtpSecure:
        input?.smtpSecure === undefined ? (preset?.smtpSecure ?? true) : Boolean(input.smtpSecure),
    };
  }

  /** 多来源账户列表，带聚合消息数 / 未读数 / 连接状态 */
  async listAccounts(userId: string): Promise<MailAccountDto[]> {
    const accounts = await this.db
      .select()
      .from(mailAccounts)
      .where(eq(mailAccounts.ownerId, userId))
      .orderBy(asc(mailAccounts.createdAt));

    const all = await this.db
      .select({ accountId: mailMessages.accountId, folder: mailMessages.folder, isRead: mailMessages.isRead })
      .from(mailMessages)
      .where(eq(mailMessages.ownerId, userId));

    const total = new Map<string, number>();
    const unread = new Map<string, number>();
    for (const m of all) {
      total.set(m.accountId, (total.get(m.accountId) ?? 0) + 1);
      if (m.folder === "inbox" && !m.isRead) {
        unread.set(m.accountId, (unread.get(m.accountId) ?? 0) + 1);
      }
    }

    return accounts.map((a) => ({
      ...this.toAccountDto(a),
      messageCount: total.get(a.id) ?? 0,
      unreadCount: unread.get(a.id) ?? 0,
    }));
  }

  private async ownedAccount(userId: string, id: string) {
    const [row] = await this.db
      .select()
      .from(mailAccounts)
      .where(and(eq(mailAccounts.id, id), eq(mailAccounts.ownerId, userId)));
    if (!row) throw new NotFoundException("邮箱账户不存在");
    return row;
  }

  private async resolveAccount(userId: string, id?: string) {
    if (id) return this.ownedAccount(userId, id);
    const [first] = await this.db
      .select()
      .from(mailAccounts)
      .where(eq(mailAccounts.ownerId, userId))
      .orderBy(asc(mailAccounts.createdAt));
    if (!first) throw new BadRequestException("请先添加邮箱账户（邮箱地址 + 授权密码）");
    return first;
  }

  async createAccount(userId: string, input: MailAccountInput): Promise<MailAccountDto> {
    const address = normalizeAddress(input?.address);
    const password = text(input?.password, 200);
    if (!password) throw new BadRequestException("请填写邮箱授权码 / 应用专用密码");

    const rows = await this.db
      .select({ id: mailAccounts.id, address: mailAccounts.address })
      .from(mailAccounts)
      .where(eq(mailAccounts.ownerId, userId));
    if (rows.some((r) => r.address === address)) throw new BadRequestException("该邮箱地址已存在");

    const cfg = this.resolveConfig(input);
    const name = text(input?.name, MAX_NAME) || address.split("@")[0] || "邮箱";
    const row: typeof mailAccounts.$inferSelect = {
      id: randomUUID(),
      ownerId: userId,
      name,
      address,
      provider: cfg.provider,
      passwordEnc: encrypt(password),
      imapHost: cfg.imapHost,
      imapPort: cfg.imapPort,
      imapSecure: cfg.imapSecure,
      smtpHost: cfg.smtpHost,
      smtpPort: cfg.smtpPort,
      smtpSecure: cfg.smtpSecure,
      status: "untested",
      lastError: null,
      lastSyncedAt: null,
      createdAt: new Date(),
    };
    await this.db.insert(mailAccounts).values(row);
    return this.toAccountDto(row);
  }

  /** 修改配置：密码不传则保持原值 */
  async updateAccount(userId: string, id: string, input: MailAccountInput): Promise<MailAccountDto> {
    const current = await this.ownedAccount(userId, id);
    const cfg = this.resolveConfig({
      ...input,
      provider: input?.provider ?? current.provider,
      imapHost: input?.imapHost ?? current.imapHost,
      imapPort: input?.imapPort ?? current.imapPort,
      imapSecure: input?.imapSecure ?? current.imapSecure,
      smtpHost: input?.smtpHost ?? current.smtpHost,
      smtpPort: input?.smtpPort ?? current.smtpPort,
      smtpSecure: input?.smtpSecure ?? current.smtpSecure,
    });
    const patch: Partial<typeof mailAccounts.$inferInsert> = {
      name: text(input?.name, MAX_NAME) || current.name,
      address: input?.address ? normalizeAddress(input.address) : current.address,
      provider: cfg.provider,
      imapHost: cfg.imapHost,
      imapPort: cfg.imapPort,
      imapSecure: cfg.imapSecure,
      smtpHost: cfg.smtpHost,
      smtpPort: cfg.smtpPort,
      smtpSecure: cfg.smtpSecure,
      status: "untested",
      lastError: null,
    };
    if (text(input?.password, 200)) patch.passwordEnc = encrypt(text(input.password, 200));
    await this.db.update(mailAccounts).set(patch).where(eq(mailAccounts.id, id));
    return this.toAccountDto(await this.ownedAccount(userId, id));
  }

  async removeAccount(userId: string, id: string) {
    await this.ownedAccount(userId, id);
    // mail_messages 通过外键级联删除
    await this.db.delete(mailAccounts).where(eq(mailAccounts.id, id));
  }

  /** 当前 INBOX 的邮件总数（连接后 mailbox 才可用） */
  private inboxCount(client: ImapFlow): number {
    const box = client.mailbox;
    return box ? box.exists : 0;
  }

  private makeImap(account: { address: string }, cfg: AccountConfig, password: string): ImapFlow {
    return new ImapFlow({
      host: cfg.imapHost,
      port: cfg.imapPort,
      secure: cfg.imapSecure,
      auth: { user: account.address, pass: password },
      logger: false,
      connectionTimeout: NET_TIMEOUT_MS,
      greetingTimeout: NET_TIMEOUT_MS,
      socketTimeout: NET_TIMEOUT_MS * 2,
    });
  }

  private makeTransport(account: { address: string }, cfg: AccountConfig, password: string) {
    return nodemailer.createTransport({
      host: cfg.smtpHost,
      port: cfg.smtpPort,
      secure: cfg.smtpSecure,
      auth: { user: account.address, pass: password },
      connectionTimeout: NET_TIMEOUT_MS,
      greetingTimeout: NET_TIMEOUT_MS,
      socketTimeout: NET_TIMEOUT_MS * 2,
    });
  }

  private async imapLogin(account: { address: string }, cfg: AccountConfig, password: string) {
    const client = this.makeImap(account, cfg, password);
    try {
      await client.connect();
      await client.mailboxOpen("INBOX");
      return client;
    } catch (e) {
      await client.logout().catch(() => undefined);
      throw e;
    }
  }

  /** 保存前测试：IMAP 登录 + SMTP verify，不落库 */
  async testConfig(input: MailAccountInput): Promise<MailAccountTestResult> {
    const address = normalizeAddress(input?.address);
    const password = text(input?.password, 200);
    if (!password) throw new BadRequestException("请填写邮箱授权码 / 应用专用密码");
    const cfg = this.resolveConfig(input);
    const started = Date.now();
    let imap = "未测试";
    let smtp = "未测试";
    try {
      const client = await this.imapLogin({ address }, cfg, password);
      const exists = this.inboxCount(client);
      await client.logout().catch(() => undefined);
      imap = `登录成功 · INBOX ${exists} 封`;
    } catch (e) {
      const msg = describeMailError(e);
      return { ok: false, imap: `失败：${msg}`, smtp, error: msg, latencyMs: Date.now() - started };
    }
    try {
      const t = this.makeTransport({ address }, cfg, password);
      await t.verify();
      t.close();
      smtp = "SMTP 验证通过";
    } catch (e) {
      const msg = describeMailError(e);
      return { ok: false, imap, smtp: `失败：${msg}`, error: msg, latencyMs: Date.now() - started };
    }
    return { ok: true, imap, smtp, latencyMs: Date.now() - started };
  }

  /** 已保存账户的连接测试，回写状态灯 */
  async testAccount(userId: string, id: string): Promise<MailAccountTestResult> {
    const row = await this.ownedAccount(userId, id);
    if (!row.passwordEnc) throw new BadRequestException("该账户尚未配置授权密码");
    const password = decrypt(row.passwordEnc);
    const cfg: AccountConfig = {
      provider: row.provider,
      imapHost: row.imapHost,
      imapPort: row.imapPort,
      imapSecure: row.imapSecure,
      smtpHost: row.smtpHost,
      smtpPort: row.smtpPort,
      smtpSecure: row.smtpSecure,
    };
    const started = Date.now();
    let imap = "未测试";
    let smtp = "未测试";
    try {
      const client = await this.imapLogin(row, cfg, password);
      const exists = this.inboxCount(client);
      await client.logout().catch(() => undefined);
      imap = `登录成功 · INBOX ${exists} 封`;
    } catch (e) {
      const msg = describeMailError(e);
      await this.db
        .update(mailAccounts)
        .set({ status: "error", lastError: msg.slice(0, 300) })
        .where(eq(mailAccounts.id, id));
      return { ok: false, imap: `失败：${msg}`, smtp, error: msg, latencyMs: Date.now() - started };
    }
    try {
      const t = this.makeTransport(row, cfg, password);
      await t.verify();
      t.close();
      smtp = "SMTP 验证通过";
    } catch (e) {
      const msg = describeMailError(e);
      await this.db
        .update(mailAccounts)
        .set({ status: "error", lastError: msg.slice(0, 300) })
        .where(eq(mailAccounts.id, id));
      return { ok: false, imap, smtp: `失败：${msg}`, error: msg, latencyMs: Date.now() - started };
    }
    await this.db
      .update(mailAccounts)
      .set({ status: "ok", lastError: null })
      .where(eq(mailAccounts.id, id));
    return { ok: true, imap, smtp, latencyMs: Date.now() - started };
  }

  async listMessages(
    userId: string,
    filter: {
      folder?: MailFolder;
      category?: MailCategory;
      accountId?: string;
      unreadOnly?: boolean;
      q?: string;
    } = {},
  ): Promise<MailMessageDto[]> {
    const folder = normalizeFolder(filter.folder, "inbox");
    const conds = [eq(mailMessages.ownerId, userId), eq(mailMessages.folder, folder)];
    if (filter.accountId) conds.push(eq(mailMessages.accountId, filter.accountId));

    const rows = await this.db
      .select({ message: mailMessages, accountName: mailAccounts.name })
      .from(mailMessages)
      .innerJoin(mailAccounts, eq(mailMessages.accountId, mailAccounts.id))
      .where(and(...conds))
      .orderBy(desc(mailMessages.receivedAt));

    let list = rows.map((r) => this.toDto(r.message, r.accountName));
    if (filter.unreadOnly) list = list.filter((m) => !m.isRead);
    if (filter.category) list = list.filter((m) => m.category === filter.category);
    const q = text(filter.q, MAX_QUERY).toLowerCase();
    if (q) {
      list = list.filter((m) =>
        `${m.fromName}\n${m.fromAddress}\n${m.subject}\n${m.body}`.toLowerCase().includes(q),
      );
    }
    return list;
  }

  private async ownedMessage(userId: string, id: string) {
    const [row] = await this.db
      .select({ message: mailMessages, accountName: mailAccounts.name })
      .from(mailMessages)
      .innerJoin(mailAccounts, eq(mailMessages.accountId, mailAccounts.id))
      .where(and(eq(mailMessages.id, id), eq(mailMessages.ownerId, userId)));
    if (!row) throw new NotFoundException("邮件不存在");
    return row;
  }

  async getMessage(userId: string, id: string): Promise<MailMessageDto> {
    const row = await this.ownedMessage(userId, id);
    return this.toDto(row.message, row.accountName);
  }

  /** 附件下载所需的绝对路径与元信息；越界路径一律按不存在处理 */
  async attachmentFile(
    userId: string,
    messageId: string,
    index: number,
  ): Promise<{ path: string; filename: string; contentType: string; size: number }> {
    const row = await this.ownedMessage(userId, messageId);
    const meta = ((row.message.attachmentsJson ?? []) as StoredAttachment[]).find(
      (a) => a.index === index,
    );
    if (!meta?.path) throw new NotFoundException("附件不存在或内容未保存");
    const abs = resolve(ATTACH_ROOT, meta.path);
    if (!abs.startsWith(ATTACH_ROOT + sep)) throw new NotFoundException("附件不存在");
    return {
      path: abs,
      filename: meta.filename,
      contentType: meta.contentType,
      size: meta.size,
    };
  }

  async updateMessage(
    userId: string,
    id: string,
    patch: MailMessagePatchInput,
  ): Promise<MailMessageDto> {
    const row = await this.ownedMessage(userId, id);
    const current = row.message;

    const nextRead = patch?.isRead === undefined ? current.isRead : patch.isRead;
    const nextStarred = patch?.isStarred === undefined ? current.isStarred : patch.isStarred;
    const nextCategory = patch?.category === undefined ? current.category : normalizeCategory(patch.category);
    const nextFolder = patch?.folder === undefined ? current.folder : normalizeFolder(patch.folder, current.folder);

    const sendingDraft = current.folder === "drafts" && nextFolder === "sent";
    if (sendingDraft) {
      const account = await this.ownedAccount(userId, current.accountId);
      await this.sendMail(account, current.toAddress, current.subject, current.body);
    }

    // 已读 / 移动先回写原邮箱，失败则不改本地，避免与服务端分叉
    const remoteUid = this.remoteUid(current.externalId);
    let externalId = current.externalId;
    if (!sendingDraft && remoteUid !== null) {
      const account = await this.ownedAccount(userId, current.accountId);
      if (patch?.isRead !== undefined && Boolean(nextRead) !== current.isRead) {
        await this.pushSeen(account, remoteUid, current.folder, Boolean(nextRead));
      }
      if (nextFolder !== current.folder) {
        if (nextFolder !== "inbox" && nextFolder !== "trash") {
          throw new BadRequestException("仅支持在收件箱与回收站之间移动邮件");
        }
        externalId = await this.pushMove(account, remoteUid, current.folder, nextFolder);
      }
    }

    await this.db
      .update(mailMessages)
      .set({
        isRead: Boolean(nextRead),
        isStarred: Boolean(nextStarred),
        category: nextCategory,
        folder: nextFolder,
        externalId,
        receivedAt: sendingDraft ? new Date() : current.receivedAt,
        aiReason: sendingDraft ? "已通过 SMTP 发出" : current.aiReason,
        updatedAt: new Date(),
      })
      .where(eq(mailMessages.id, id));

    return this.getMessage(userId, id);
  }

  /**
   * 收件箱一键已读：按账号批量回写 IMAP \Seen 后再改本地。
   * 回写失败的账号整批跳过——否则下一轮 sync 会把远端未读拉回来覆盖本地。
   */
  async markAllRead(userId: string): Promise<{ updated: number; skipped: number }> {
    const unread = await this.db
      .select()
      .from(mailMessages)
      .where(
        and(
          eq(mailMessages.ownerId, userId),
          eq(mailMessages.folder, "inbox"),
          eq(mailMessages.isRead, false),
        ),
      );
    if (unread.length === 0) return { updated: 0, skipped: 0 };

    const byAccount = new Map<string, typeof unread>();
    for (const m of unread) {
      const list = byAccount.get(m.accountId);
      if (list) list.push(m);
      else byAccount.set(m.accountId, [m]);
    }

    let updated = 0;
    let skipped = 0;
    for (const [accountId, list] of byAccount) {
      const account = await this.ownedAccount(userId, accountId);
      const uids = list
        .map((m) => this.remoteUid(m.externalId))
        .filter((u): u is number => u !== null);
      try {
        // 一次会话批量打标，避免逐封建连
        if (uids.length > 0) {
          await this.withImap(account, async (client) => {
            await client.mailboxOpen(await this.remoteFolder(client, "inbox"));
            await client.messageFlagsAdd(uids, ["\\Seen"], { uid: true });
          });
        }
        await this.db
          .update(mailMessages)
          .set({ isRead: true, updatedAt: new Date() })
          .where(inArray(mailMessages.id, list.map((m) => m.id)));
        updated += list.length;
      } catch {
        skipped += list.length;
      }
    }
    return { updated, skipped };
  }

  async removeMessage(userId: string, id: string) {
    const row = await this.ownedMessage(userId, id);
    const uid = this.remoteUid(row.message.externalId);
    if (uid !== null && (row.message.folder === "inbox" || row.message.folder === "trash")) {
      const account = await this.ownedAccount(userId, row.message.accountId);
      await this.pushDelete(account, uid, row.message.folder);
    }
    await this.db.delete(mailMessages).where(eq(mailMessages.id, id));
    // 同步清理落盘附件，避免残留
    await rm(resolve(ATTACH_ROOT, id), { recursive: true, force: true }).catch(() => undefined);
  }

  private cfgOf(row: typeof mailAccounts.$inferSelect): AccountConfig {
    return {
      provider: row.provider,
      imapHost: row.imapHost,
      imapPort: row.imapPort,
      imapSecure: row.imapSecure,
      smtpHost: row.smtpHost,
      smtpPort: row.smtpPort,
      smtpSecure: row.smtpSecure,
    };
  }

  private remoteUid(externalId: string | null): number | null {
    const m = /^imap:[^:]+:(\d+)$/.exec(externalId ?? "");
    return m ? Number(m[1]) : null;
  }

  /** 本地 folder → 原邮箱路径（按 special-use 解析，找不到直接报错） */
  private async remoteFolder(client: ImapFlow, folder: MailFolder): Promise<string> {
    if (folder === "inbox") return "INBOX";
    const use = folder === "trash" ? "\\Trash" : folder === "sent" ? "\\Sent" : "\\Drafts";
    const boxes = await client.list();
    const hit = boxes.find((b) => b.specialUse === use);
    if (!hit) throw new BadRequestException(`原邮箱未找到 ${use} 文件夹，无法同步`);
    return hit.path;
  }

  /** 用账户凭据连一次 IMAP 执行回写，异常统一翻译 */
  private async withImap<T>(
    row: typeof mailAccounts.$inferSelect,
    fn: (client: ImapFlow) => Promise<T>,
  ): Promise<T> {
    if (!row.passwordEnc) throw new BadRequestException("该账户未配置授权密码，无法同步到原邮箱");
    if (!row.imapHost) throw new BadRequestException("该账户未配置 IMAP 服务器");
    const client = this.makeImap(row, this.cfgOf(row), decrypt(row.passwordEnc));
    try {
      await client.connect();
      return await fn(client);
    } catch (e) {
      if (e instanceof BadRequestException) throw e;
      throw new BadRequestException(`同步到原邮箱失败：${describeMailError(e)}`);
    } finally {
      await client.logout().catch(() => undefined);
    }
  }

  /** 已读 / 未读回写 IMAP 的 \\Seen 标记 */
  private async pushSeen(
    row: typeof mailAccounts.$inferSelect,
    uid: number,
    folder: MailFolder,
    seen: boolean,
  ) {
    await this.withImap(row, async (client) => {
      const path = await this.remoteFolder(client, folder);
      await client.mailboxOpen(path);
      if (seen) await client.messageFlagsAdd(uid, ["\\Seen"], { uid: true });
      else await client.messageFlagsRemove(uid, ["\\Seen"], { uid: true });
    });
  }

  /** 移动回写 IMAP；MOVE 后 UID 会变，返回新的 externalId */
  private async pushMove(
    row: typeof mailAccounts.$inferSelect,
    uid: number,
    from: MailFolder,
    to: MailFolder,
  ): Promise<string> {
    return this.withImap(row, async (client) => {
      const fromPath = await this.remoteFolder(client, from);
      const toPath = await this.remoteFolder(client, to);
      await client.mailboxOpen(fromPath);
      const res = await client.messageMove(uid, toPath, { uid: true });
      if (!res) throw new BadRequestException("原邮箱移动邮件失败");
      const movedUid = res.uidMap?.get(uid);
      if (!movedUid) throw new BadRequestException("原邮箱未返回移动后的 UID（服务端不支持 UIDPLUS），无法继续同步该邮件");
      return `imap:${row.id}:${movedUid}`;
    });
  }

  /** 删除回写：收件箱移入回收站，回收站内彻底删除 */
  private async pushDelete(
    row: typeof mailAccounts.$inferSelect,
    uid: number,
    folder: MailFolder,
  ) {
    await this.withImap(row, async (client) => {
      const path = await this.remoteFolder(client, folder);
      await client.mailboxOpen(path);
      if (folder === "inbox") {
        const trash = await this.remoteFolder(client, "trash");
        const res = await client.messageMove(uid, trash, { uid: true });
        if (!res) throw new BadRequestException("原邮箱移动邮件失败");
        return;
      }
      await client.messageDelete(uid, { uid: true });
    });
  }

  /** SMTP 真实发送；未配置密码时报错，不落库 */
  private async sendMail(
    account: typeof mailAccounts.$inferSelect,
    to: string,
    subject: string,
    body: string,
  ) {
    if (!account.passwordEnc) {
      throw new BadRequestException("该账户未配置授权密码，无法通过 SMTP 发送");
    }
    if (!account.smtpHost) throw new BadRequestException("该账户未配置 SMTP 服务器");
    const password = decrypt(account.passwordEnc);
    const cfg: AccountConfig = {
      provider: account.provider,
      imapHost: account.imapHost,
      imapPort: account.imapPort,
      imapSecure: account.imapSecure,
      smtpHost: account.smtpHost,
      smtpPort: account.smtpPort,
      smtpSecure: account.smtpSecure,
    };
    const transport = this.makeTransport(account, cfg, password);
    try {
      await transport.sendMail({
        from: { name: account.name, address: account.address },
        to,
        subject,
        text: body,
      });
    } catch (e) {
      throw new BadRequestException(`SMTP 发送失败：${describeMailError(e)}`);
    } finally {
      transport.close();
    }
  }

  async compose(userId: string, input: MailMessageInput): Promise<MailMessageDto> {
    const account = await this.resolveAccount(userId, input?.accountId);
    const to = normalizeAddress(input?.to);
    const subject = text(input?.subject, MAX_SUBJECT) || "(无主题)";
    const body = bodyText(input?.body);
    const now = new Date();
    const draft = Boolean(input?.draft);

    if (!draft) await this.sendMail(account, to, subject, body);

    const row: typeof mailMessages.$inferSelect = {
      id: randomUUID(),
      ownerId: userId,
      accountId: account.id,
      folder: draft ? "drafts" : "sent",
      direction: "outbound",
      fromName: account.name,
      fromAddress: account.address,
      toAddress: to,
      subject,
      body,
      bodyHtml: null,
      attachmentsJson: [],
      externalId: null,
      receivedAt: now,
      isRead: true,
      isStarred: false,
      category: "normal",
      aiReason: draft ? "本地草稿，尚未发送" : "已通过 SMTP 发出",
      classifiedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    await this.db.insert(mailMessages).values(row);
    return this.toDto(row, account.name);
  }

  async reply(userId: string, id: string, body: unknown): Promise<MailMessageDto> {
    const row = await this.ownedMessage(userId, id);
    const original = row.message;
    const content = bodyText(body);
    if (!content.trim()) throw new BadRequestException("回复正文不能为空");

    const account = await this.ownedAccount(userId, original.accountId);
    const to = original.fromAddress || original.toAddress;
    if (!to) throw new BadRequestException("原邮件缺少发件地址，无法回复");
    const subject = /^re:/i.test(original.subject) ? original.subject : `Re: ${original.subject}`.slice(0, MAX_SUBJECT);
    const now = new Date();

    await this.sendMail(account, to, subject, content);

    const replyRow: typeof mailMessages.$inferSelect = {
      id: randomUUID(),
      ownerId: userId,
      accountId: account.id,
      folder: "sent",
      direction: "outbound",
      fromName: account.name,
      fromAddress: account.address,
      toAddress: to,
      subject,
      body: content,
      bodyHtml: null,
      attachmentsJson: [],
      externalId: null,
      receivedAt: now,
      isRead: true,
      isStarred: false,
      category: "normal",
      aiReason: "已通过 SMTP 发出",
      classifiedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    await this.db.insert(mailMessages).values(replyRow);
    await this.db
      .update(mailMessages)
      .set({ isRead: true, updatedAt: now })
      .where(eq(mailMessages.id, original.id));

    return this.toDto(replyRow, account.name);
  }

  /** 规则式 AI 分类：扫描收件箱并写入类别 + 理由 */
  async classify(userId: string): Promise<MailClassifyResult> {
    const rows = await this.db
      .select()
      .from(mailMessages)
      .where(and(eq(mailMessages.ownerId, userId), eq(mailMessages.folder, "inbox")));

    const now = new Date();
    const counts: MailClassifyResult = {
      scanned: rows.length,
      important: 0,
      subscription: 0,
      spam: 0,
      normal: 0,
    };
    for (const row of rows) {
      const result = classifyContent(row.subject, row.body, row.fromName, row.fromAddress);
      counts[result.category] += 1;
      await this.db
        .update(mailMessages)
        .set({ category: result.category, aiReason: result.reason, classifiedAt: now, updatedAt: now })
        .where(eq(mailMessages.id, row.id));
    }
    return counts;
  }

  /** 真实 IMAP 同步：按时间窗增量拉取，按 imap uid 幂等落库 */
  async sync(userId: string): Promise<MailSyncResult> {
    if (this.syncing.has(userId)) throw new BadRequestException("该账号正在同步中，请稍候");
    this.syncing.add(userId);
    try {
      return await this.runSync(userId);
    } finally {
      this.syncing.delete(userId);
    }
  }

  private async runSync(userId: string): Promise<MailSyncResult> {
    const accounts = await this.db
      .select()
      .from(mailAccounts)
      .where(eq(mailAccounts.ownerId, userId))
      .orderBy(asc(mailAccounts.createdAt));

    if (accounts.length === 0) {
      throw new BadRequestException("请先添加邮箱账户（邮箱地址 + 授权密码）再同步");
    }

    let createdTotal = 0;
    let skippedTotal = 0;
    /** 单封解析/落库失败数（跳过但不中断整批） */
    let parseErrors = 0;
    let failed = 0;
    const details: MailSyncResult["details"] = [];

    for (const account of accounts) {
      if (!account.passwordEnc) {
        failed += 1;
        details.push({ account: account.address, created: 0, error: "未配置授权密码" });
        continue;
      }
      const cfg: AccountConfig = {
        provider: account.provider,
        imapHost: account.imapHost,
        imapPort: account.imapPort,
        imapSecure: account.imapSecure,
        smtpHost: account.smtpHost,
        smtpPort: account.smtpPort,
        smtpSecure: account.smtpSecure,
      };
      let client: ImapFlow | undefined;
      let created = 0;
      try {
        const password = decrypt(account.passwordEnc);
        client = this.makeImap(account, cfg, password);
        await client.connect();
        await client.mailboxOpen("INBOX");
        // 按「上次同步时间 - 1 天」取 UID。以前固定取最后 50 条序列号，
        // 隔几天才点一次同步时，中间那段信会被永久跳过（本次报障就是这个原因）。
        const since = account.lastSyncedAt
          ? new Date(Math.max(0, account.lastSyncedAt.getTime() - SYNC_OVERLAP_MS))
          : new Date(Date.now() - SYNC_FALLBACK_DAYS * 24 * 60 * 60 * 1000);
        const found = await client.search({ since }, { uid: true });
        const uids = (Array.isArray(found) ? found : []).slice(-SYNC_LIMIT);

        const existing = await this.db
          .select({
            id: mailMessages.id,
            externalId: mailMessages.externalId,
            isRead: mailMessages.isRead,
            bodyHtml: mailMessages.bodyHtml,
          })
          .from(mailMessages)
          .where(
            and(
              eq(mailMessages.ownerId, userId),
              eq(mailMessages.accountId, account.id),
              eq(mailMessages.folder, "inbox"),
              isNotNull(mailMessages.externalId),
            ),
          );
        const local = new Map(
          existing
            .filter((r) => r.externalId)
            .map((r) => [
              r.externalId as string,
              { id: r.id, isRead: r.isRead, bodyHtml: r.bodyHtml },
            ]),
        );

        if (uids.length > 0) {
          const now = new Date();
          for await (const msg of client.fetch(uids, {
            uid: true,
            envelope: true,
            source: true,
            flags: true,
          }, { uid: true })) {
            const raw = msg.source as Buffer | undefined;
            if (!raw) {
              skippedTotal += 1;
              continue;
            }
            const uid = Number(msg.uid);
            const externalId = `imap:${account.id}:${uid}`;
            const known = local.get(externalId);
            if (known) {
              // 老数据缺 HTML/附件（bodyHtml 为 null）：用本次已拉取的 raw 补全，只做一次
              if (known.bodyHtml === null) {
                try {
                  const parsed = await simpleParser(raw);
                  const html = typeof parsed.html === "string" ? parsed.html : "";
                  await this.db
                    .update(mailMessages)
                    .set({
                      bodyHtml: html ? html.slice(0, MAX_HTML) : "",
                      attachmentsJson: await persistMessageAttachments(
                        known.id,
                        parsed.attachments ?? [],
                      ),
                      updatedAt: now,
                    })
                    .where(eq(mailMessages.id, known.id));
                  known.bodyHtml = html ? "<html>" : "";
                } catch (e) {
                  parseErrors += 1;
                  this.log.warn(`补全邮件正文失败（uid ${uid}）：${(e as Error).message}`);
                }
              }
              // 已同步过的邮件：把远端已读状态拉回来，保持双向一致
              const isRead = Boolean(msg.flags?.has("\\Seen"));
              if (known.isRead !== isRead) {
                await this.db
                  .update(mailMessages)
                  .set({ isRead, updatedAt: now })
                  .where(eq(mailMessages.id, known.id));
                known.isRead = isRead;
              }
              skippedTotal += 1;
              continue;
            }
            // 单封解析/落库失败只跳过这一封：以前一个异常会让整批新邮件停在半路
            try {
              const parsed = await simpleParser(raw);
              const from = parsed.from?.value?.[0] ?? msg.envelope?.from?.[0];
              const fromAddress = from?.address ?? "unknown@unknown";
              const fromName = from?.name ?? "";
              const subject = text(parsed.subject ?? msg.envelope?.subject ?? "(无主题)", MAX_SUBJECT) || "(无主题)";
              const html = typeof parsed.html === "string" ? parsed.html : "";
              const body = bodyText(parsed.text ?? (html ? stripHtml(html) : "")) || "（无正文）";
              const receivedAt = new Date(parsed.date ?? msg.envelope?.date ?? now);
              const isRead = Boolean(msg.flags?.has("\\Seen"));
              const { category, reason } = classifyContent(subject, body, fromName, fromAddress);

              const messageId = randomUUID();
              await this.db.insert(mailMessages).values({
                id: messageId,
                ownerId: userId,
                accountId: account.id,
                folder: "inbox",
                direction: "inbound",
                fromName,
                fromAddress,
                toAddress: account.address,
                subject,
                body,
                bodyHtml: html ? html.slice(0, MAX_HTML) : "",
                attachmentsJson: await persistMessageAttachments(messageId, parsed.attachments ?? []),
                externalId,
                receivedAt,
                isRead,
                isStarred: Boolean(msg.flags?.has("\\Flagged")),
                category,
                aiReason: reason,
                classifiedAt: now,
                createdAt: now,
                updatedAt: now,
              });
              created += 1;
              createdTotal += 1;
            } catch (e) {
              parseErrors += 1;
              skippedTotal += 1;
              this.log.warn(`跳过一封无法处理的邮件（uid ${uid}）：${(e as Error).message}`);
            }
          }
        }

        await client.logout().catch(() => undefined);
        client = undefined;
        await this.db
          .update(mailAccounts)
          .set({ status: "ok", lastError: null, lastSyncedAt: new Date() })
          .where(eq(mailAccounts.id, account.id));
        details.push({ account: account.address, created });
      } catch (e) {
        const msg = describeMailError(e);
        failed += 1;
        details.push({ account: account.address, created: 0, error: msg.slice(0, 200) });
        await this.db
          .update(mailAccounts)
          .set({ status: "error", lastError: msg.slice(0, 300) })
          .where(eq(mailAccounts.id, account.id));
        await client?.logout().catch(() => undefined);
      }
    }

    return {
      created: createdTotal,
      skipped: skippedTotal,
      accounts: accounts.length,
      classified: createdTotal,
      failed,
      parseErrors,
      details,
    };
  }

  async digest(userId: string): Promise<MailDigestDto> {
    const rows = await this.db
      .select({
        folder: mailMessages.folder,
        category: mailMessages.category,
        isRead: mailMessages.isRead,
        classifiedAt: mailMessages.classifiedAt,
      })
      .from(mailMessages)
      .where(eq(mailMessages.ownerId, userId));
    const accounts = await this.db
      .select({ id: mailAccounts.id })
      .from(mailAccounts)
      .where(eq(mailAccounts.ownerId, userId));

    const categories: Record<MailCategory, number> = {
      important: 0,
      subscription: 0,
      spam: 0,
      normal: 0,
    };
    let inbox = 0;
    let unread = 0;
    let sent = 0;
    let drafts = 0;
    let trash = 0;
    let lastClassifiedAt: number | null = null;

    for (const m of rows) {
      if (m.folder === "inbox") {
        inbox += 1;
        if (!m.isRead) unread += 1;
        categories[m.category] += 1;
      } else if (m.folder === "sent") sent += 1;
      else if (m.folder === "drafts") drafts += 1;
      else if (m.folder === "trash") trash += 1;
      if (m.classifiedAt) {
        const ts = m.classifiedAt.getTime();
        if (lastClassifiedAt === null || ts > lastClassifiedAt) lastClassifiedAt = ts;
      }
    }

    const summary =
      lastClassifiedAt === null
        ? "尚未分类 — 输入 mail.classify 让 AI 处理收件箱"
        : `AI 分类完成 — 重要 ${categories.important} · 订阅 ${categories.subscription} · 垃圾 ${categories.spam} · 已为你标记`;

    return {
      inbox,
      unread,
      sent,
      drafts,
      trash,
      accounts: accounts.length,
      categories,
      lastClassifiedAt,
      summary,
    };
  }

  /** AI 工具：按 id / 主题关键词查找邮件，并标记已读 */
  async findByKey(userId: string, key: string): Promise<MailMessageDto> {
    const q = key.trim();
    if (!q) throw new BadRequestException("缺少邮件 id 或关键词");
    const rows = await this.db
      .select({ message: mailMessages, accountName: mailAccounts.name })
      .from(mailMessages)
      .innerJoin(mailAccounts, eq(mailMessages.accountId, mailAccounts.id))
      .where(eq(mailMessages.ownerId, userId))
      .orderBy(desc(mailMessages.receivedAt));

    const byId = rows.find((r) => r.message.id === q);
    const bySubject = rows.find((r) => r.message.subject.includes(q));
    const byFrom = rows.find((r) => r.message.fromAddress.includes(q) || r.message.fromName.includes(q));
    const found = byId ?? bySubject ?? byFrom;
    if (!found) throw new NotFoundException(`未找到邮件「${q}」`);
    if (!found.message.isRead) {
      await this.db
        .update(mailMessages)
        .set({ isRead: true, updatedAt: new Date() })
        .where(eq(mailMessages.id, found.message.id));
    }
    return this.toDto(found.message, found.accountName);
  }
}
