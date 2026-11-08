import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { eq } from "drizzle-orm";
import {
  hasPermission,
  type ResumeBasics,
  type ResumeDto,
  type ResumeEducation,
  type ResumeExperience,
  type ResumeImportResult,
  type ResumeProfile,
  type ResumeProject,
  type ResumeSkillGroup,
  type Role,
} from "@aiwb/shared";
import { DB, type Db } from "../db/db.module";
import { users } from "../db/schema";
import { MAX_IMPORT_CHARS, parseResumeText } from "./resume.parser";

/** profile_json 里的档案卡信封：保留扩展位，避免以后其他个人资料与简历混在一起 */
interface ProfileBox {
  resume?: unknown;
  resumeUpdatedAt?: unknown;
}

const MAX_JSON_CHARS = 30_000;

function text(v: unknown, max: number): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

function items(v: unknown, max: number): unknown[] {
  return Array.isArray(v) ? v.slice(0, max) : [];
}

/** 边界校验：外部输入一律收敛到协议形状，避免脏 JSON 污染 profile_json */
function normalizeProfile(raw: unknown, fallbackName: string): ResumeProfile {
  const p = (raw ?? {}) as Partial<ResumeProfile>;
  const b = (p.basics ?? {}) as Partial<ResumeBasics>;

  const basics: ResumeBasics = {
    name: text(b.name, 60) || fallbackName,
    headline: text(b.headline, 120),
    location: text(b.location, 80),
    experienceYears: text(b.experienceYears, 40),
    status: text(b.status, 60),
    summary: text(b.summary, 2000),
    email: text(b.email, 120),
    website: text(b.website, 200),
  };

  const experience: ResumeExperience[] = items(p.experience, 20)
    .map((it) => {
      const e = (it ?? {}) as Partial<ResumeExperience>;
      return {
        period: text(e.period, 60),
        company: text(e.company, 80),
        role: text(e.role, 80),
        highlights: items(e.highlights, 12)
          .map((h) => text(h, 300))
          .filter(Boolean),
      };
    })
    .filter((e) => e.company || e.role || e.period);

  const skills: ResumeSkillGroup[] = items(p.skills, 12)
    .map((it) => {
      const s = (it ?? {}) as Partial<ResumeSkillGroup>;
      return {
        group: text(s.group, 40),
        items: items(s.items, 20)
          .map((v) => text(v, 40))
          .filter(Boolean),
      };
    })
    .filter((s) => s.group && s.items.length > 0);

  const projects: ResumeProject[] = items(p.projects, 20)
    .map((it) => {
      const pr = (it ?? {}) as Partial<ResumeProject>;
      return {
        name: text(pr.name, 80),
        role: text(pr.role, 60),
        period: text(pr.period, 60),
        desc: text(pr.desc, 300),
        url: text(pr.url, 300),
        tags: items(pr.tags, 10)
          .map((t) => text(t, 40))
          .filter(Boolean),
      };
    })
    .filter((pr) => pr.name || pr.role || pr.desc);

  const education: ResumeEducation[] = items(p.education, 10)
    .map((it) => {
      const ed = (it ?? {}) as Partial<ResumeEducation> & { GPA?: unknown; score?: unknown };
      return {
        period: text(ed.period, 60),
        school: text(ed.school, 80),
        major: text(ed.major, 80),
        degree: text(ed.degree, 40),
        // 兼容手写 JSON 时常见的 GPA / score 两种写法
        gpa: text(ed.gpa ?? ed.GPA ?? ed.score, 40),
      };
    })
    .filter((ed) => ed.school || ed.gpa || ed.major || ed.degree);

  return { basics, experience, education, skills, projects };
}

function emptyProfile(username: string): ResumeProfile {
  return {
    basics: {
      name: username,
      headline: "",
      location: "",
      experienceYears: "",
      status: "",
      summary: "",
      email: "",
      website: "",
    },
    experience: [],
    education: [],
    skills: [],
    projects: [],
  };
}

@Injectable()
export class ResumeService {
  constructor(@Inject(DB) private readonly db: Db) {}

  private box(row: typeof users.$inferSelect): ProfileBox {
    return (row.profileJson ?? {}) as ProfileBox;
  }

  private toDto(row: typeof users.$inferSelect, canEdit: boolean): ResumeDto {
    const box = this.box(row);
    const hasResume = box.resume !== undefined && box.resume !== null;
    return {
      username: row.username,
      canEdit,
      profile: hasResume ? normalizeProfile(box.resume, row.username) : emptyProfile(row.username),
      updatedAt:
        hasResume && typeof box.resumeUpdatedAt === "number" ? box.resumeUpdatedAt : null,
    };
  }

  /** 本人档案：owner 可编辑，member 只读（与角色权限 me:write 一致） */
  async getOwn(user: { id: string; role: Role }): Promise<ResumeDto> {
    const [row] = await this.db.select().from(users).where(eq(users.id, user.id));
    if (!row) throw new NotFoundException("用户不存在");
    return this.toDto(row, hasPermission(user.role, "me:write"));
  }

  /** 游客公开只读：只暴露档案卡本身，不含任何账号字段 */
  async getPublic(username: string): Promise<ResumeDto> {
    const [row] = await this.db.select().from(users).where(eq(users.username, username));
    if (!row) throw new NotFoundException("用户不存在");
    if (this.box(row).resume === undefined || this.box(row).resume === null) {
      throw new NotFoundException("该用户尚未填写公开简历");
    }
    return this.toDto(row, false);
  }

  /** 解析导入文本为档案卡（不落库，由前端确认后调用 update 写入） */
  parseImport(
    raw: string,
    source: ResumeImportResult["source"],
    fallbackName: string,
  ): ResumeImportResult {
    const text = raw.replace(/\r\n?/g, "\n").slice(0, MAX_IMPORT_CHARS);
    if (!text.trim()) throw new BadRequestException("没有可解析的文本内容");

    const profile = normalizeProfile(parseResumeText(text, fallbackName), fallbackName);
    const hasBody =
      profile.basics.headline ||
      profile.basics.summary ||
      profile.experience.length > 0 ||
      profile.education.length > 0 ||
      profile.skills.length > 0 ||
      profile.projects.length > 0;
    if (!hasBody) {
      throw new BadRequestException(
        "没解析出可用内容：请确认文本包含章节标题（如「工作经历」「项目经历」「教育经历」），或改用编辑 profile.json",
      );
    }
    return { source, chars: text.length, profile };
  }

  async update(userId: string, input: unknown): Promise<ResumeDto> {
    const profile = (input as { profile?: unknown } | null)?.profile;
    if (!profile || typeof profile !== "object" || Array.isArray(profile)) {
      throw new BadRequestException("profile 必须是对象");
    }
    const json = JSON.stringify(profile);
    if (json.length > MAX_JSON_CHARS) {
      throw new BadRequestException(`档案过大（>${MAX_JSON_CHARS} 字符），请精简后保存`);
    }

    const [row] = await this.db.select().from(users).where(eq(users.id, userId));
    if (!row) throw new NotFoundException("用户不存在");

    const normalized = normalizeProfile(profile, row.username);
    const nextBox: ProfileBox = { ...this.box(row), resume: normalized, resumeUpdatedAt: Date.now() };
    await this.db
      .update(users)
      .set({ profileJson: nextBox as Record<string, unknown> })
      .where(eq(users.id, userId));

    return this.toDto({ ...row, profileJson: nextBox as Record<string, unknown> }, true);
  }
}
