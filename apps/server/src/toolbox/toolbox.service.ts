import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { and, desc, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import type { ToolboxItemDto, ToolboxItemInput } from "@aiwb/shared";
import { mimeOfFileName } from "@aiwb/shared";
import { DB, type Db } from "../db/db.module";
import { toolboxItems, users } from "../db/schema";

const MAX_URL = 500;
const MAX_NAME = 40;
const MAX_DESC = 200;

/** 上传体积上限：50MB，覆盖常规安装包 / 压缩包 / 技能包 */
export const MAX_TOOLBOX_FILE_BYTES = 50 * 1024 * 1024;

/** workspace root — __dirname = dist/toolbox，往上 4 级；文件落在 data/toolbox */
const TOOLBOX_DIR = join(resolve(__dirname, "../../../../data"), "toolbox");

/** multer 内存存储的文件对象（不引入 @types/multer，按需结构声明） */
export interface UploadedToolboxFile {
  originalname?: string;
  mimetype?: string;
  buffer?: Buffer;
  size?: number;
}

export interface FileToolInput {
  name?: string;
  category?: string;
  desc?: string;
}

function text(v: unknown, max: number): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

/** 只接受 http(s)，统一规范化为 URL.toString() */
function normalizeUrl(raw: unknown): string {
  const s = text(raw, MAX_URL);
  if (!s) throw new BadRequestException("url 不能为空");
  try {
    const u = new URL(s);
    if (u.protocol !== "http:" && u.protocol !== "https:") {
      throw new BadRequestException("url 仅支持 http / https");
    }
    return u.toString();
  } catch (e) {
    if (e instanceof BadRequestException) throw e;
    throw new BadRequestException("url 不是合法地址");
  }
}

/** 从 URL 主机名推导别名：cursor.sh → cursor，github.com → github */
function deriveName(url: string): string {
  const host = new URL(url).hostname.replace(/^www\./, "");
  const first = host.split(".")[0] || host;
  return first.slice(0, MAX_NAME) || "tool";
}

/** 从文件名推导别名：cursor-0.44.zip → cursor-0.44 */
function deriveNameFromFile(fileName: string): string {
  const base = fileName.replace(/\.[^.]*$/, "") || fileName;
  return base.slice(0, MAX_NAME) || "file";
}

/** 文件名去路径 / 去危险字符，避免穿越与超长 */
function safeFileName(raw: string): string {
  const base = basename(raw)
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_")
    .trim();
  return (base || "file").slice(0, 120);
}

/** 分类标签：去掉 #、空白转连字符，允许中文 */
function normalizeCategory(raw: unknown): string {
  const s = text(raw, 20).replace(/^#+/, "").replace(/\s+/g, "-");
  return s || "misc";
}

@Injectable()
export class ToolboxService {
  constructor(@Inject(DB) private readonly db: Db) {}

  private toDto(row: typeof toolboxItems.$inferSelect): ToolboxItemDto {
    return {
      id: row.id,
      name: row.name,
      kind: row.kind,
      url: row.url,
      category: row.category,
      desc: row.desc,
      useCount: row.useCount,
      createdAt: row.createdAt.getTime(),
      ...(row.kind === "file"
        ? {
            fileName: row.fileName ?? "",
            fileSize: row.fileSize,
            mimeType: row.mimeType ?? "",
          }
        : {}),
    };
  }

  async list(userId: string): Promise<ToolboxItemDto[]> {
    const rows = await this.db
      .select()
      .from(toolboxItems)
      .where(eq(toolboxItems.ownerId, userId))
      .orderBy(desc(toolboxItems.useCount), desc(toolboxItems.createdAt));
    return rows.map((r) => this.toDto(r));
  }

  /** 公开只读墙：按用户名取对方百宝箱（游客可见） */
  async listPublic(username: string): Promise<ToolboxItemDto[]> {
    const [u] = await this.db.select().from(users).where(eq(users.username, username));
    if (!u) throw new NotFoundException("用户不存在");
    return this.list(u.id);
  }

  /** 链接类工具：url 必填 */
  async create(userId: string, input: ToolboxItemInput): Promise<ToolboxItemDto> {
    const url = normalizeUrl(input?.url);
    const name = text(input?.name, MAX_NAME) || deriveName(url);
    const category = normalizeCategory(input?.category);
    const desc = text(input?.desc, MAX_DESC);

    const row: typeof toolboxItems.$inferSelect = {
      id: randomUUID(),
      ownerId: userId,
      kind: "link",
      name,
      url,
      fileName: null,
      fileSize: 0,
      mimeType: null,
      storagePath: null,
      category,
      desc,
      useCount: 0,
      createdAt: new Date(),
    };
    await this.db.insert(toolboxItems).values(row);
    return this.toDto(row);
  }

  /** 文件类工具：二进制 / 安装包 / 压缩包 / 技能包，落盘到 data/toolbox/<id>/ */
  async createFile(
    userId: string,
    input: FileToolInput,
    file: UploadedToolboxFile,
  ): Promise<ToolboxItemDto> {
    const buf = file?.buffer;
    if (!buf || buf.length === 0) throw new BadRequestException("文件为空");
    if (buf.length > MAX_TOOLBOX_FILE_BYTES) {
      throw new BadRequestException(`文件不能超过 ${MAX_TOOLBOX_FILE_BYTES / 1024 / 1024}MB`);
    }

    const fileName = safeFileName(file.originalname ?? "file");
    const id = randomUUID();
    const storagePath = `${id}/${fileName}`;
    await mkdir(join(TOOLBOX_DIR, id), { recursive: true });
    await writeFile(join(TOOLBOX_DIR, storagePath), buf);

    const name = text(input?.name, MAX_NAME) || deriveNameFromFile(fileName);
    const category = normalizeCategory(input?.category);
    const desc = text(input?.desc, MAX_DESC);

    const row: typeof toolboxItems.$inferSelect = {
      id,
      ownerId: userId,
      kind: "file",
      name,
      url: `/api/toolbox/files/${id}`,
      fileName,
      fileSize: buf.length,
      mimeType:
        file.mimetype && file.mimetype !== "application/octet-stream"
          ? file.mimetype.slice(0, 100)
          : mimeOfFileName(fileName),
      storagePath,
      category,
      desc,
      useCount: 0,
      createdAt: new Date(),
    };
    await this.db.insert(toolboxItems).values(row);
    return this.toDto(row);
  }

  /** 下载信息：文件类工具才能取，路径必须仍在 data/toolbox 内 */
  async fileFor(
    id: string,
  ): Promise<{ path: string; fileName: string; mimeType: string; size: number }> {
    const [row] = await this.db.select().from(toolboxItems).where(eq(toolboxItems.id, id));
    if (!row || row.kind !== "file" || !row.storagePath) {
      throw new NotFoundException("文件不存在");
    }
    const abs = resolve(TOOLBOX_DIR, row.storagePath);
    const rel = relative(TOOLBOX_DIR, abs);
    if (!rel || rel.startsWith("..") || isAbsolute(rel)) {
      throw new NotFoundException("文件不存在");
    }
    return {
      path: abs,
      fileName: row.fileName || "file",
      mimeType: row.mimeType || "application/octet-stream",
      size: row.fileSize,
    };
  }

  async remove(id: string, userId: string) {
    const rows = await this.db
      .select()
      .from(toolboxItems)
      .where(and(eq(toolboxItems.id, id), eq(toolboxItems.ownerId, userId)));
    if (rows.length === 0) throw new NotFoundException("工具不存在");
    const row = rows[0];
    await this.db.delete(toolboxItems).where(eq(toolboxItems.id, id));
    if (row.storagePath) {
      const absDir = dirname(resolve(TOOLBOX_DIR, row.storagePath));
      await rm(absDir, { recursive: true, force: true }).catch(() => {
        /* 文件已不在，忽略 */
      });
    }
  }

  /** 点开一次计数 +1；member 只读但可累计使用次数 */
  async touch(id: string, userId: string): Promise<{ useCount: number }> {
    const [row] = await this.db
      .select()
      .from(toolboxItems)
      .where(and(eq(toolboxItems.id, id), eq(toolboxItems.ownerId, userId)));
    if (!row) throw new NotFoundException("工具不存在");
    const useCount = row.useCount + 1;
    await this.db.update(toolboxItems).set({ useCount }).where(eq(toolboxItems.id, id));
    return { useCount };
  }
}
