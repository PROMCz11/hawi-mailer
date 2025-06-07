import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MailService } from './mail/mail.service';
import { OtpController } from './otp/otp.controller';

@Module({
    imports: [ConfigModule.forRoot()],
    providers: [MailService],
    controllers: [OtpController],
})
export class AppModule {}
