import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectBot } from 'nestjs-telegraf';
import { Telegraf } from 'telegraf';

@Injectable()
export class ReportsService {
  private readonly logger = new Logger(ReportsService.name);
  private readonly sveltekitUrl: string;
  private readonly systemPassword: string;

  constructor(
    private readonly configService: ConfigService,
    @InjectBot() private readonly bot: Telegraf,
  ) {
    this.sveltekitUrl =
      this.configService.get<string>('SVELTEKIT_URL') ||
      'http://localhost:5173';
    this.systemPassword =
      this.configService.get<string>('SYSTEM_PASSWORD') || '';
  }

  async dispatchReports(payload: {
    type: string;
    template: string;
    eligibleAdminIDs: number[];
    courseName: string;
    entityName: string;
    reportText: string;
  }) {
    const { eligibleAdminIDs, template, type } = payload;

    if (!eligibleAdminIDs || eligibleAdminIDs.length === 0) {
      this.logger.log('No eligible admins to notify.');
      return;
    }

    try {
      const res = await fetch(
        `${this.sveltekitUrl}/api/internal/admin-telegram`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            systemPassword: this.systemPassword,
            action: 'resolve',
            adminIDs: eligibleAdminIDs,
          }),
        },
      );

      const json = await res.json();

      if (!json.status || !json.data?.admins) {
        this.logger.error('Failed to resolve admin chat IDs from SvelteKit');
        return;
      }

      const admins = json.data.admins;

      const typeText = type === 'question' ? 'سؤال' : 'بطاقة';
      const message = `🚨 إبلاغ جديد عن ${typeText}\n\n${template}`;

      for (const admin of admins) {
        if (admin.telegram_chat_id) {
          try {
            await this.bot.telegram.sendMessage(
              admin.telegram_chat_id,
              message,
            );
          } catch (err: any) {
            this.logger.error(
              `Failed to send message to chat ${admin.telegram_chat_id}: ${err.message}`,
            );
          }
        }
      }
    } catch (err: any) {
      this.logger.error(`Error dispatching reports: ${err.message}`);
    }
  }
}
