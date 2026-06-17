import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import { HeaderGuard } from 'src/auth/header/header.guard';
import { AnalysisService } from './analysis.service';

@Controller('analysis')
export class AnalysisController {
  constructor(private readonly analysisService: AnalysisService) {}

  @Post('analyze-batch')
  @UseGuards(HeaderGuard)
  analyzeBatch(@Body() body: { questions: any[]; lectures: any[] }) {
    void this.analysisService.analyzeBatch(body.questions ?? [], body.lectures ?? []);
    return {};
  }
}
