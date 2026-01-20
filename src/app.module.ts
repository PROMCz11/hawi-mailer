import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MailService } from './mail/mail.service';
import { OtpController } from './otp/otp.controller';
import { FirebaseModule } from './firebase/firebase-module';
import { NotificationsModule } from './notifications/notifications.module';
import { ImgModule } from './img/img.module';
import { TelegramModule } from './telegram/telegram.module';

@Module({
    imports: [ConfigModule.forRoot(), FirebaseModule, NotificationsModule, ImgModule, TelegramModule],
    providers: [MailService],
    controllers: [OtpController],
})
export class AppModule {}