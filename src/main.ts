import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { JsendInterceptor } from './interceptors/jsend.interceptor';
import { JsendExceptionFilter } from './filters/jsend-exception.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useGlobalInterceptors(new JsendInterceptor());
  app.useGlobalFilters(new JsendExceptionFilter());
  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();