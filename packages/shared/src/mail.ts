/** 邮件管理（mail 模块）共享类型 —— 多邮箱聚合（IMAP）+ SMTP 发送 */

export const MAIL_FOLDERS = ["inbox", "sent", "drafts", "trash"] as const;
export type MailFolder = (typeof MAIL_FOLDERS)[number];

export const MAIL_CATEGORIES = ["important", "subscription", "spam", "normal"] as const;
export type MailCategory = (typeof MAIL_CATEGORIES)[number];

export const MAIL_DIRECTIONS = ["inbound", "outbound"] as const;
export type MailDirection = (typeof MAIL_DIRECTIONS)[number];

export const MAIL_ACCOUNT_STATUSES = ["ok", "error", "untested"] as const;
export type MailAccountStatus = (typeof MAIL_ACCOUNT_STATUSES)[number];

/** 主流邮箱服务商预设：host / port / SSL，选择后自动填充，可再手改 */
export interface MailProviderPreset {
  value: string;
  label: string;
  imapHost: string;
  imapPort: number;
  imapSecure: boolean;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
}

export const MAIL_PROVIDER_PRESETS: MailProviderPreset[] = [
  {
    value: "qq",
    label: "QQ 邮箱",
    imapHost: "imap.qq.com",
    imapPort: 993,
    imapSecure: true,
    smtpHost: "smtp.qq.com",
    smtpPort: 465,
    smtpSecure: true,
  },
  {
    value: "163",
    label: "网易 163",
    imapHost: "imap.163.com",
    imapPort: 993,
    imapSecure: true,
    smtpHost: "smtp.163.com",
    smtpPort: 465,
    smtpSecure: true,
  },
  {
    value: "126",
    label: "网易 126",
    imapHost: "imap.126.com",
    imapPort: 993,
    imapSecure: true,
    smtpHost: "smtp.126.com",
    smtpPort: 465,
    smtpSecure: true,
  },
  {
    value: "gmail",
    label: "Gmail",
    imapHost: "imap.gmail.com",
    imapPort: 993,
    imapSecure: true,
    smtpHost: "smtp.gmail.com",
    smtpPort: 465,
    smtpSecure: true,
  },
  {
    value: "outlook",
    label: "Outlook / 365",
    imapHost: "outlook.office365.com",
    imapPort: 993,
    imapSecure: true,
    smtpHost: "smtp.office365.com",
    smtpPort: 587,
    smtpSecure: false,
  },
  {
    value: "custom",
    label: "自定义 IMAP / SMTP",
    imapHost: "",
    imapPort: 993,
    imapSecure: true,
    smtpHost: "",
    smtpPort: 465,
    smtpSecure: true,
  },
];

/** 邮箱账户：含 IMAP 收件 + SMTP 发件的接入参数（密码永不回传明文） */
export interface MailAccountDto {
  id: string;
  name: string;
  address: string;
  provider: string;
  imapHost: string;
  imapPort: number;
  imapSecure: boolean;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  /** 是否已配置授权密码 */
  hasPassword: boolean;
  status: MailAccountStatus;
  lastError?: string;
  lastSyncedAt?: number;
  messageCount: number;
  unreadCount: number;
  createdAt: number;
}

export interface MailAccountInput {
  name?: string;
  address: string;
  provider?: string;
  /** 邮箱授权码 / 应用专用密码（QQ、163 等需在网页端开启 IMAP/SMTP 后生成） */
  password?: string;
  imapHost?: string;
  imapPort?: number;
  imapSecure?: boolean;
  smtpHost?: string;
  smtpPort?: number;
  smtpSecure?: boolean;
}

export interface MailAccountTestResult {
  ok: boolean;
  /** IMAP 登录结果说明 */
  imap?: string;
  /** SMTP 验证结果说明 */
  smtp?: string;
  error?: string;
  latencyMs: number;
}

export interface MailMessageDto {
  id: string;
  accountId: string;
  accountName: string;
  folder: MailFolder;
  direction: MailDirection;
  fromName: string;
  fromAddress: string;
  toAddress: string;
  subject: string;
  body: string;
  /** 正文首行截断，列表摘要用 */
  snippet: string;
  receivedAt: number;
  isRead: boolean;
  isStarred: boolean;
  category: MailCategory;
  /** AI 分类理由 / 处理建议 */
  aiReason: string;
  /** IMAP UID 等稳定标识，用于幂等同步 */
  externalId: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface MailMessageInput {
  accountId?: string;
  to: string;
  subject: string;
  body: string;
  /** true 存草稿，缺省直接通过 SMTP 发送 */
  draft?: boolean;
}

export interface MailReplyInput {
  body: string;
}

export interface MailMessagePatchInput {
  isRead?: boolean;
  isStarred?: boolean;
  category?: MailCategory;
  folder?: MailFolder;
}

/** 收件箱概览：AI 分类统计 + 未读数，驱动面板顶部摘要条 */
export interface MailDigestDto {
  inbox: number;
  unread: number;
  sent: number;
  drafts: number;
  trash: number;
  accounts: number;
  categories: Record<MailCategory, number>;
  lastClassifiedAt: number | null;
  /** 如「AI 分类完成 — 重要 5 · 订阅 4 · 垃圾 2 · 已为你标记」 */
  summary: string;
}

export interface MailSyncResult {
  created: number;
  skipped: number;
  accounts: number;
  classified: number;
  /** 同步失败的账户数 */
  failed: number;
  details: { account: string; created: number; error?: string }[];
}

export interface MailClassifyResult {
  scanned: number;
  important: number;
  subscription: number;
  spam: number;
  normal: number;
}
