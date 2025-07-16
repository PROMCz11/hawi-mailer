import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import { FirebaseService } from '../firebase/firebase.service';
import { HeaderGuard } from 'src/auth/header/header.guard';

@Controller('notifications')
export class NotificationsController {
    constructor(private readonly firebaseService: FirebaseService) {}

    @Post('send')
    @UseGuards(HeaderGuard)
    async send(@Body() body: { token: string; title: string; body: string; data?: Record<string, string> }) {
        const { token, title, body: messageBody, data } = body;
        const result = await this.firebaseService.sendNotification(token, title, messageBody, data);
        return { success: true, result };
    }
}