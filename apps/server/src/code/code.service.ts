import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { and, desc, eq, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import type {
  CodeFileDetailDto,
  CodeFileDto,
  CodeFileInput,
  CodeFilePatchInput,
  CodeRepoDto,
  CodeRepoInput,
  CodeRepoPatchInput,
} from "@aiwb/shared";
import { DB, type Db } from "../db/db.module";
import { codeFiles, codeRepos } from "../db/schema";

const MAX_NAME = 40;
const MAX_DESC = 200;
const MAX_PATH = 240;
const MAX_FILE_CHARS = 200_000;

function text(v: unknown, max: number): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

/** 仓库名即目录名：空白转连字符，去掉首尾标点，只允许字母/数字/中文/._- */
function normalizeName(raw: unknown): string {
  const s = text(raw, MAX_NAME * 2)
    .replace(/\s+/g, "-")
    .replace(/^[-._/]+|[-._/]+$/g, "");
  if (!s) throw new BadRequestException("仓库名不能为空");
  if (!/^[A-Za-z0-9\u4e00-\u9fa5._-]+$/.test(s)) {
    throw new BadRequestException("仓库名只能包含字母、数字、中文、. _ -");
  }
  return s.slice(0, MAX_NAME);
}

/** 文件路径：统一斜杠、去掉 ./ 与首尾 /，禁止 .. 段，避免路径穿越式展示 */
function normalizePath(raw: unknown): string {
  let s = text(raw, MAX_PATH * 2)
    .replace(/\\/g, "/")
    .replace(/\/+/g, "/")
    .replace(/^\.?\//, "")
    .replace(/^\/+/, "");
  if (!s) throw new BadRequestException("文件路径不能为空");
  if (s.split("/").some((seg) => seg === "." || seg === "..")) {
    throw new BadRequestException("文件路径不能包含 . 或 .. 段");
  }
  return s.slice(0, MAX_PATH);
}

function normalizeContent(raw: unknown): string {
  const s = typeof raw === "string" ? raw.replace(/\r\n/g, "\n") : "";
  if (s.length > MAX_FILE_CHARS) {
    throw new BadRequestException(`文件过大（>${MAX_FILE_CHARS} 字符），请拆分`);
  }
  return s;
}

@Injectable()
export class CodeService {
  constructor(@Inject(DB) private readonly db: Db) {}

  private repoDto(
    row: typeof codeRepos.$inferSelect & { fileCount?: number | string; sizeBytes?: number | string },
  ): CodeRepoDto {
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      language: row.language,
      branch: row.branch,
      fileCount: Number(row.fileCount ?? 0),
      sizeBytes: Number(row.sizeBytes ?? 0),
      createdAt: row.createdAt.getTime(),
      updatedAt: row.updatedAt.getTime(),
    };
  }

  private fileDto(row: typeof codeFiles.$inferSelect): CodeFileDto {
    return {
      id: row.id,
      repoId: row.repoId,
      path: row.path,
      size: row.size,
      createdAt: row.createdAt.getTime(),
      updatedAt: row.updatedAt.getTime(),
    };
  }

  async listRepos(userId: string): Promise<CodeRepoDto[]> {
    const rows = await this.db
      .select({
        id: codeRepos.id,
        ownerId: codeRepos.ownerId,
        name: codeRepos.name,
        description: codeRepos.description,
        language: codeRepos.language,
        branch: codeRepos.branch,
        createdAt: codeRepos.createdAt,
        updatedAt: codeRepos.updatedAt,
        fileCount: sql<number>`count(${codeFiles.id})`,
        sizeBytes: sql<number>`coalesce(sum(${codeFiles.size}), 0)`,
      })
      .from(codeRepos)
      .leftJoin(codeFiles, eq(codeFiles.repoId, codeRepos.id))
      .where(eq(codeRepos.ownerId, userId))
      .groupBy(codeRepos.id)
      .orderBy(desc(codeRepos.updatedAt));
    return rows.map((r) => this.repoDto(r));
  }

  private async owned(repoId: string, userId: string) {
    const [row] = await this.db
      .select()
      .from(codeRepos)
      .where(and(eq(codeRepos.id, repoId), eq(codeRepos.ownerId, userId)));
    if (!row) throw new NotFoundException("仓库不存在");
    return row;
  }

  async findByRepoName(userId: string, name: string) {
    const clean = normalizeName(name.replace(/^~?\/code\//, ""));
    const [row] = await this.db
      .select()
      .from(codeRepos)
      .where(and(eq(codeRepos.ownerId, userId), eq(codeRepos.name, clean)));
    if (!row) throw new NotFoundException(`仓库「${clean}」不存在`);
    return row;
  }

  private async assertNameFree(userId: string, name: string, exceptId?: string) {
    const rows = await this.db
      .select({ id: codeRepos.id })
      .from(codeRepos)
      .where(and(eq(codeRepos.ownerId, userId), eq(codeRepos.name, name)));
    if (rows.some((r) => r.id !== exceptId)) throw new BadRequestException("仓库名已存在");
  }

  async createRepo(userId: string, input: CodeRepoInput): Promise<CodeRepoDto> {
    const name = normalizeName(input?.name);
    await this.assertNameFree(userId, name);
    const now = new Date();
    const row: typeof codeRepos.$inferSelect = {
      id: randomUUID(),
      ownerId: userId,
      name,
      description: text(input?.description, MAX_DESC),
      language: text(input?.language, 24).toLowerCase() || "text",
      branch: text(input?.branch, 40) || "main",
      createdAt: now,
      updatedAt: now,
    };
    await this.db.insert(codeRepos).values(row);
    return this.repoDto(row);
  }

  async updateRepo(repoId: string, userId: string, patch: CodeRepoPatchInput): Promise<CodeRepoDto> {
    const current = await this.owned(repoId, userId);

    let name = current.name;
    if (patch?.name !== undefined) {
      name = normalizeName(patch.name);
      await this.assertNameFree(userId, name, repoId);
    }
    const description =
      patch?.description !== undefined ? text(patch.description, MAX_DESC) : current.description;
    const language =
      patch?.language !== undefined
        ? text(patch.language, 24).toLowerCase() || current.language
        : current.language;
    const branch =
      patch?.branch !== undefined ? text(patch.branch, 40) || current.branch : current.branch;

    await this.db
      .update(codeRepos)
      .set({ name, description, language, branch, updatedAt: new Date() })
      .where(eq(codeRepos.id, repoId));

    const [agg] = await this.db
      .select({
        fileCount: sql<number>`count(${codeFiles.id})`,
        sizeBytes: sql<number>`coalesce(sum(${codeFiles.size}), 0)`,
      })
      .from(codeFiles)
      .where(eq(codeFiles.repoId, repoId));
    const [fresh] = await this.db.select().from(codeRepos).where(eq(codeRepos.id, repoId));
    return this.repoDto({ ...fresh, ...agg });
  }

  async removeRepo(repoId: string, userId: string) {
    await this.owned(repoId, userId);
    // code_files 通过外键级联删除
    await this.db.delete(codeRepos).where(eq(codeRepos.id, repoId));
  }

  private async touch(repoId: string) {
    await this.db.update(codeRepos).set({ updatedAt: new Date() }).where(eq(codeRepos.id, repoId));
  }

  async listFiles(repoId: string, userId: string): Promise<CodeFileDto[]> {
    await this.owned(repoId, userId);
    const rows = await this.db
      .select()
      .from(codeFiles)
      .where(eq(codeFiles.repoId, repoId))
      .orderBy(codeFiles.path);
    return rows.map((r) => this.fileDto(r));
  }

  private async ownedFile(repoId: string, fileId: string) {
    const [row] = await this.db
      .select()
      .from(codeFiles)
      .where(and(eq(codeFiles.id, fileId), eq(codeFiles.repoId, repoId)));
    if (!row) throw new NotFoundException("文件不存在");
    return row;
  }

  async getFile(repoId: string, fileId: string, userId: string): Promise<CodeFileDetailDto> {
    await this.owned(repoId, userId);
    const row = await this.ownedFile(repoId, fileId);
    return { ...this.fileDto(row), content: row.content };
  }

  private async assertPathFree(repoId: string, path: string, exceptId?: string) {
    const rows = await this.db
      .select({ id: codeFiles.id })
      .from(codeFiles)
      .where(and(eq(codeFiles.repoId, repoId), eq(codeFiles.path, path)));
    if (rows.some((r) => r.id !== exceptId)) throw new BadRequestException("该仓库下已存在同名文件");
  }

  async createFile(
    repoId: string,
    userId: string,
    input: CodeFileInput,
  ): Promise<CodeFileDetailDto> {
    await this.owned(repoId, userId);
    const path = normalizePath(input?.path);
    const content = normalizeContent(input?.content);
    await this.assertPathFree(repoId, path);

    const now = new Date();
    const row: typeof codeFiles.$inferSelect = {
      id: randomUUID(),
      repoId,
      path,
      content,
      size: Buffer.byteLength(content, "utf8"),
      createdAt: now,
      updatedAt: now,
    };
    await this.db.insert(codeFiles).values(row);
    await this.touch(repoId);
    return { ...this.fileDto(row), content };
  }

  async updateFile(
    repoId: string,
    fileId: string,
    userId: string,
    patch: CodeFilePatchInput,
  ): Promise<CodeFileDetailDto> {
    await this.owned(repoId, userId);
    const current = await this.ownedFile(repoId, fileId);

    const path = patch?.path !== undefined ? normalizePath(patch.path) : current.path;
    if (path !== current.path) await this.assertPathFree(repoId, path, fileId);
    const content = patch?.content !== undefined ? normalizeContent(patch.content) : current.content;

    const changed = path !== current.path || content !== current.content;
    await this.db
      .update(codeFiles)
      .set({
        path,
        content,
        size: Buffer.byteLength(content, "utf8"),
        updatedAt: changed ? new Date() : current.updatedAt,
      })
      .where(eq(codeFiles.id, fileId));
    if (changed) await this.touch(repoId);

    const [fresh] = await this.db.select().from(codeFiles).where(eq(codeFiles.id, fileId));
    return { ...this.fileDto(fresh), content };
  }

  async removeFile(repoId: string, fileId: string, userId: string) {
    await this.owned(repoId, userId);
    await this.ownedFile(repoId, fileId);
    await this.db.delete(codeFiles).where(eq(codeFiles.id, fileId));
    await this.touch(repoId);
  }

  /** AI 工具：按仓库名 + 路径读取文件正文 */
  async readFileByPath(userId: string, repoName: string, path: string) {
    const repo = await this.findByRepoName(userId, repoName);
    const clean = normalizePath(path);
    const [row] = await this.db
      .select()
      .from(codeFiles)
      .where(and(eq(codeFiles.repoId, repo.id), eq(codeFiles.path, clean)));
    if (!row) throw new NotFoundException(`仓库「${repo.name}」下没有文件「${clean}」`);
    return { ...this.fileDto(row), content: row.content };
  }

  /** AI 工具：按路径 upsert，便于「把这段实现写进 ai-workbench 的 src/main.ts」 */
  async upsertFileByPath(userId: string, repoName: string, path: string, content: string) {
    const repo = await this.findByRepoName(userId, repoName);
    const clean = normalizePath(path);
    const [existing] = await this.db
      .select()
      .from(codeFiles)
      .where(and(eq(codeFiles.repoId, repo.id), eq(codeFiles.path, clean)));
    if (existing) {
      return this.updateFile(repo.id, existing.id, userId, { content });
    }
    return this.createFile(repo.id, userId, { path: clean, content });
  }
}
