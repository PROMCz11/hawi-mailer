import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MailService } from './mail/mail.service';
import { OtpController } from './otp/otp.controller';
import { FirebaseModule } from './firebase/firebase-module';
import { NotificationsModule } from './notifications/notifications.module';
import { ImgModule } from './img/img.module';
import { TelegramModule } from './telegram/telegram.module';
import { ReportsController } from './telegram/reports.controller';
import { ReportsService } from './telegram/reports.service';
import { HeaderGuard } from './auth/header/header.guard';

@Module({
  imports: [ConfigModule.forRoot(), FirebaseModule, NotificationsModule, ImgModule, TelegramModule],
  providers: [MailService, ReportsService, HeaderGuard],
  controllers: [OtpController, ReportsController],
})
export class AppModule {}