import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Response } from 'express';

@Catch()
export class JsendExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(JsendExceptionFilter.name);

  catch(exception: any, host: ArgumentsHost) {
    // Ignore Telegraf contexts
    if (host.getType() !== 'http') {
      this.logger.error(`Non-HTTP Exception: ${exception?.message || exception}`);
      return;
    }

    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    if (!response || !response.status) {
      this.logger.error(`HTTP Exception but no valid response object: ${exception?.message || exception}`);
      return;
    }

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Internal server error';

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const exceptionResponse = exception.getResponse();
      
      if (typeof exceptionResponse === 'string') {
        message = exceptionResponse;
      } else if (typeof exceptionResponse === 'object' && exceptionResponse !== null) {
        message = (exceptionResponse as any).message || exception.message;
      }
    } else if (exception instanceof Error) {
      message = exception.message;
    }

    if (Array.isArray(message)) {
      message = message.join(', ');
    }

    response.status(status).json({
      status: false,
      message,
    });
  }
}