import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import * as jwt from 'jsonwebtoken';
import { SupabaseService } from '../../supabase/supabase.service';

export type AuthedRequest = Request & {
  userID?: number | string | null;
  adminID?: number | string;
  ephemeral?: boolean;
};

interface UserTokenPayload extends jwt.JwtPayload {
  userID?: number | string;
  session_id?: string;
  adminID?: number | string;
  hakimAdmin?: boolean;
}

/**
 * Per-user auth for the app-facing Hakim endpoints. Ports the SvelteKit app's
 * `getUserID()` (src/lib/auth.js): verify the HS256 JWT signed with
 * SECRET_JWT_KEY, then confirm its `session_id` still matches the user's single
 * active `session_token` in hawi_user (so a token from a logged-out / superseded
 * device is rejected). On success, attaches `userID` to the request.
 *
 * Also accepts the short-lived "Hakim test" token minted by the /control test
 * page for super / ambassador admins (`hakimAdmin: true`). Those requests are
 * marked `ephemeral` — unlimited usage, nothing persisted (admins aren't
 * hawi_user rows).
 *
 * Tokens are issued by `@tsndr/cloudflare-worker-jwt` (HS256), which
 * `jsonwebtoken.verify` validates with the same shared secret.
 */
@Injectable()
export class UserJwtGuard implements CanActivate {
  private readonly jwtKey: string;

  constructor(
    configService: ConfigService,
    private readonly supabase: SupabaseService,
  ) {
    this.jwtKey = configService.getOrThrow<string>('SECRET_JWT_KEY');
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthedRequest>();
    const authHeader = request.headers['authorization'] ?? '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';

    if (!token) {
      throw new UnauthorizedException('Missing authorization token');
    }

    let payload: UserTokenPayload;
    try {
      payload = jwt.verify(token, this.jwtKey) as UserTokenPayload;
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }

    // Admin "Hakim test" token (from the /control test page).
    if (payload.hakimAdmin && payload.adminID) {
      const perms = await this.supabase.select<{ type: string }>(
        'hawi_permission',
        `adminID=eq.${encodeURIComponent(String(payload.adminID))}` +
          `&type=in.(super,ambassador)&select=type`,
      );
      if (perms.length === 0) {
        throw new UnauthorizedException('Not an authorized admin');
      }
      request.adminID = payload.adminID;
      request.userID = null;
      request.ephemeral = true;
      return true;
    }

    // Regular user token.
    const userID = payload.userID;
    const sessionID = payload.session_id;
    if (!userID || !sessionID) {
      throw new UnauthorizedException('Invalid token payload');
    }

    const user = await this.supabase.selectOne<{ session_token: string }>(
      'hawi_user',
      `userID=eq.${encodeURIComponent(String(userID))}&select=session_token`,
    );

    if (!user || user.session_token !== sessionID) {
      throw new UnauthorizedException('Invalid session');
    }

    request.userID = userID;
    request.ephemeral = false;
    return true;
  }
}
