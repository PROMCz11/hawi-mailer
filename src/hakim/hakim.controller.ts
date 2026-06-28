import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Response } from 'express';
import { UserJwtGuard, AuthedRequest } from '../auth/user/user-jwt.guard';
import { HakimService, HakimAuth } from './hakim.service';
import { ChatRequest, ExplainQuestionRequest } from './dto/hakim.dto';

@Controller('hakim')
@UseGuards(UserJwtGuard)
export class HakimController {
  constructor(private readonly hakim: HakimService) {}

  // SSE — these write the response directly, so no JSend wrapping.
  @Post('chat')
  async chat(
    @Req() req: AuthedRequest,
    @Res() res: Response,
    @Body() body: ChatRequest,
  ) {
    await this.hakim.streamChat(this.authOf(req), body, req, res);
  }

  @Post('explain-question')
  async explainQuestion(
    @Req() req: AuthedRequest,
    @Res() res: Response,
    @Body() body: ExplainQuestionRequest,
  ) {
    await this.hakim.streamExplainQuestion(this.authOf(req), body, req, res);
  }

  // Plain JSON — wrapped by the global JSend interceptor. History lives under a
  // real user account, so ephemeral admin testers have nothing to list.
  @Get('conversations')
  listConversations(@Req() req: AuthedRequest) {
    return this.hakim.listConversations(this.requireUser(req));
  }

  @Get('conversations/:id')
  getConversation(
    @Req() req: AuthedRequest,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.hakim.getConversation(this.requireUser(req), id);
  }

  @Delete('conversations/:id')
  deleteConversation(
    @Req() req: AuthedRequest,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.hakim.deleteConversation(this.requireUser(req), id);
  }

  private authOf(req: AuthedRequest): HakimAuth {
    return {
      userID: req.userID == null ? null : Number(req.userID),
      ephemeral: !!req.ephemeral,
    };
  }

  private requireUser(req: AuthedRequest): number {
    if (req.userID == null) {
      throw new ForbiddenException(
        'Conversation history is not available for admin testers',
      );
    }
    return Number(req.userID);
  }
}
