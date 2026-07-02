import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import { randomInt } from 'crypto';
import { MailService } from '../mail/mail.service';
import { HeaderGuard } from 'src/auth/header/header.guard';

@Controller('otp')
export class OtpController {
  constructor(private readonly mailService: MailService) {}

  @Post('send')
  @UseGuards(HeaderGuard)
  async sendOtp(
    @Body() body: { email: string; purpose?: 'confirm' | 'reset' },
  ) {
    // Cryptographically secure 6-digit OTP (100000–999999). Math.random() is
    // not a CSPRNG and must not be used to mint security tokens.
    const otp = randomInt(100000, 1000000).toString();

    const info = await this.mailService.sendOtp(body.email, otp, body.purpose);

    return {
      messageId: info.messageId,
      otp,
    };
  }
}
