import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { JsendInterceptor } from './interceptors/jsend.interceptor';
import { JsendExceptionFilter } from './filters/jsend-exception.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  // The mobile app (Capacitor) and the web app call Hakim directly, so the
  // service has to accept cross-origin requests carrying the user Bearer token.
  app.enableCors({
    origin: true, // reflect the request origin (capacitor://localhost, http://localhost, prod web domain)
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'authtoken'],
  });
  app.useGlobalInterceptors(new JsendInterceptor());
  app.useGlobalFilters(new JsendExceptionFilter());
  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
