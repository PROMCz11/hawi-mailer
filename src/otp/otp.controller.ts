import { Controller, Post, Body } from '@nestjs/common';
import { MailService } from '../mail/mail.service';

@Controller('otp')
export class OtpController {
    constructor(private readonly mailService: MailService) {}

    @Post('send')
    async sendOtp(@Body() body: { email: string }) {
        const otp = Math.floor(100000 + Math.random() * 900000).toString();

        const info = await this.mailService.sendOtp(body.email, otp);

        return {
            success: true,
            messageId: info.messageId,
            otp, // ⚠️ Only return OTP in development/testing
        };
    }
}
