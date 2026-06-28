import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as jwt from 'jsonwebtoken';
import { SupabaseService } from '../../supabase/supabase.service';
import { AuthedRequest } from './user-jwt.guard';

interface AdminTokenPayload extends jwt.JwtPayload {
  adminID?: number | string;
  hakimAdmin?: boolean;
}

/**
 * Admin-only guard for the Hakim ingestion endpoints (course/lecture chunking).
 * Unlike UserJwtGuard, this rejects regular user tokens outright: the token must
 * be a "Hakim test/admin" token (`hakimAdmin: true`) belonging to a current
 * super / ambassador admin.
 */
@Injectable()
export class HakimAdminGuard implements CanActivate {
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

    let payload: AdminTokenPayload;
    try {
      payload = jwt.verify(token, this.jwtKey) as AdminTokenPayload;
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }

    if (!payload.hakimAdmin || !payload.adminID) {
      throw new UnauthorizedException('Admin access required');
    }

    const perms = await this.supabase.select<{ type: string }>(
      'hawi_permission',
      `adminID=eq.${encodeURIComponent(String(payload.adminID))}` +
        `&type=in.(super,ambassador)&select=type`,
    );
    if (perms.length === 0) {
      throw new UnauthorizedException('Not an authorized admin');
    }

    request.adminID = payload.adminID;
    return true;
  }
}
