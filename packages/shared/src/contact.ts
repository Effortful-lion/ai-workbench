/** 「如何联系我」公开信息页的数据结构：存于 users.profile_json.contact，不单独建表 */

export type ContactChannelType = "email" | "github" | "website" | "wechat" | "phone" | "booking";

export type ContactVisibility = "public" | "owner";

export interface ContactChannel {
  type: ContactChannelType;
  label: string;
  /** 展示值：邮箱、github 用户名、主页域名、微信号、电话号码或预约链接 */
  value: string;
  /** 可点击链接；邮箱为 mailto:，其余为 https:// */
  url?: string;
  visibility: ContactVisibility;
}

export interface ContactProfile {
  preferred: ContactChannelType;
  responseTime: string;
  availability: string;
  channels: ContactChannel[];
  updatedAt: string | null;
}

export interface PublicContactDto {
  username: string;
  contact: ContactProfile;
}

export interface OwnContactDto extends PublicContactDto {
  /** 是否可编辑：个人站里只有 owner（站点主人）为 true */
  canEdit: boolean;
}
