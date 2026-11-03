import type { ResumeDto } from "@aiwb/shared";

/** 渲染前的防御性规整：解析再稳，库里的旧数据也可能是乱的 */
const clean = (v: string) => v.replace(/\s+/g, " ").trim();

/** 旧解析会把多条要点用「；」拼成一行，渲染层拆开，保证一条一行 */
function splitBullets(raw: string): string[] {
  return clean(raw)
    .split(/；/)
    .map((s) => s.replace(/^[·\-—\s]+/, "").trim())
    .filter(Boolean);
}

function SectionTitle({ children }: { children: string }) {
  return (
    <h2 className="flex items-center gap-2 text-[13px] font-bold tracking-wide text-tx">
      <span className="text-acc">▍</span>
      {children}
    </h2>
  );
}

/** 简历文档卡：纯「标题 + 内容」排版，无终端装饰 */
export default function ResumeCard({ data }: { data: ResumeDto }) {
  const { username, profile, updatedAt } = data;
  const b = profile.basics;

  const meta = [clean(b.location), clean(b.experienceYears), clean(b.status)]
    .filter(Boolean)
    .join(" · ");
  const website = clean(b.website);
  const email = clean(b.email);

  const experience = profile.experience
    .map((e) => ({
      ...e,
      period: clean(e.period),
      company: clean(e.company),
      role: clean(e.role),
      highlights: e.highlights.flatMap(splitBullets),
    }))
    .filter((e) => e.company || e.role || e.period || e.highlights.length > 0);

  const projects = profile.projects
    .map((p) => ({ ...p, name: clean(p.name), desc: clean(p.desc), url: clean(p.url) }))
    .filter((p) => p.name || p.desc);

  const education = profile.education
    .map((e) => ({
      ...e,
      period: clean(e.period),
      school: clean(e.school),
      major: clean(e.major),
      degree: clean(e.degree),
    }))
    .filter((e) => e.school || e.major || e.degree || e.period);

  const skills = profile.skills
    .map((g) => ({
      group: clean(g.group),
      items: [...new Set(g.items.map(clean).filter(Boolean))],
    }))
    .filter((g) => g.items.length > 0);

  const empty =
    !b.name &&
    !b.summary &&
    experience.length === 0 &&
    projects.length === 0 &&
    education.length === 0 &&
    skills.length === 0;

  return (
    <div className="overflow-hidden rounded-lg border border-line bg-bg1 font-sans">
      {/* ── 基本信息 ── */}
      <header className="px-5 pb-4 pt-5">
        <div className="text-[20px] font-bold leading-tight text-tx">
          {clean(b.name) || username}
        </div>
        {clean(b.headline) && <div className="mt-1 text-[13px] text-tx2">{clean(b.headline)}</div>}
        {meta && <div className="mt-1.5 font-mono text-[11px] text-tx3">{meta}</div>}
        {(email || website) && (
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[11.5px]">
            {email && (
              <a className="text-acc hover:underline" href={`mailto:${email}`}>
                ✉ {email}
              </a>
            )}
            {website && (
              <a
                className="text-acc hover:underline"
                href={/^https?:\/\//.test(website) ? website : `https://${website}`}
                target="_blank"
                rel="noreferrer"
              >
                ↗ {website}
              </a>
            )}
          </div>
        )}
        {clean(b.summary) && (
          <p className="mt-3 whitespace-pre-wrap text-[12.5px] leading-relaxed text-tx2">
            {clean(b.summary)}
          </p>
        )}
        {empty && updatedAt === null && (
          <div className="mt-2 text-[12px] text-tx3">
            尚未填写档案卡 —— 点击右上角「⇪ 导入简历」或「✎ 编辑」
          </div>
        )}
      </header>

      {/* ── 工作经历 ── */}
      {experience.length > 0 && (
        <section className="border-t border-line px-5 py-4">
          <SectionTitle>工作经历</SectionTitle>
          <div className="mt-3 space-y-4">
            {experience.map((e, i) => (
              <div key={`exp-${i}`}>
                <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <div className="text-[13.5px] font-medium text-tx">
                    {e.company}
                    {e.role && <span className="font-normal text-tx2"> · {e.role}</span>}
                  </div>
                  {e.period && (
                    <div className="flex-none font-mono text-[11px] text-acc">{e.period}</div>
                  )}
                </div>
                {e.highlights.length > 0 && (
                  <ul className="mt-1.5 space-y-1">
                    {e.highlights.map((h, j) => (
                      <li key={`exp-${i}-${j}`} className="flex gap-2 text-[12.5px] leading-relaxed text-tx2">
                        <span className="flex-none text-acc">·</span>
                        <span>{h}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── 项目经历 ── */}
      {projects.length > 0 && (
        <section className="border-t border-line px-5 py-4">
          <SectionTitle>项目经历</SectionTitle>
          <div className="mt-3 space-y-4">
            {projects.map((p, i) => (
              <div key={`proj-${i}`}>
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="text-[13.5px] font-medium text-tx">{p.name}</span>
                  {p.tags.filter(Boolean).map((t) => (
                    <span
                      key={t}
                      className="rounded border border-line px-1.5 py-px font-mono text-[10px] text-tx3"
                    >
                      {t}
                    </span>
                  ))}
                  {p.url && (
                    <a
                      className="font-mono text-[11px] text-acc hover:underline"
                      href={p.url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      ↗ 链接
                    </a>
                  )}
                </div>
                {p.desc && (
                  <p className="mt-1 whitespace-pre-wrap text-[12.5px] leading-relaxed text-tx2">
                    {p.desc}
                  </p>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── 教育经历 ── */}
      {education.length > 0 && (
        <section className="border-t border-line px-5 py-4">
          <SectionTitle>教育经历</SectionTitle>
          <div className="mt-3 space-y-2.5">
            {education.map((e, i) => (
              <div key={`edu-${i}`} className="flex flex-wrap items-baseline justify-between gap-x-3">
                <div className="text-[13px] text-tx">
                  <span className="font-medium">{e.school}</span>
                  {e.major && <span className="text-tx2"> · {e.major}</span>}
                  {e.degree && <span className="text-tx3"> · {e.degree}</span>}
                </div>
                {e.period && (
                  <div className="flex-none font-mono text-[11px] text-acc">{e.period}</div>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── 专业技能 ── */}
      {skills.length > 0 && (
        <section className="border-t border-line px-5 py-4">
          <SectionTitle>专业技能</SectionTitle>
          <div className="mt-3 space-y-2.5">
            {skills.map((g, i) => (
              <div key={`skill-${i}`} className="flex flex-wrap items-center gap-1.5">
                {skills.length > 1 && (
                  <span className="mr-1 font-mono text-[11px] text-tx3">{g.group}:</span>
                )}
                {g.items.map((it) => (
                  <span
                    key={it}
                    className="rounded border border-line bg-bg px-2 py-0.5 text-[11.5px] text-tx2"
                  >
                    {it}
                  </span>
                ))}
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
