import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { UserJwtGuard } from '../auth/user/user-jwt.guard';
import { HakimService } from './hakim.service';
import { ChatRequest, ExplainQuestionRequest } from './dto/hakim.dto';

/** The guard attaches `userID` to the request after verifying the user JWT. */
type AuthedRequest = Request & { userID: number };

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
    await this.hakim.streamChat(req.userID, body, req, res);
  }

  @Post('explain-question')
  async explainQuestion(
    @Req() req: AuthedRequest,
    @Res() res: Response,
    @Body() body: ExplainQuestionRequest,
  ) {
    await this.hakim.streamExplainQuestion(req.userID, body, req, res);
  }

  // Plain JSON — wrapped by the global JSend interceptor.
  @Get('conversations')
  listConversations(@Req() req: AuthedRequest) {
    return this.hakim.listConversations(req.userID);
  }

  @Get('conversations/:id')
  getConversation(
    @Req() req: AuthedRequest,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.hakim.getConversation(req.userID, id);
  }

  @Delete('conversations/:id')
  deleteConversation(
    @Req() req: AuthedRequest,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.hakim.deleteConversation(req.userID, id);
  }
}
