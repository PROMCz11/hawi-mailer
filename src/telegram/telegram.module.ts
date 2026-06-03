import { Module } from '@nestjs/common';
import { TelegramService } from './telegram.service';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TelegrafModule } from 'nestjs-telegraf';

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
        return { token };
      },
      inject: [ConfigService],
    }),
  ],
  providers: [TelegramService],
  exports: [TelegramService],
})
export class TelegramModule {}