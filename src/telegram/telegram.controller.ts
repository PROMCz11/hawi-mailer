import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import { TelegramService } from './telegram.service';
import { HeaderGuard } from '../auth/header/header.guard'; // Adjust path if needed

interface SendMessageDto {
  message: string;
}

@Controller('telegram')
@UseGuards(HeaderGuard)
export class TelegramController {
  constructor(private readonly telegramService: TelegramService) {}

  @Post('send-message')
  async sendMessage(@Body() body: SendMessageDto) {
    const { message } = body;

    if (!message || typeof message !== 'string' || message.trim() === '') {
      return { success: false, error: 'Message is required and must be a non-empty string.' };
    }

    const success = await this.telegramService.sendMessage(message.trim());
    if (success) {
      return { success: true, message: 'Message sent successfully.' };
    } else {
      return { success: false, error: 'Failed to send message.' };
    }
  }
}