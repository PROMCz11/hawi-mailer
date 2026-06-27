import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

@Injectable()
export class JsendInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    // Ignore Telegraf contexts to prevent [object Object] spam
    if (context.getType() !== 'http') {
      return next.handle();
    }

    // SSE endpoints (Hakim streaming) write the response directly. Once headers
    // are sent there's nothing to wrap — pass the stream through untouched.
    const response = context.switchToHttp().getResponse();
    if (response?.headersSent) {
      return next.handle();
    }

    return next.handle().pipe(
      map((data) => ({
        status: true,
        data: data ?? null,
      })),
    );
  }
}
