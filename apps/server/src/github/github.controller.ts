import { Body, Controller, Delete, Get, NotFoundException, Param, Post, Query, UseGuards } from "@nestjs/common";
import { JwtAuthGuard, CurrentUser, type AuthUser } from "../auth/jwt-auth.guard";
import { PermissionGuard, RequirePerm } from "../common/permission.guard";
import { GithubService } from "./github.service";

@Controller("github")
@UseGuards(JwtAuthGuard, PermissionGuard)
export class GithubController {
  constructor(private readonly github: GithubService) {}

  @Get("account")
  @RequirePerm("github:read")
  account(@CurrentUser() user: AuthUser) {
    return this.github.getAccount(user.id);
  }

  @Post("account/token")
  @RequirePerm("github:write")
  setToken(@CurrentUser() user: AuthUser, @Body() body: { token: string }) {
    return this.github.setToken(user.id, body.token);
  }

  @Delete("account")
  @RequirePerm("github:write")
  remove(@CurrentUser() user: AuthUser) {
    return this.github.removeAccount(user.id);
  }

  @Get("profile")
  @RequirePerm("github:read")
  async profile(@CurrentUser() user: AuthUser, @Query("refresh") refresh?: string) {
    const snap = await this.github.profile(user.id, refresh === "1");
    return { ...snap.data, fetchedAt: snap.fetchedAt, stale: snap.stale };
  }

  @Get("repos")
  @RequirePerm("github:read")
  async repos(@CurrentUser() user: AuthUser, @Query("q") q?: string, @Query("refresh") refresh?: string) {
    const snap = await this.github.repos(user.id, q, refresh === "1");
    // 展示型模块：普通用户只看公开仓库，私有仓库不进列表
    const items = user.role === "owner"
      ? snap.data
      : (snap.data as { private?: boolean }[]).filter((r) => !r.private);
    return { items, fetchedAt: snap.fetchedAt, stale: snap.stale };
  }

  @Get("activity/calendar")
  @RequirePerm("github:read")
  async calendar(@CurrentUser() user: AuthUser, @Query("refresh") refresh?: string) {
    const snap = await this.github.calendar(user.id, refresh === "1");
    return { ...(snap.data as object), fetchedAt: snap.fetchedAt, stale: snap.stale };
  }

  @Get("activity/languages")
  @RequirePerm("github:read")
  async languages(@CurrentUser() user: AuthUser, @Query("refresh") refresh?: string) {
    const snap = await this.github.languages(user.id, refresh === "1");
    return { ...(snap.data as object), fetchedAt: snap.fetchedAt, stale: snap.stale };
  }

  /** 收件箱是站点主人的个人通知，普通用户不可见 */
  @Get("inbox")
  @RequirePerm("github:write")
  async inbox(@CurrentUser() user: AuthUser, @Query("refresh") refresh?: string) {
    const snap = await this.github.inbox(user.id, refresh === "1");
    return { ...(snap.data as object), fetchedAt: snap.fetchedAt, stale: snap.stale };
  }

  /** AI 简报基于收件箱事件，同样只对站点主人开放 */
  @Get("inbox/digest")
  @RequirePerm("github:write")
  async digest(@CurrentUser() user: AuthUser, @Query("refresh") refresh?: string) {
    const snap = await this.github.digest(user.id, refresh === "1");
    return { ...(snap.data as object), fetchedAt: snap.fetchedAt, stale: snap.stale };
  }

  @Get("trending")
  @RequirePerm("github:read")
  async trending(@CurrentUser() user: AuthUser, @Query("refresh") refresh?: string) {
    const snap = await this.github.trending(user.id, refresh === "1");
    return { ...(snap.data as object), fetchedAt: snap.fetchedAt, stale: snap.stale };
  }

  @Get("search/repos")
  @RequirePerm("github:read")
  async searchRepos(
    @CurrentUser() user: AuthUser,
    @Query("q") q?: string,
    @Query("sort") sort?: string,
    @Query("refresh") refresh?: string,
  ) {
    // 普通用户的搜索结果只能落在公开仓库
    const query = user.role === "owner" ? q ?? "" : `${q ?? ""} is:public`.trim();
    const snap = await this.github.searchRepos(user.id, query, sort, refresh === "1");
    return { ...(snap.data as object), fetchedAt: snap.fetchedAt, stale: snap.stale };
  }

  /** 代码搜索可命中私有仓库代码，仅站点主人可用 */
  @Get("search/code")
  @RequirePerm("github:write")
  async searchCode(@CurrentUser() user: AuthUser, @Query("q") q?: string) {
    const snap = await this.github.searchCode(user.id, q ?? "");
    return { ...(snap.data as object), fetchedAt: snap.fetchedAt, stale: snap.stale };
  }

  @Post("ask")
  @RequirePerm("github:read")
  async ask(@CurrentUser() user: AuthUser, @Body() body: { owner?: string; name?: string; question?: string }) {
    if (!body?.owner || !body?.name) throw new NotFoundException("owner 和 name 必填");
    await this.assertPublicRepo(user, body.owner, body.name);
    return this.github.ask(user.id, body.owner, body.name, body.question ?? "");
  }

  @Post("review-draft")
  @RequirePerm("github:read")
  async reviewDraft(@CurrentUser() user: AuthUser, @Body() body: { owner?: string; name?: string; pr?: number }) {
    if (!body?.owner || !body?.name) throw new NotFoundException("owner 和 name 必填");
    await this.assertPublicRepo(user, body.owner, body.name);
    return this.github.reviewDraft(user.id, body.owner, body.name, Number(body.pr));
  }

  @Get("repos/:owner/:name")
  @RequirePerm("github:read")
  async repoDetail(
    @CurrentUser() user: AuthUser,
    @Param("owner") owner: string,
    @Param("name") name: string,
    @Query("refresh") refresh?: string,
  ) {
    await this.assertPublicRepo(user, owner, name, refresh === "1");
    return this.github.repoDetail(user.id, owner, name, refresh === "1");
  }

  @Get("repos/:owner/:name/commits")
  @RequirePerm("github:read")
  async commits(
    @CurrentUser() user: AuthUser,
    @Param("owner") owner: string,
    @Param("name") name: string,
    @Query("refresh") refresh?: string,
  ) {
    await this.assertPublicRepo(user, owner, name);
    const snap = await this.github.commits(user.id, owner, name, refresh === "1");
    return { items: snap.data, fetchedAt: snap.fetchedAt, stale: snap.stale };
  }

  @Get("repos/:owner/:name/activity")
  @RequirePerm("github:read")
  async activity(
    @CurrentUser() user: AuthUser,
    @Param("owner") owner: string,
    @Param("name") name: string,
    @Query("refresh") refresh?: string,
  ) {
    await this.assertPublicRepo(user, owner, name);
    const snap = await this.github.commitActivity(user.id, owner, name, refresh === "1");
    return { ...(snap.data as object), fetchedAt: snap.fetchedAt, stale: snap.stale };
  }

  @Get("repos/:owner/:name/tree")
  @RequirePerm("github:read")
  async tree(
    @CurrentUser() user: AuthUser,
    @Param("owner") owner: string,
    @Param("name") name: string,
    @Query("refresh") refresh?: string,
  ) {
    await this.assertPublicRepo(user, owner, name);
    const snap = await this.github.tree(user.id, owner, name, refresh === "1");
    return { ...snap.data, fetchedAt: snap.fetchedAt, stale: snap.stale };
  }

  @Get("repos/:owner/:name/file")
  @RequirePerm("github:read")
  async file(
    @CurrentUser() user: AuthUser,
    @Param("owner") owner: string,
    @Param("name") name: string,
    @Query("path") path: string,
  ) {
    await this.assertPublicRepo(user, owner, name);
    const snap = await this.github.file(user.id, owner, name, path);
    return snap.data;
  }

  /** 站点主人可看全部仓库；普通用户访问私有仓库一律按不存在处理 */
  private async assertPublicRepo(user: AuthUser, owner: string, name: string, force = false) {
    if (user.role === "owner") return;
    const snap = await this.github.repo(user.id, owner, name, force);
    if ((snap.data as { private?: boolean }).private) {
      throw new NotFoundException("仓库不存在");
    }
  }
}
