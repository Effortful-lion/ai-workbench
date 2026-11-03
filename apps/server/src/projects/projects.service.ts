import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { and, desc, eq, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import type {
  ProjectDocDetailDto,
  ProjectDocDto,
  ProjectDocInput,
  ProjectDocPatchInput,
  ProjectDto,
  ProjectInput,
  ProjectPatchInput,
  ProjectStatus,
} from "@aiwb/shared";
import { DB, type Db } from "../db/db.module";
import { projectDocs, projects } from "../db/schema";

const MAX_NAME = 40;
const MAX_TITLE = 120;
const MAX_DOC_TITLE = 120;
const MAX_DOC_CHARS = 200_000;

const STATUS_ALIASES: Record<string, ProjectStatus> = {
  active: "active",
  paused: "paused",
  done: "done",
  "进行中": "active",
  "暂停": "paused",
  "完结": "done",
};

function text(v: unknown, max: number): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

/** 项目名即目录名：空白转连字符，去掉首尾标点，只允许字母/数字/中文/._- */
function normalizeName(raw: unknown): string {
  const s = text(raw, MAX_NAME * 2)
    .replace(/\s+/g, "-")
    .replace(/^[-._/]+|[-._/]+$/g, "");
  if (!s) throw new BadRequestException("项目名不能为空");
  if (!/^[A-Za-z0-9\u4e00-\u9fa5._-]+$/.test(s)) {
    throw new BadRequestException("项目名只能包含字母、数字、中文、. _ -");
  }
  return s.slice(0, MAX_NAME);
}

function normalizeStatus(raw: unknown, fallback: ProjectStatus = "active"): ProjectStatus {
  if (raw === undefined || raw === null || raw === "") return fallback;
  const s = String(raw).trim().toLowerCase().replace(/^#/, "");
  const status = STATUS_ALIASES[s];
  if (!status) throw new BadRequestException("status 仅支持 active / paused / done");
  return status;
}

/** 文档标题是文件名：不允许路径分隔符，避免树结构和路径展示错乱 */
function normalizeDocTitle(raw: unknown): string {
  const s = text(raw, MAX_DOC_TITLE * 2)
    .replace(/^\/+/, "")
    .replace(/\/+/g, "-");
  if (!s) throw new BadRequestException("文档名不能为空");
  return s.slice(0, MAX_DOC_TITLE);
}

function normalizeContent(raw: unknown): string {
  const s = typeof raw === "string" ? raw.replace(/\r\n/g, "\n") : "";
  if (s.length > MAX_DOC_CHARS) {
    throw new BadRequestException(`文档过长（>${MAX_DOC_CHARS} 字符），请拆分`);
  }
  return s;
}

@Injectable()
export class ProjectsService {
  constructor(@Inject(DB) private readonly db: Db) {}

  private projectDto(
    row: typeof projects.$inferSelect & { docCount?: number | string },
  ): ProjectDto {
    return {
      id: row.id,
      name: row.name,
      title: row.title,
      status: row.status,
      docCount: Number(row.docCount ?? 0),
      createdAt: row.createdAt.getTime(),
      updatedAt: row.updatedAt.getTime(),
    };
  }

  private docDto(
    row: typeof projectDocs.$inferSelect,
    projectName: string,
  ): ProjectDocDto {
    return {
      id: row.id,
      projectId: row.projectId,
      title: row.title,
      path: `~/projects/${projectName}/${row.title}`,
      size: row.size,
      version: row.version,
      createdAt: row.createdAt.getTime(),
      updatedAt: row.updatedAt.getTime(),
    };
  }

  async list(userId: string): Promise<ProjectDto[]> {
    const rows = await this.db
      .select({
        id: projects.id,
        ownerId: projects.ownerId,
        name: projects.name,
        title: projects.title,
        status: projects.status,
        createdAt: projects.createdAt,
        updatedAt: projects.updatedAt,
        docCount: sql<number>`count(${projectDocs.id})`,
      })
      .from(projects)
      .leftJoin(projectDocs, eq(projectDocs.projectId, projects.id))
      .where(eq(projects.ownerId, userId))
      .groupBy(projects.id)
      .orderBy(desc(projects.updatedAt));
    return rows.map((r) => this.projectDto(r));
  }

  private async owned(projectId: string, userId: string) {
    const [row] = await this.db
      .select()
      .from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.ownerId, userId)));
    if (!row) throw new NotFoundException("项目不存在");
    return row;
  }

  /** 工具入口按项目名定位：兼容 ~/projects/<name> 写法 */
  async findByName(userId: string, name: string) {
    const clean = normalizeName(name.replace(/^~?\/projects\//, ""));
    const [row] = await this.db
      .select()
      .from(projects)
      .where(and(eq(projects.ownerId, userId), eq(projects.name, clean)));
    if (!row) throw new NotFoundException(`项目「${clean}」不存在`);
    return row;
  }

  private async assertNameFree(userId: string, name: string, exceptId?: string) {
    const rows = await this.db
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.ownerId, userId), eq(projects.name, name)));
    if (rows.some((r) => r.id !== exceptId)) throw new BadRequestException("项目名已存在");
  }

  async create(userId: string, input: ProjectInput): Promise<ProjectDto> {
    const name = normalizeName(input?.name);
    const title = text(input?.title, MAX_TITLE);
    const status = normalizeStatus(input?.status);
    await this.assertNameFree(userId, name);

    const now = new Date();
    const row: typeof projects.$inferSelect = {
      id: randomUUID(),
      ownerId: userId,
      name,
      title,
      status,
      createdAt: now,
      updatedAt: now,
    };
    await this.db.insert(projects).values(row);
    return this.projectDto(row);
  }

  async update(projectId: string, userId: string, patch: ProjectPatchInput): Promise<ProjectDto> {
    const current = await this.owned(projectId, userId);

    let name = current.name;
    if (patch?.name !== undefined) {
      name = normalizeName(patch.name);
      await this.assertNameFree(userId, name, projectId);
    }
    const title = patch?.title !== undefined ? text(patch.title, MAX_TITLE) : current.title;
    const status = patch?.status !== undefined ? normalizeStatus(patch.status, current.status) : current.status;

    const updatedAt = new Date();
    await this.db
      .update(projects)
      .set({ name, title, status, updatedAt })
      .where(eq(projects.id, projectId));

    const docCount = await this.db
      .select({ n: sql<number>`count(*)` })
      .from(projectDocs)
      .where(eq(projectDocs.projectId, projectId));
    const [fresh] = await this.db.select().from(projects).where(eq(projects.id, projectId));
    return this.projectDto({ ...fresh, docCount: Number(docCount[0]?.n ?? 0) });
  }

  async remove(projectId: string, userId: string) {
    await this.owned(projectId, userId);
    // project_docs 通过外键级联删除
    await this.db.delete(projects).where(eq(projects.id, projectId));
  }

  private async touch(projectId: string) {
    await this.db.update(projects).set({ updatedAt: new Date() }).where(eq(projects.id, projectId));
  }

  async listDocs(projectId: string, userId: string): Promise<ProjectDocDto[]> {
    const project = await this.owned(projectId, userId);
    const rows = await this.db
      .select()
      .from(projectDocs)
      .where(eq(projectDocs.projectId, projectId))
      .orderBy(desc(projectDocs.updatedAt), desc(projectDocs.createdAt));
    return rows.map((r) => this.docDto(r, project.name));
  }

  private async ownedDoc(projectId: string, docId: string) {
    const [row] = await this.db
      .select()
      .from(projectDocs)
      .where(and(eq(projectDocs.id, docId), eq(projectDocs.projectId, projectId)));
    if (!row) throw new NotFoundException("文档不存在");
    return row;
  }

  async getDoc(projectId: string, docId: string, userId: string): Promise<ProjectDocDetailDto> {
    const project = await this.owned(projectId, userId);
    const row = await this.ownedDoc(projectId, docId);
    return { ...this.docDto(row, project.name), content: row.content };
  }

  private async assertDocTitleFree(projectId: string, title: string, exceptId?: string) {
    const rows = await this.db
      .select({ id: projectDocs.id })
      .from(projectDocs)
      .where(and(eq(projectDocs.projectId, projectId), eq(projectDocs.title, title)));
    if (rows.some((r) => r.id !== exceptId)) throw new BadRequestException("该项目下已存在同名文档");
  }

  async createDoc(
    projectId: string,
    userId: string,
    input: ProjectDocInput,
  ): Promise<ProjectDocDetailDto> {
    const project = await this.owned(projectId, userId);
    const title = normalizeDocTitle(input?.title);
    const content = normalizeContent(input?.content);
    await this.assertDocTitleFree(projectId, title);

    const now = new Date();
    const row: typeof projectDocs.$inferSelect = {
      id: randomUUID(),
      projectId,
      title,
      content,
      size: Buffer.byteLength(content, "utf8"),
      version: 1,
      createdAt: now,
      updatedAt: now,
    };
    await this.db.insert(projectDocs).values(row);
    await this.touch(projectId);
    return { ...this.docDto(row, project.name), content };
  }

  async updateDoc(
    projectId: string,
    docId: string,
    userId: string,
    patch: ProjectDocPatchInput,
  ): Promise<ProjectDocDetailDto> {
    const project = await this.owned(projectId, userId);
    const current = await this.ownedDoc(projectId, docId);

    const title = patch?.title !== undefined ? normalizeDocTitle(patch.title) : current.title;
    if (title !== current.title) await this.assertDocTitleFree(projectId, title, docId);
    const content = patch?.content !== undefined ? normalizeContent(patch.content) : current.content;

    const changed = title !== current.title || content !== current.content;
    const version = changed ? current.version + 1 : current.version;
    const updatedAt = changed ? new Date() : current.updatedAt;

    await this.db
      .update(projectDocs)
      .set({ title, content, size: Buffer.byteLength(content, "utf8"), version, updatedAt })
      .where(eq(projectDocs.id, docId));
    if (changed) await this.touch(projectId);

    const [fresh] = await this.db.select().from(projectDocs).where(eq(projectDocs.id, docId));
    return { ...this.docDto(fresh, project.name), content };
  }

  async removeDoc(projectId: string, docId: string, userId: string) {
    await this.owned(projectId, userId);
    await this.ownedDoc(projectId, docId);
    await this.db.delete(projectDocs).where(eq(projectDocs.id, docId));
    await this.touch(projectId);
  }

  /** AI 工具：按「项目名 + 文档标题」读取正文 */
  async readDocByTitle(userId: string, projectName: string, docTitle: string) {
    const project = await this.findByName(userId, projectName);
    const title = normalizeDocTitle(docTitle);
    const [row] = await this.db
      .select()
      .from(projectDocs)
      .where(and(eq(projectDocs.projectId, project.id), eq(projectDocs.title, title)));
    if (!row) throw new NotFoundException(`项目「${project.name}」下没有文档「${title}」`);
    return { ...this.docDto(row, project.name), content: row.content };
  }

  /** AI 工具：按标题 upsert，便于「把《接口约定.md》归档到 ai-workbench」 */
  async upsertDocByTitle(userId: string, projectName: string, docTitle: string, content: string) {
    const project = await this.findByName(userId, projectName);
    const title = normalizeDocTitle(docTitle);
    const [existing] = await this.db
      .select()
      .from(projectDocs)
      .where(and(eq(projectDocs.projectId, project.id), eq(projectDocs.title, title)));
    if (existing) {
      return this.updateDoc(project.id, existing.id, userId, { content });
    }
    return this.createDoc(project.id, userId, { title, content });
  }
}
