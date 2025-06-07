import {
    CanActivate,
    ExecutionContext,
    Injectable,
    UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class HeaderGuard implements CanActivate {
    constructor(private configService: ConfigService) {}

    canActivate(context: ExecutionContext): boolean {
        const request = context.switchToHttp().getRequest();
        const token = request.headers['authtoken']; // <-- lowercase, HTTP header

        const expectedToken = this.configService.get<string>('AUTH_TOKEN');

        if (!token || token !== expectedToken) {
            throw new UnauthorizedException('Invalid or missing auth token');
        }

        return true;
    }
}