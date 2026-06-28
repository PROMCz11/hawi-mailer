import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { HakimController } from './hakim.controller';
import { HakimService } from './hakim.service';
import { OpenAiService } from './openai.service';
import { RetrievalService } from './retrieval.service';
import { QuotaService } from './quota.service';
import { IngestionController } from './ingestion.controller';
import { IngestionService } from './ingestion.service';
import { UserJwtGuard } from '../auth/user/user-jwt.guard';
import { HakimAdminGuard } from '../auth/user/hakim-admin.guard';

@Module({
  imports: [ConfigModule],
  controllers: [HakimController, IngestionController],
  providers: [
    HakimService,
    OpenAiService,
    RetrievalService,
    QuotaService,
    IngestionService,
    UserJwtGuard,
    HakimAdminGuard,
  ],
})
export class HakimModule {}
