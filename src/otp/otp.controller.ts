import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import { MailService } from '../mail/mail.service';
import { HeaderGuard } from 'src/auth/header/header.guard';

@Controller('otp')
export class OtpController {
    constructor(private readonly mailService: MailService) {}

    @Post('send')
    @UseGuards(HeaderGuard)
    async sendOtp(@Body() body: { email: string }) {
        const otp = Math.floor(100000 + Math.random() * 900000).toString();

        const info = await this.mailService.sendOtp(body.email, otp);

        return {
            success: true,
            messageId: info.messageId,
            otp
        };
    }
}
