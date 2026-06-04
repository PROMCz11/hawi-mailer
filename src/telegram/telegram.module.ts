import { Module } from '@nestjs/common';
import { TelegramService } from './telegram.service';
import { LectureBotService } from './lecture-bot.service';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TelegrafModule } from 'nestjs-telegraf';

const LocalSession = require('telegraf-session-local');

@Module({
  imports: [
    ConfigModule,
    TelegrafModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => {
        const token = configService.get<string>('TELEGRAM_BOT_TOKEN');
        if (!token) {
          throw new Error('TELEGRAM_BOT_TOKEN is not defined in environment variables');
        }
        return {
          token,
          middlewares: [new LocalSession({ database: 'bot-sessions.json' }).middleware()]
        };
      },
      inject: [ConfigService],
    }),
  ],
  providers: [TelegramService, LectureBotService],
  exports: [TelegramService, LectureBotService],
})
export class TelegramModule {}