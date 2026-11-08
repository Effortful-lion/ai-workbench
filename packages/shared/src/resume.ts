/** 个人简历（resume 模块）共享类型 —— 终端档案卡的数据协议 */

export interface ResumeBasics {
  /** 展示名，缺省用 username */
  name: string;
  /** 一句话定位，如「全栈工程师 / AI 工程实践者」 */
  headline: string;
  location: string;
  /** 经验年限的自由描述，如「8 年经验」 */
  experienceYears: string;
  /** 当前状态，如「open to work」 */
  status: string;
  summary: string;
  email: string;
  website: string;
}

export interface ResumeExperience {
  period: string;
  company: string;
  role: string;
  highlights: string[];
}

export interface ResumeSkillGroup {
  group: string;
  items: string[];
}

export interface ResumeProject {
  name: string;
  /** 承担角色，如「技术负责人」——与工作经历的 role 对齐 */
  role: string;
  /** 项目起止时间，与工作经历的 period 对齐 */
  period: string;
  desc: string;
  url: string;
  tags: string[];
}

export interface ResumeEducation {
  period: string;
  school: string;
  major: string;
  degree: string;
  /** 绩点，如「3.11/5」；旧数据没有则空串 */
  gpa: string;
}

/** 档案卡全文：对应终端里的 whoami / ls ./experience / cat education.log / cat skills.json / tree ./projects */
export interface ResumeProfile {
  basics: ResumeBasics;
  experience: ResumeExperience[];
  education: ResumeEducation[];
  skills: ResumeSkillGroup[];
  projects: ResumeProject[];
}

/** 导入简历的解析结果（尚未落库，由前端确认后写入档案卡） */
export interface ResumeImportResult {
  /** 文本来源：pdf / docx / 直接粘贴（txt 与 md 归入 text） */
  source: "pdf" | "docx" | "text";
  /** 抽取到的字符数 */
  chars: number;
  profile: ResumeProfile;
}

export interface ResumeDto {
  username: string;
  /** 服务端按角色判定：仅 owner（me:write）可编辑，member/游客只读 */
  canEdit: boolean;
  profile: ResumeProfile;
  /** null = 从未保存过，前端显示「尚未填写」 */
  updatedAt: number | null;
}

export interface ResumeUpdateInput {
  profile: ResumeProfile;
}
