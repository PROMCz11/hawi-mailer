import { Module } from '@nestjs/common';
import { NotificationsController } from './notifications.controller';
import { FirebaseService } from '../firebase/firebase.service';
import { HeaderGuard } from 'src/auth/header/header.guard';
import { ConfigModule } from '@nestjs/config';

@Module({
    imports: [ConfigModule],
    controllers: [NotificationsController],
    providers: [FirebaseService, HeaderGuard],
})
export class NotificationsModule {}