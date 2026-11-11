import { Inject, Injectable, Logger } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { DB, type Db } from "../db/db.module";
import { users } from "../db/schema";

/**
 * 站点主人（admin）。
 *
 * 本站是「个人站 + 注册讨论」：内容（简历/博客/知识库/项目/客户…）都挂在 admin 名下，
 * 普通注册用户只读取展示，不拥有自己的内容空间。因此读接口的数据归属统一解析到这里。
 *
 * 解析顺序：ADMIN_USER 配置的用户名 → 库里第一个 owner。进程内缓存，避免每请求查库。
 */
@Injectable()
export class WorkspaceOwner {
  private readonly log = new Logger("owner");
  private cache: string | null = null;

  constructor(@Inject(DB) private readonly db: Db) {}

  async id(): Promise<string> {
    if (this.cache) return this.cache;
    const name = process.env.ADMIN_USER ?? "admin";
    const [byName] = await this.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.username, name));
    const row =
      byName ??
      (await this.db.select({ id: users.id }).from(users).where(eq(users.role, "owner")).limit(1))[0];
    if (!row) throw new Error("站点 owner 不存在：请检查 ADMIN_USER 配置");
    this.cache = row.id;
    this.log.log(`▸ 内容归属账号已解析：${name}`);
    return row.id;
  }
}
