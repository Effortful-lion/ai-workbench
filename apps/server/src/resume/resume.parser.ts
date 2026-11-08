import type {
  ResumeBasics,
  ResumeEducation,
  ResumeExperience,
  ResumeProfile,
  ResumeProject,
  ResumeSkillGroup,
} from "@aiwb/shared";

/** 导入文本上限：超出部分直接丢弃，避免一份超长 PDF 拖垮解析 */
export const MAX_IMPORT_CHARS = 80_000;

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const PHONE_RE = /(?:\+?86[-\s]?)?1[3-9]\d{9}/;
const URL_RE = /(?:https?:\/\/|www\.)[^\s，、；;）)】\]]+/i;
const DATE_RE = String.raw`(?:19|20)\d{2}(?:[./\-年]\s*(?:1[0-2]|0?[1-9])月?)?(?![0-9])`;
const PERIOD_RE = new RegExp(
  `${DATE_RE}\\s*(?:[-–—~～至到]|to)\\s*(?:${DATE_RE}|至今|现在|present|now|今)`,
  "i",
);
const BULLET_RE = /^\s*(?:[-•·●○◆◇▪▫*]|\(?[0-9]{1,2}[.)、])\s+/;
/** 句末标点：用于判断一行是否被视觉换行截断 */
const TERMINAL_RE = /[。；;！？!?]$/;
/** 以这类词开头的行是正文描述，永远不能当条目标题（如「职责：…」「负责…」） */
const LABEL_START_RE = /^(?:职责|工作内容|工作描述|岗位职责|职位描述|项目描述|项目职责|主要负责|负责|参与|主导|成就|业绩)/;
const OPEN_BRACKETS = "（([【";
const CLOSE_BRACKETS = "）)]】";
const COMPANY_RE = /(?:公司|集团|科技|信息|网络|软件|数据|智能|传媒|银行|证券|Inc\.?|Ltd\.?|LLC|Corp\.?|Group|Technolog)/i;
const ROLE_RE = /(?:工程师|架构师|经理|总监|主管|专家|设计师|分析师|顾问|负责人|组长|实习生|Leader|Engineer|Manager|Designer|Analyst|Director)/i;
const SCHOOL_RE = /(?:大学|学院|学校|中学|University|College|Institute|School)/i;
const DEGREE_RE = /(?:博士|硕士|研究生|本科|学士|大专|专科|MBA|PhD|Master|Bachelor)/i;
const GPA_RE = /GPA\s*[:：]?\s*([\d.]+\s*(?:\s*\/\s*[\d.]+)?)/i;

type Section = "intro" | "experience" | "projects" | "skills" | "summary" | "education";

/** 章节标题：整行匹配，允许 # / ** / - 前缀与冒号结尾 */
const SECTION_RULES: Array<[Section, RegExp]> = [
  ["experience", /^(?:工作经历|工作经验|职业经历|工作履历|职业履历|实习经历|实习经验|工作与项目经历|校园经历|社会实践|work\s*experience|experience|employment)$/i],
  ["projects", /^(?:项目经历|项目经验|项目实践|项目作品|作品集|主要项目|projects?|project\s*experience)$/i],
  ["skills", /^(?:专业技能|技能清单|技能特长|技术栈|技术能力|专业能力|核心技能|能力标签|个人技能|skills?|technical\s*skills)$/i],
  // 荣誉/证书/语言类没有独立结构，按技能组解析，至少不让标题掉进上一章节当内容
  ["skills", /^(?:荣誉奖项|获奖情况|获奖经历|荣誉证书|奖项荣誉|奖项|证书|技能证书|语言能力|外语水平|语言|兴趣爱好|awards?|honors?|certificates?|languages?|interests?)$/i],
  ["summary", /^(?:个人简介|自我介绍|自我评价|个人评价|自我描述|个人总结|个人优势|个人亮点|关于我|summary|about\s*me|profile)$/i],
  ["education", /^(?:教育经历|教育背景|学习经历|学历|education|educational\s*background)$/i],
];

function stripMarkdown(line: string): string {
  return line
    .replace(/^\s*(?:#+|>)\s*/, "")
    .replace(/^[\s\-*]*\*\*(.*)\*\*\s*$/, "$1")
    .replace(/[：:]\s*$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** 章节标题归一化：去掉编号（「一、」「1.」「（2）」）、装饰符号与尾部括号说明。
 *  PDF/Word 里的标题常写成「一、工作经历」「1. 项目经历（重点）」或中英双语「工作经历 / Work Experience」。 */
function normalizeHeading(line: string): string {
  return stripMarkdown(line)
    .replace(
      /^[\s　]*(?:[一二三四五六七八九十]+[、.．]|[（(]\s*[0-9一二三四五六七八九十]{1,2}\s*[）)]|[0-9]{1,2}\s*[、.．)）])\s*/,
      "",
    )
    .replace(/^[-–—=*·▍◆■]+[\s　]*/, "")
    .replace(/[（(][^）)]*[）)]\s*$/, "")
    .replace(/[\s　]+/g, " ")
    .trim();
}

function sectionOf(line: string): Section | null {
  const t = normalizeHeading(line);
  if (!t || t.length > 32) return null;
  // 中英双语标题按分隔符拆开逐个匹配
  for (const variant of t.split(/\s*[/|｜]\s*/)) {
    const v = variant.trim();
    if (!v) continue;
    for (const [key, re] of SECTION_RULES) if (re.test(v)) return key;
  }
  return null;
}

function stripBullet(line: string): string {
  return line.replace(BULLET_RE, "").replace(/^\s+/g, "").trim();
}

function clip(v: string, max: number): string {
  return v.trim().slice(0, max);
}

/** 同一行里多个「标签：值」时，只取第一段值（如「现居：杭州  求职意向：前端」） */
function firstField(v: string): string {
  return v.split(/\s{2,}|\t|\s*[|｜·]\s*/)[0]?.trim() ?? "";
}

/** 按分隔符切技能项，但括号（全/半角）内的分隔符不切，避免「并发编程(goroutine、锁等)」被切碎 */
function splitItems(raw: string): string[] {
  const parts: string[] = [];
  let cur = "";
  let depth = 0;
  for (const ch of raw) {
    if (OPEN_BRACKETS.includes(ch)) depth += 1;
    else if (CLOSE_BRACKETS.includes(ch)) depth = Math.max(0, depth - 1);
    if (depth === 0 && /[、,，;；/／|]/.test(ch)) {
      parts.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  parts.push(cur);
  return parts
    .map((s) => s.replace(/^[\s\-•·]+/, "").trim())
    .filter((s) => s.length > 0)
    .map((s) => clip(s, 60))
    .slice(0, 20);
}

/** 上一行是否明显没写完：结尾是连接性标点，或有未闭合括号（PDF 在括号内换行很常见） */
function needsContinuation(prev: string): boolean {
  const t = prev.trimEnd();
  if (!t) return false;
  if (/[、，,；;：:/／|]$/.test(t)) return true;
  let depth = 0;
  for (const ch of t) {
    if (OPEN_BRACKETS.includes(ch)) depth += 1;
    else if (CLOSE_BRACKETS.includes(ch)) depth = Math.max(0, depth - 1);
  }
  return depth > 0;
}

/** 拼接被截断的两行：任一端是 CJK/中文标点则直拼，否则补空格（英文单词间） */
function smartJoin(a: string, b: string): string {
  if (!a) return b;
  const cjkSide =
    /[\u4e00-\u9fa5，、。；：（）【】]$/.test(a) || /^[\u4e00-\u9fa5，、。；：（）【】]/.test(b);
  return cjkSide ? a + b : `${a} ${b}`;
}

/** 把一行头部（公司/职位/时间混合）切成字段 */
function splitFields(line: string, period: string): string[] {
  let s = period ? line.replace(period, " ") : line;
  s = s.replace(/[|｜]/g, "  ").replace(/[·•]/g, "  ");
  const hasWideGap = /\s{2,}|\t/.test(s);
  const parts = s
    .split(/\s{2,}|\t/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (hasWideGap || parts.length > 1) return parts;
  // 没有双空格分隔时（「字节跳动 2021-2022 前端工程师」），退化为单空格切分
  return s.trim().split(/\s+/).filter(Boolean);
}

function looksLikeEntryHeader(line: string): boolean {
  if (line.length > 60) return false;
  if (/[。；;]$/.test(line)) return false;
  // 含冒号的行是「标签：正文」（如「存储数据：设计…」），不是公司/职位标题
  if (/[：:]/.test(line)) return false;
  return COMPANY_RE.test(line) || (ROLE_RE.test(line) && line.length <= 40);
}

function extractPeriod(line: string): string {
  return clip((line.match(PERIOD_RE)?.[0] ?? "").replace(/\s+/g, " "), 60);
}

interface RawEntry {
  header: string;
  period: string;
  body: string[];
}

/** 视觉换行截断的宽度下限：正文行几乎撑满才可能是被截断；短行（如「Go开发实习生」）是完整行 */
const MIN_WRAP_WIDTH = 20;
/** 「短标签：正文」开头（如「技术栈：Go」「存储数据：设计…」），bullet 丢失时新一条的强信号 */
const LABEL_LINE_RE = /^[^\s：:，。、；;]{2,18}[：:]/;
/** 动词开头（负责/实现/设计…）：简历 bullet 的典型写法，同样是新一条的信号 */
const VERB_START_RE = /^(?:负责|参与|主导|使用|基于|实现|独立|设计|开发|构建|搭建|采用|引入|完成|优化)/;

/** 章节内按「有日期 / 像条目标题」切条目；其余行归入上一条目正文。
 *  PDF 抽取按视觉行硬换行，一条长描述常被切成多行：非 bullet、非日期、
 *  且上一条正文明显没写完（宽行却无句末标点，或括号/连接符未收尾）时，
 *  优先拼回上一条——续行判断必须先于标题判断，否则碎片会被误认成新条目标题。
 *  但「标签：…」或动词开头的行是新一条的信号（bullet 丢失时兜底），不拼。 */
function buildEntries(lines: string[], acceptHeader: (line: string) => boolean): RawEntry[] {
  const isHeader = (line: string) => acceptHeader(line) && !LABEL_START_RE.test(line);
  const startsNewItem = (line: string) => LABEL_LINE_RE.test(line) || VERB_START_RE.test(line);
  const out: RawEntry[] = [];
  for (const raw of lines) {
    const line = stripBullet(raw);
    if (!line) continue;
    const hasPeriod = PERIOD_RE.test(line);
    const isBullet = BULLET_RE.test(raw) || /^\s{2,}/.test(raw);
    if (!out.length) {
      // 章节第一行不是标题也先开条目，避免首条内容被整段丢弃（解析「内容不完整」的主因）
      out.push({
        header: hasPeriod || isHeader(line) ? line : "",
        period: extractPeriod(line),
        body: hasPeriod || isHeader(line) ? [] : [line],
      });
      continue;
    }
    const entry = out[out.length - 1];
    const body = entry.body;
    const prev = body[body.length - 1];
    const prevUnfinished =
      prev !== undefined &&
      (needsContinuation(prev) || (prev.trimEnd().length >= MIN_WRAP_WIDTH && !TERMINAL_RE.test(prev)));
    if (!isBullet && !hasPeriod && prevUnfinished && !startsNewItem(line)) {
      body[body.length - 1] = smartJoin(prev as string, line);
      continue;
    }
    // 无日期的「标题行」只有在上一条已有正文时才开新条目；
    // 否则它是上一条头部信息的延续（如「Go开发实习生」跟在日期行后面）
    if (hasPeriod || (!isBullet && isHeader(line) && body.length > 0)) {
      out.push({ header: line, period: extractPeriod(line), body: [] });
    } else {
      body.push(line);
    }
  }
  return out;
}

function parseExperience(lines: string[]): ResumeExperience[] {
  return buildEntries(lines, looksLikeEntryHeader)
    .map((e) => {
      const parts = splitFields(e.header, e.period);
      const body = [...e.body];
      let role = parts.find((p) => ROLE_RE.test(p) && !COMPANY_RE.test(p)) ?? "";
      let company = parts.find((p) => COMPANY_RE.test(p) && p !== role) ?? "";
      if (!role) role = parts.find((p) => p !== company && ROLE_RE.test(p)) ?? "";
      if (!company) company = parts.find((p) => p !== role) ?? "";

      // 头部缺公司/职位时，把正文第一行（如「Go开发实习生」）提上来
      if (!role && body.length > 0 && ROLE_RE.test(body[0]) && !COMPANY_RE.test(body[0])) {
        role = body.shift() as string;
      }
      if (!company && body.length > 0 && COMPANY_RE.test(body[0])) {
        company = body.shift() as string;
      }
      // 完全没有头部信息（首行就是描述）时，用首个短行充当职位/公司，保住这条经历
      if (!company && !role && body.length > 0) {
        const first = body[0];
        if (first.length <= 40) {
          company = body.shift() as string;
        }
      }

      return {
        period: e.period,
        company: clip(company, 80),
        role: clip(role, 80),
        highlights: body.map((h) => clip(h, 300)).filter(Boolean).slice(0, 12),
      };
    })
    .filter((e) => e.company || e.role || e.period || e.highlights.length > 0)
    .slice(0, 20);
}

function parseProjects(lines: string[]): ResumeProject[] {
  const entries = buildEntries(lines, (line) => {
    if (line.length > 60) return false;
    if (/^(?:负责|参与|主导|使用|基于|实现|独立)/.test(line)) return false;
    if (/[：:]/.test(line)) return false;
    return !/[。；;]$/.test(line);
  });
  return entries
    .map((e) => {
      const parts = splitFields(e.header, e.period);
      const name = clip(parts[0] ?? e.header, 80);
      const body = [...e.body];
      // 项目里的「技术负责人 / 项目负责人」等价于工作经历的岗位，提到标题行
      let role = parts.find((p) => p !== name && p.length <= 20 && ROLE_RE.test(p)) ?? "";
      if (!role && body.length > 0 && body[0].length <= 20 && ROLE_RE.test(body[0])) {
        role = body.shift() as string;
      }
      const inline = clip(parts.filter((p) => p !== name && p !== role).join(" · "), 120);
      const bodyText = body.join("；");
      const url = (e.header.match(URL_RE) ?? e.body.join(" ").match(URL_RE))?.[0] ?? "";
      let desc = [inline, bodyText].filter(Boolean).join("；").replace(URL_RE, "").trim();
      // 去掉紧跟在描述后面的多余分隔符
      desc = desc.replace(/[·\-—|｜]\s*$/g, "").replace(/^\s*[·\-—|｜]\s*/g, "");
      return {
        name,
        role: clip(role, 60),
        period: clip(e.period, 60),
        desc: clip(desc, 300),
        url: clip(url, 300),
        tags: [],
      };
    })
    .filter((p) => p.name || p.role || p.desc)
    .slice(0, 20);
}

function parseSkills(lines: string[]): ResumeSkillGroup[] {
  const groups: ResumeSkillGroup[] = [];
  const push = (group: string, items: string[]) => {
    if (!group || items.length === 0) return;
    const exist = groups.find((g) => g.group === group);
    if (exist) {
      exist.items = [...new Set([...exist.items, ...items])].slice(0, 20);
    } else if (groups.length < 12) {
      groups.push({ group: clip(group, 40), items });
    }
  };

  // 技能行常在括号或顿号处被 PDF 截断，先把「明显没写完」的续行拼回去
  const merged: string[] = [];
  for (const raw of lines) {
    const prev = merged[merged.length - 1];
    if (prev !== undefined && !BULLET_RE.test(raw) && needsContinuation(prev)) {
      merged[merged.length - 1] = smartJoin(prev, raw.trim());
    } else {
      merged.push(raw);
    }
  }

  for (const raw of merged) {
    const line = stripBullet(raw);
    if (!line) continue;
    const m = line.match(/^([^：:]{1,20})[：:]\s*(.+)$/);
    if (m) push(m[1].trim(), splitItems(m[2]));
    else push("技能", splitItems(line));
  }
  return groups;
}

function parseEducation(lines: string[]): ResumeEducation[] {
  // 只有学校名能开新条目；「软件工程 · 相关课程… · 本科」这类学位/专业行归入上一条正文
  return buildEntries(lines, (line) => SCHOOL_RE.test(line))
    .map((e) => {
      const parts = splitFields(e.header, e.period);
      const body = [...e.body];
      let school = parts.find((p) => SCHOOL_RE.test(p)) ?? parts[0] ?? "";
      const degree =
        parts.find((p) => DEGREE_RE.test(p)) ?? e.body.join(" ").match(DEGREE_RE)?.[0] ?? "";
      // 头部为空（首行是学位/专业）时，把正文里的学校名或首个短行提上来
      if (!school) {
        const idx = body.findIndex((l) => SCHOOL_RE.test(l));
        school = idx >= 0 ? body.splice(idx, 1)[0] : (body.shift() ?? "");
      }
      const major = clip(
        parts.filter((p) => p !== school && p !== degree).join(" · ") || body.join(" · "),
        80,
      );
      // GPA 常跟在教育行尾或被 PDF 拆成独立行，单独成字段而不是混进专业描述
      const gpa = clip(
        ([e.header, ...e.body].join(" ").match(GPA_RE)?.[1] ?? "").replace(/\s+/g, ""),
        40,
      );
      return {
        period: e.period,
        school: clip(school, 80),
        major,
        degree: clip(degree, 40),
        gpa,
      };
    })
    .filter((e) => e.school || e.gpa || e.major || e.degree)
    .slice(0, 10);
}

function pickBasics(intro: string[], summaryLines: string[], fallbackName: string): ResumeBasics {
  const text = intro.join("\n");
  const findLabeled = (re: RegExp): string => {
    for (const line of [...intro, ...summaryLines]) {
      const m = line.match(re);
      if (m) return clip(firstField(m[1]), 200);
    }
    return "";
  };

  const email = (text.match(EMAIL_RE) ?? [""])[0];
  const phone = (text.match(PHONE_RE) ?? [""])[0];
  const website = findLabeled(/(?:个人网站|网站|博客|主页|github|GitHub|website|blog)\s*[:：]\s*(.+)$/i)
    || (text.match(URL_RE) ?? [""])[0];

  let name = findLabeled(/(?:姓名|Name)\s*[:：]\s*(.+)$/i);
  if (!name) {
    name =
      intro
        .map(stripBullet)
        .find((s) => {
          if (!s || s.length > 24) return false;
          if (/[@:/\\|]/.test(s) || EMAIL_RE.test(s) || PHONE_RE.test(s) || URL_RE.test(s)) return false;
          if (PERIOD_RE.test(s)) return false;
          return /^[\u4e00-\u9fa5]{2,4}$/.test(s) || /^[A-Za-z]+(?:\s+[A-Za-z]+){1,2}$/.test(s);
        }) ?? "";
  }

  let headline = findLabeled(/(?:求职意向|意向岗位|目标岗位|目标职位|应聘岗位|职位|title|headline)\s*[:：]\s*(.+)$/i);
  if (!headline) {
    headline =
      intro
        .map(stripBullet)
        .find((s) => s && s.length <= 60 && ROLE_RE.test(s) && !COMPANY_RE.test(s)) ?? "";
  }

  const location = findLabeled(/(?:现居|所在地|所在城市|城市|地址|location|city)\s*[:：]\s*(.+)$/i);
  const status = findLabeled(/(?:求职状态|当前状态|状态|status)\s*[:：]\s*(.+)$/i);
  const yearsMatch = text.match(/(\d+(?:\.\d+)?)\s*年(?:以上)?(?:工作)?经验/);
  const experienceYears = yearsMatch ? `${yearsMatch[1]} 年经验` : "";
  const statusFallback =
    status ||
    (text.match(/(随时到岗|离职|在职|open\s*to\s*work)/i)?.[0] ?? "");

  const contactLike = new Set([email, phone, website, name, headline].filter(Boolean));
  const summary =
    summaryLines
      .map(stripBullet)
      .filter((s) => s.length > 20 && !EMAIL_RE.test(s) && !PHONE_RE.test(s) && !contactLike.has(s))
      .join("\n") ||
    intro
      .map(stripBullet)
      .filter(
        (s) =>
          s.length > 25 &&
          !EMAIL_RE.test(s) &&
          !PHONE_RE.test(s) &&
          !URL_RE.test(s) &&
          !PERIOD_RE.test(s) &&
          !contactLike.has(s) &&
          !/^(?:求职意向|意向岗位|目标岗位|目标职位|应聘岗位|现居|所在地|城市|地址|求职状态|当前状态)\s*[:：]/i.test(s),
      )
      .join("\n");

  return {
    name: clip(name, 60) || fallbackName,
    headline: clip(headline, 120),
    location: clip(location, 80),
    experienceYears: clip(experienceYears, 40),
    status: clip(statusFallback, 60),
    summary: clip(summary, 2000),
    email: clip(email, 120),
    website: clip(website, 200),
  };
}

/** 把任意简历文本（PDF/Word 抽取结果或直接粘贴）解析成档案卡结构 */
export function parseResumeText(raw: string, fallbackName: string): ResumeProfile {
  // NFKC：把 PDF 常见的康熙部首（如 ⼯ / ⼤ / ⾼）和全角字符归一成常规汉字与半角
  const text = raw
    .normalize("NFKC")
    .replace(/\r\n?/g, "\n")
    .replace(/\u00a0/g, " ")
    .slice(0, MAX_IMPORT_CHARS);
  const lines = text.split("\n").map((l) => l.trimEnd());

  const blocks: Record<Section, string[]> = {
    intro: [],
    experience: [],
    projects: [],
    skills: [],
    summary: [],
    education: [],
  };
  let cur: Section = "intro";
  for (const line of lines) {
    const sec = sectionOf(line);
    if (sec) {
      cur = sec;
      continue;
    }
    blocks[cur].push(line);
  }

  return {
    basics: pickBasics(blocks.intro, blocks.summary, fallbackName),
    experience: parseExperience(blocks.experience),
    skills: parseSkills(blocks.skills),
    projects: parseProjects(blocks.projects),
    education: parseEducation(blocks.education),
  };
}
