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

type AuthedRequest = Request & { userID?: number | string };

interface UserTokenPayload extends jwt.JwtPayload {
  userID?: number | string;
  session_id?: string;
}

/**
 * Per-user auth for the app-facing Hakim endpoints. Ports the SvelteKit app's
 * `getUserID()` (src/lib/auth.js): verify the HS256 JWT signed with
 * SECRET_JWT_KEY, then confirm its `session_id` still matches the user's single
 * active `session_token` in hawi_user (so a token from a logged-out / superseded
 * device is rejected). On success, attaches `userID` to the request.
 *
 * The tokens are issued by `@tsndr/cloudflare-worker-jwt` (HS256), which
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
    return true;
  }
}
