import { BadRequestException, Injectable, Logger, NotFoundException, OnModuleInit } from "@nestjs/common";
import { Client } from "minio";
import type { Readable } from "node:stream";

/** MinIO 连接配置：默认值与 services/minio/.env 对齐，生产用环境变量覆盖 */
const ENDPOINT = process.env.MINIO_ENDPOINT ?? "localhost";
const PORT = Number(process.env.MINIO_PORT ?? 9700);
const USE_SSL = process.env.MINIO_USE_SSL === "true";
const ACCESS_KEY = process.env.MINIO_ACCESS_KEY ?? "admin";
const SECRET_KEY = process.env.MINIO_SECRET_KEY ?? "admin123";
/** AI 工具专用桶（storage.* 工具唯一可访问） */
const BUCKET = process.env.MINIO_BUCKET ?? "aiwb";

/** 模块桶映射：kb=知识库原文存档，files=工具箱等用户二进制，tools=AI 工具临时产物。
 *  AI 工具仍只能碰 tools 桶；kb/files 仅供服务端内部模块读写。 */
export const BUCKETS = {
  kb: process.env.MINIO_BUCKET_KB ?? "aiwb-kb",
  files: process.env.MINIO_BUCKET_FILES ?? "aiwb-files",
  tools: BUCKET,
} as const;
export type ModuleBucket = keyof typeof BUCKETS;

/** 内联文本读写上限：超过一律走预签名 URL，不把字节流搬进模型上下文 */
export const MAX_INLINE_BYTES = 256 * 1024;
/** 预签名 URL 默认/最大有效期（秒） */
const PRESIGN_DEFAULT_S = 900;
const PRESIGN_MAX_S = 3600;
/** 允许删除的对象前缀：AI 只能清理由工作台自己产出的文件 */
const REMOVABLE_PREFIX = "ai-workbench/";

const KEY_RE = /^[\w./()（）\u4e00-\u9fff-]{1,512}$/;

export interface StorageObjectInfo {
  key: string;
  size: number;
  lastModified: string;
}

/** 对象存储（MinIO）薄封装：桶白名单 + key 校验 + 大小限制 + 预签名策略。
 *  只做权限收口与护栏，不扩展功能 —— AI 永远不直接搬运大字节流。 */
@Injectable()
export class StorageService implements OnModuleInit {
  private readonly log = new Logger("storage");
  private readonly client = new Client({
    endPoint: ENDPOINT,
    port: PORT,
    useSSL: USE_SSL,
    accessKey: ACCESS_KEY,
    secretKey: SECRET_KEY,
  });
  private ready = false;

  async onModuleInit() {
    try {
      for (const name of Object.values(BUCKETS)) {
        if (!(await this.client.bucketExists(name))) {
          await this.client.makeBucket(name);
          this.log.log(`created bucket ${name}`);
        }
      }
      this.ready = true;
      this.log.log(`MinIO ready: ${ENDPOINT}:${PORT} buckets=${Object.values(BUCKETS).join(",")}`);
    } catch (e) {
      // 不阻塞启动：MinIO 未起时工具调用才报错，与其他外部服务（Qdrant 等）降级策略一致
      this.ready = false;
      this.log.warn(`MinIO 不可达（${ENDPOINT}:${PORT}）：${e instanceof Error ? e.message : e}`);
    }
  }

  private assertReady() {
    if (!this.ready) throw new BadRequestException("对象存储未就绪（MinIO 未启动或不可达）");
  }

  private assertKey(key: string): string {
    const k = (key ?? "").trim();
    if (!k || k.includes("..") || k.startsWith("/") || !KEY_RE.test(k)) {
      throw new BadRequestException(`非法对象 key：${key ?? "(空)"}（不允许 ..、前导 / 与特殊字符）`);
    }
    return k;
  }

  private clampExpiry(expirySec?: number): number {
    const n = Number(expirySec ?? PRESIGN_DEFAULT_S);
    if (!Number.isFinite(n) || n <= 0) return PRESIGN_DEFAULT_S;
    return Math.min(Math.floor(n), PRESIGN_MAX_S);
  }

  async digest(): Promise<{ bucket: string; objects: number; totalBytes: number }> {
    this.assertReady();
    let objects = 0;
    let totalBytes = 0;
    for await (const obj of this.client.listObjectsV2(BUCKET, "", true)) {
      objects += 1;
      totalBytes += obj.size ?? 0;
    }
    return { bucket: BUCKET, objects, totalBytes };
  }

  async list(prefix?: string, maxKeys = 100): Promise<StorageObjectInfo[]> {
    this.assertReady();
    const p = (prefix ?? "").trim();
    if (p.includes("..") || p.startsWith("/")) {
      throw new BadRequestException(`非法前缀：${prefix}`);
    }
    const cap = Math.min(Math.max(1, Number(maxKeys) || 100), 500);
    const out: StorageObjectInfo[] = [];
    for await (const obj of this.client.listObjectsV2(BUCKET, p, true)) {
      if (!obj.name) continue;
      out.push({
        key: obj.name,
        size: obj.size ?? 0,
        lastModified: obj.lastModified?.toISOString?.() ?? "",
      });
      if (out.length >= cap) break;
    }
    return out;
  }

  async putText(key: string, content: string, contentType?: string) {
    this.assertReady();
    const k = this.assertKey(key);
    const body = Buffer.from(String(content ?? ""), "utf8");
    if (body.length === 0) throw new BadRequestException("内容为空");
    if (body.length > MAX_INLINE_BYTES) {
      throw new BadRequestException(
        `内容 ${body.length}B 超过内联上限 ${MAX_INLINE_BYTES}B —— 大文件请用 storage.presignPut 走预签名上传`,
      );
    }
    const meta = { "Content-Type": contentType?.trim() || "text/plain; charset=utf-8" };
    const res = await this.client.putObject(BUCKET, k, body, body.length, meta);
    return { key: k, size: body.length, etag: res.etag ?? "" };
  }

  async getText(key: string): Promise<{ key: string; size: number; content: string }> {
    this.assertReady();
    const k = this.assertKey(key);
    let stat;
    try {
      stat = await this.client.statObject(BUCKET, k);
    } catch (e) {
      if ((e as { code?: string })?.code === "NotFound") {
        throw new NotFoundException(`对象不存在：${k}`);
      }
      throw e;
    }
    if ((stat.size ?? 0) > MAX_INLINE_BYTES) {
      throw new BadRequestException(
        `对象 ${stat.size}B 超过内联上限 ${MAX_INLINE_BYTES}B —— 请用 storage.presignGet 获取下载链接`,
      );
    }
    const stream = await this.client.getObject(BUCKET, k);
    const chunks: Buffer[] = [];
    for await (const c of stream) chunks.push(c as Buffer);
    return { key: k, size: stat.size ?? 0, content: Buffer.concat(chunks).toString("utf8") };
  }

  async presignGet(key: string, expirySec?: number): Promise<{ url: string; expiresIn: number }> {
    this.assertReady();
    const k = this.assertKey(key);
    const exp = this.clampExpiry(expirySec);
    const url = await this.client.presignedGetObject(BUCKET, k, exp);
    return { url, expiresIn: exp };
  }

  async presignPut(key: string, expirySec?: number): Promise<{ url: string; expiresIn: number }> {
    this.assertReady();
    const k = this.assertKey(key);
    const exp = this.clampExpiry(expirySec);
    const url = await this.client.presignedPutObject(BUCKET, k, exp);
    return { url, expiresIn: exp };
  }

  async remove(key: string) {
    this.assertReady();
    const k = this.assertKey(key);
    if (!k.startsWith(REMOVABLE_PREFIX)) {
      throw new BadRequestException(`仅允许删除 ${REMOVABLE_PREFIX}* 前缀的对象（护栏，防误删）`);
    }
    await this.client.removeObject(BUCKET, k);
    return { key: k, removed: true };
  }

  // ── 模块桶内部读写（kb / files）────────────────────────────────
  // 仅供服务端模块调用，不暴露给 AI 工具；无内联上限（上限是给模型上下文的护栏）

  /** 上传 Buffer 到模块桶 */
  async putObject(
    bucket: ModuleBucket,
    key: string,
    body: Buffer,
    contentType?: string,
  ): Promise<{ key: string; size: number }> {
    this.assertReady();
    const k = this.assertKey(key);
    if (body.length === 0) throw new BadRequestException("内容为空");
    const meta = { "Content-Type": contentType?.trim() || "application/octet-stream" };
    await this.client.putObject(BUCKETS[bucket], k, body, body.length, meta);
    return { key: k, size: body.length };
  }

  /** 读取整个对象为 Buffer（仅用于小文件，如 KB 原文） */
  async getObjectBuffer(bucket: ModuleBucket, key: string): Promise<Buffer> {
    this.assertReady();
    const k = this.assertKey(key);
    try {
      const stream = await this.client.getObject(BUCKETS[bucket], k);
      const chunks: Buffer[] = [];
      for await (const c of stream) chunks.push(c as Buffer);
      return Buffer.concat(chunks);
    } catch (e) {
      if ((e as { code?: string })?.code === "NotFound") {
        throw new NotFoundException(`对象不存在：${k}`);
      }
      throw e;
    }
  }

  /** 获取对象流（用于大文件下载透传，不在内存里聚合） */
  async getObjectStream(
    bucket: ModuleBucket,
    key: string,
  ): Promise<{ stream: Readable; size: number }> {
    this.assertReady();
    const k = this.assertKey(key);
    try {
      const stat = await this.client.statObject(BUCKETS[bucket], k);
      const stream = (await this.client.getObject(BUCKETS[bucket], k)) as unknown as Readable;
      return { stream, size: stat.size ?? 0 };
    } catch (e) {
      if ((e as { code?: string })?.code === "NotFound") {
        throw new NotFoundException(`对象不存在：${k}`);
      }
      throw e;
    }
  }

  /** 删除模块桶对象（key 来自服务端 DB 行，不走 AI 护栏前缀） */
  async removeObject(bucket: ModuleBucket, key: string): Promise<void> {
    this.assertReady();
    const k = this.assertKey(key);
    await this.client.removeObject(BUCKETS[bucket], k);
  }
}
