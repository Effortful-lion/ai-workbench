import {
  CanActivate, ExecutionContext, Injectable, UnauthorizedException,
  createParamDecorator,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import type { Role } from "@aiwb/shared";

export interface AuthUser {
  id: string;
  username: string;
  role: Role;
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly jwt: JwtService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const token: string | undefined = req.headers.authorization?.replace(/^Bearer\s+/i, "");
    if (!token) throw new UnauthorizedException("missing token");
    try {
      const payload = await this.jwt.verifyAsync<{ sub: string; username: string; role: Role }>(token);
      req.user = { id: payload.sub, username: payload.username, role: payload.role } satisfies AuthUser;
      return true;
    } catch {
      throw new UnauthorizedException("invalid token");
    }
  }
}

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser => ctx.switchToHttp().getRequest().user,
);
