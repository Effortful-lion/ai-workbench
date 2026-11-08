import { Inject, Injectable, BadRequestException, NotFoundException } from "@nestjs/common";
import { eq } from "drizzle-orm";
import {
  type ContactChannel,
  type ContactChannelType,
  type ContactProfile,
  type ContactVisibility,
  type OwnContactDto,
  type PublicContactDto,
} from "@aiwb/shared";
import { DB, type Db } from "../db/db.module";
import { users } from "../db/schema";

/** profile_json 信封：与简历共用同一个 JSON 列，写入时必须合并而不是覆盖 */
interface ProfileBox {
  resume?: { basics?: { email?: unknown; website?: unknown } };
  contact?: unknown;
  contactUpdatedAt?: unknown;
}

const CHANNEL_TYPES: readonly ContactChannelType[] = [
  "email", "github", "website", "wechat", "phone", "booking",
];

const CHANNEL_LABELS: Record<ContactChannelType, string> = {
  email: "邮箱",
  github: "GitHub",
  website: "主页",
  wechat: "微信",
  phone: "电话",
  booking: "预约",
};

const DEFAULT_VISIBILITY: Record<ContactChannelType, ContactVisibility> = {
  email: "public",
  github: "public",
  website: "public",
  booking: "public",
  wechat: "owner",
  phone: "owner",
};

function str(v: unknown, max: number): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

function isChannelType(v: unknown): v is ContactChannelType {
  return typeof v === "string" && CHANNEL_TYPES.includes(v as ContactChannelType);
}

function isHttps(v: string): boolean {
  return /^https:\/\/[^\s]+$/i.test(v);
}

/** 只允许 https / mailto，避免 javascript: 等危险链接进入公开页 */
function channelUrl(type: ContactChannelType, value: string, rawUrl: string): string | undefined {
  if (type === "email") return `mailto:${value}`;
  if (type === "phone" || type === "wechat") return undefined;
  if (isHttps(rawUrl)) return rawUrl;
  if (value.startsWith("https://")) return value;
  if (type === "github") {
    return `https://github.com/${value.replace(/^https?:\/\/github\.com\//i, "")}`;
  }
  return `https://${value.replace(/^https?:\/\//i, "")}`;
}

function normalizeChannel(raw: unknown): ContactChannel | null {
  const c = (raw ?? {}) as Partial<ContactChannel>;
  if (!isChannelType(c.type)) return null;
  const value = str(c.value, 200);
  if (!value) return null;
  const visibility: ContactVisibility =
    c.visibility === "owner" ? "owner" : c.visibility === "public" ? "public" : DEFAULT_VISIBILITY[c.type];
  return {
    type: c.type,
    label: str(c.label, 24) || CHANNEL_LABELS[c.type],
    value,
    url: channelUrl(c.type, value, str(c.url, 300)),
    visibility,
  };
}

function normalizeContact(raw: unknown): ContactProfile {
  const p = (raw ?? {}) as Partial<ContactProfile>;
  const seen = new Set<ContactChannelType>();
  const channels: ContactChannel[] = [];
  if (Array.isArray(p.channels)) {
    for (const item of p.channels.slice(0, 10)) {
      const channel = normalizeChannel(item);
      if (!channel || seen.has(channel.type)) continue;
      seen.add(channel.type);
      channels.push(channel);
    }
  }

  const preferred = isChannelType(p.preferred) && channels.some((c) => c.type === p.preferred)
    ? p.preferred
    : channels.find((c) => c.visibility === "public")?.type ?? channels[0]?.type ?? "email";

  return {
    preferred,
    responseTime: str(p.responseTime, 40) || "1 个工作日内",
    availability: str(p.availability, 60),
    channels,
    updatedAt: null,
  };
}

/** 老用户没有 contact 时，用简历 basics 的邮箱/主页兜底 */
function fromResumeBasics(box: ProfileBox): ContactProfile {
  const basics = box.resume?.basics ?? {};
  const channels: ContactChannel[] = [];
  const email = str(basics.email, 200);
  const website = str(basics.website, 200);
  if (email) {
    channels.push({
      type: "email", label: CHANNEL_LABELS.email, value: email,
      url: `mailto:${email}`, visibility: "public",
    });
  }
  if (website) {
    channels.push({
      type: "website", label: CHANNEL_LABELS.website, value: website,
      url: channelUrl("website", website, ""), visibility: "public",
    });
  }
  return {
    preferred: channels[0]?.type ?? "email",
    responseTime: "1 个工作日内",
    availability: "",
    channels,
    updatedAt: null,
  };
}

@Injectable()
export class ContactService {
  constructor(@Inject(DB) private readonly db: Db) {}

  private box(row: typeof users.$inferSelect): ProfileBox {
    return (row.profileJson ?? {}) as ProfileBox;
  }

  private toContact(row: typeof users.$inferSelect): ContactProfile {
    const box = this.box(row);
    if (box.contact !== undefined && box.contact !== null) {
      const contact = normalizeContact(box.contact);
      contact.updatedAt = typeof box.contactUpdatedAt === "number"
        ? new Date(box.contactUpdatedAt).toISOString()
        : null;
      return contact;
    }
    return fromResumeBasics(box);
  }

  private publicOnly(contact: ContactProfile): ContactProfile {
    return {
      ...contact,
      channels: contact.channels.filter((c) => c.visibility === "public"),
    };
  }

  async getPublic(username: string): Promise<PublicContactDto> {
    const [row] = await this.db.select().from(users).where(eq(users.username, username));
    if (!row) throw new NotFoundException("用户不存在");
    return { username: row.username, contact: this.publicOnly(this.toContact(row)) };
  }

  async getOwn(userId: string): Promise<OwnContactDto> {
    const [row] = await this.db.select().from(users).where(eq(users.id, userId));
    if (!row) throw new NotFoundException("用户不存在");
    return { username: row.username, canEdit: true, contact: this.toContact(row) };
  }

  async update(userId: string, input: unknown): Promise<OwnContactDto> {
    const raw = (input as { contact?: unknown } | null)?.contact;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new BadRequestException("contact 必须是对象");
    }
    const contact = normalizeContact(raw);
    if (JSON.stringify(contact).length > 4_000) {
      throw new BadRequestException("联系信息过长，请精简后保存");
    }

    const [row] = await this.db.select().from(users).where(eq(users.id, userId));
    if (!row) throw new NotFoundException("用户不存在");

    const nextBox: ProfileBox = {
      ...this.box(row),
      contact,
      contactUpdatedAt: Date.now(),
    };
    await this.db
      .update(users)
      .set({ profileJson: nextBox as Record<string, unknown> })
      .where(eq(users.id, userId));

    return this.getOwn(userId);
  }
}
