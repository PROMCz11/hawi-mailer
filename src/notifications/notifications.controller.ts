import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import { FirebaseService } from '../firebase/firebase.service';
import { HeaderGuard } from 'src/auth/header/header.guard';

@Controller('notifications')
export class NotificationsController {
    constructor(private readonly firebaseService: FirebaseService) {}

    @Post('send')
    @UseGuards(HeaderGuard)
    async send(@Body() body: { tokens: string[]; title: string; body: string; data?: Record<string, string> }) {
        const { tokens, title, body: messageBody, data } = body;
        const result = await this.firebaseService.sendNotification(tokens, title, messageBody, data);
        return { success: true, result };
    }
}