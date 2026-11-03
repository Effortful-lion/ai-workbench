import {
  CanActivate, ExecutionContext, ForbiddenException, Injectable,
  SetMetadata,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { hasPermission, type Permission } from "@aiwb/shared";
import type { AuthUser } from "../auth/jwt-auth.guard";

export const PERM_KEY = "required_permission";
export const RequirePerm = (perm: Permission) => SetMetadata(PERM_KEY, perm);

/** 权限即边界：role → permission 判定来自 @aiwb/shared，与 Tool 过滤同一套规则 */
@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const perm = this.reflector.getAllAndOverride<Permission | undefined>(PERM_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (!perm) return true;
    const user: AuthUser | undefined = ctx.switchToHttp().getRequest().user;
    if (!user || !hasPermission(user.role, perm)) {
      throw new ForbiddenException(`requires ${perm}`);
    }
    return true;
  }
}
