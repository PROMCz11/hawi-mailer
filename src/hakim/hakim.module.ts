import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { HakimController } from './hakim.controller';
import { HakimService } from './hakim.service';
import { OpenAiService } from './openai.service';
import { RetrievalService } from './retrieval.service';
import { QuotaService } from './quota.service';
import { UserJwtGuard } from '../auth/user/user-jwt.guard';

@Module({
  imports: [ConfigModule],
  controllers: [HakimController],
  providers: [
    HakimService,
    OpenAiService,
    RetrievalService,
    QuotaService,
    UserJwtGuard,
  ],
})
export class HakimModule {}
