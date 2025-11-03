import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MailService } from './mail/mail.service';
import { OtpController } from './otp/otp.controller';
import { FirebaseModule } from './firebase/firebase-module';
import { NotificationsModule } from './notifications/notifications.module';
import { ImgModule } from './img/img.module';

@Module({
    imports: [ConfigModule.forRoot(), FirebaseModule, NotificationsModule, ImgModule],
    providers: [MailService],
    controllers: [OtpController],
})
export class AppModule {}
