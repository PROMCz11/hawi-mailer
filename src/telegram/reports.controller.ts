import { Controller, Post, Body, UseGuards, Logger } from '@nestjs/common';
import { ReportsService } from './reports.service';
import { HeaderGuard } from '../auth/header/header.guard';

@Controller('telegram')
export class ReportsController {
  private readonly logger = new Logger(ReportsController.name);

  constructor(private readonly reportsService: ReportsService) {}

  @Post('reports')
  @UseGuards(HeaderGuard)
  async receiveReport(
    @Body() body: {
      type: string;
      template: string;
      eligibleAdminIDs: number[];
      courseName: string;
      entityName: string;
      reportText: string;
    }
  ) {
    this.logger.log(`Received ${body.type} report for course ${body.courseName}`);
    await this.reportsService.dispatchReports(body);
    return { success: true };
  }
}