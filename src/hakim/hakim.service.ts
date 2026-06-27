import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { SupabaseService } from '../supabase/supabase.service';
import { OpenAiService, ChatMessage } from './openai.service';
import { RetrievalService, RetrievalScope } from './retrieval.service';
import { QuotaService, QuotaDecision } from './quota.service';
import {
  HAKIM_SYSTEM_PROMPT,
  buildContextMessage,
  buildMcqUserPrompt,
} from './hakim.prompts';
import { ChatRequest, ExplainQuestionRequest } from './dto/hakim.dto';

interface ConversationRow {
  conversationID: number;
  userID: number;
  title: string | null;
  scope_type: string;
  lectureID: number | null;
  courseID: number | null;
}

interface MessageRow {
  role: 'user' | 'assistant';
  content: string;
}

const HISTORY_LIMIT = 10;

@Injectable()
export class HakimService {
  private readonly logger = new Logger(HakimService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly openai: OpenAiService,
    private readonly retrieval: RetrievalService,
    private readonly quota: QuotaService,
  ) {}

  // ─── Public SSE endpoints ────────────────────────────────────────────────

  async streamChat(
    userID: number,
    body: ChatRequest,
    req: Request,
    res: Response,
  ): Promise<void> {
    const message = (body?.message ?? '').trim();
    if (!message) throw new BadRequestException('Empty message');

    const scope: RetrievalScope = {
      lectureID: body.scope?.lectureID ?? null,
      courseID: body.scope?.courseID ?? null,
    };

    // Resolve conversation (verifying ownership) before committing to SSE, so
    // a 404/403 returns a normal HTTP error instead of an event-stream error.
    let conversation = body.conversationID
      ? await this.requireOwnedConversation(body.conversationID, userID)
      : null;

    this.initSSE(res);

    try {
      // Gate usage up front — no conversation/message is created if blocked.
      const quota = await this.quota.check(userID);
      if (quota.mode === 'insufficient') {
        this.sendLimit(res, quota);
        return this.end(res);
      }

      const history = conversation
        ? await this.loadHistory(conversation.conversationID)
        : [];

      if (!conversation) {
        conversation = await this.createConversation(userID, {
          scope_type: scope.lectureID
            ? 'lecture'
            : scope.courseID
              ? 'course'
              : 'general',
          lectureID: scope.lectureID ?? null,
          courseID: scope.courseID ?? null,
          title: this.makeTitle(message),
        });
      }

      this.sendEvent(res, {
        type: 'start',
        conversationID: conversation.conversationID,
      });

      await this.persistMessage(conversation, userID, 'user', message);

      const searchQuery = await this.retrieval.rewriteQuery(history, message);
      const retrieved = await this.retrieval.retrieve(searchQuery, scope);

      const modelMessages: ChatMessage[] = [
        { role: 'system', content: HAKIM_SYSTEM_PROMPT },
        ...history,
        buildContextMessage(retrieved.contextText),
        { role: 'user', content: message },
      ];

      await this.streamAndFinalize(
        req,
        res,
        userID,
        conversation,
        modelMessages,
        retrieved.chunkIDs,
        quota,
      );
    } catch (err: any) {
      this.logger.error(`streamChat failed: ${err?.message}`);
      if (!res.writableEnded) {
        this.sendEvent(res, { type: 'error', message: this.publicError(err) });
        this.end(res);
      }
    }
  }

  async streamExplainQuestion(
    userID: number,
    body: ExplainQuestionRequest,
    req: Request,
    res: Response,
  ): Promise<void> {
    if (
      !body?.body ||
      !Array.isArray(body.answers) ||
      body.answers.length === 0
    ) {
      throw new BadRequestException('Invalid question payload');
    }

    const scope: RetrievalScope = {
      lectureID: body.lectureID ?? null,
      courseID: body.courseID ?? null,
    };

    this.initSSE(res);

    try {
      const quota = await this.quota.check(userID);
      if (quota.mode === 'insufficient') {
        this.sendLimit(res, quota);
        return this.end(res);
      }

      const conversation = await this.createConversation(userID, {
        scope_type: 'question',
        lectureID: scope.lectureID ?? null,
        courseID: scope.courseID ?? null,
        title: body.questionID ? `شرح سؤال #${body.questionID}` : 'شرح سؤال',
      });

      this.sendEvent(res, {
        type: 'start',
        conversationID: conversation.conversationID,
      });

      const userPrompt = buildMcqUserPrompt(body);
      await this.persistMessage(conversation, userID, 'user', userPrompt);

      const searchText = `${body.body}\n${body.answers.map((a) => a.content).join('\n')}`;
      const retrieved = await this.retrieval.retrieve(searchText, scope);

      const modelMessages: ChatMessage[] = [
        { role: 'system', content: HAKIM_SYSTEM_PROMPT },
        buildContextMessage(retrieved.contextText),
        { role: 'user', content: userPrompt },
      ];

      await this.streamAndFinalize(
        req,
        res,
        userID,
        conversation,
        modelMessages,
        retrieved.chunkIDs,
        quota,
      );
    } catch (err: any) {
      this.logger.error(`streamExplainQuestion failed: ${err?.message}`);
      if (!res.writableEnded) {
        this.sendEvent(res, { type: 'error', message: this.publicError(err) });
        this.end(res);
      }
    }
  }

  // ─── Conversation read endpoints ─────────────────────────────────────────

  async listConversations(userID: number) {
    const conversations = await this.supabase.select(
      'hawi_hakim_conversation',
      `userID=eq.${userID}&select=conversationID,title,scope_type,lectureID,courseID,last_message_at,created_at` +
        `&order=last_message_at.desc.nullslast&limit=50`,
    );
    return { conversations };
  }

  async getConversation(userID: number, conversationID: number) {
    await this.requireOwnedConversation(conversationID, userID);
    const messages = await this.supabase.select(
      'hawi_hakim_message',
      `conversationID=eq.${conversationID}` +
        `&select=messageID,role,content,context_chunk_ids,charged_points,created_at` +
        `&order=created_at.asc`,
    );
    return { messages };
  }

  async deleteConversation(userID: number, conversationID: number) {
    await this.requireOwnedConversation(conversationID, userID);
    await this.supabase.delete(
      'hawi_hakim_message',
      `conversationID=eq.${conversationID}`,
    );
    await this.supabase.delete(
      'hawi_hakim_conversation',
      `conversationID=eq.${conversationID}`,
    );
    return { deleted: true };
  }

  // ─── Core streaming + finalize ───────────────────────────────────────────

  private async streamAndFinalize(
    req: Request,
    res: Response,
    userID: number,
    conversation: ConversationRow,
    modelMessages: ChatMessage[],
    contextChunkIDs: number[],
    quota: QuotaDecision,
  ): Promise<void> {
    const controller = new AbortController();
    const onClose = () => controller.abort();
    req.on('close', onClose);

    let assistantText = '';
    let finalized = false;

    try {
      const { stream, getUsage } = await this.openai.chatStream(modelMessages, {
        signal: controller.signal,
      });

      for await (const delta of stream) {
        assistantText += delta;
        this.sendEvent(res, { type: 'token', value: delta });
      }

      // Stream completed normally — persist the answer and settle the charge.
      const saved = await this.persistMessage(
        conversation,
        userID,
        'assistant',
        assistantText,
        {
          context_chunk_ids: contextChunkIDs,
          charged_points: quota.mode === 'charged' ? quota.cost : 0,
          usage: getUsage(),
        },
      );
      await this.touchConversation(conversation.conversationID);
      if (quota.mode === 'charged') {
        await this.quota.recordUsage(userID, quota.cost);
      }
      finalized = true;

      this.sendEvent(res, {
        type: 'done',
        conversationID: conversation.conversationID,
        messageID: saved?.messageID ?? null,
      });
      this.end(res);
    } catch (err: any) {
      // Aborted (client disconnect) or generation error after we may have charged.
      if (quota.mode === 'charged') {
        await this.quota.refund(userID, quota.cost);
      }
      // Keep a coherent history if we got partial text; it was effectively free.
      if (assistantText.trim().length > 0) {
        await this.persistMessage(
          conversation,
          userID,
          'assistant',
          assistantText,
          {
            context_chunk_ids: contextChunkIDs,
            charged_points: 0,
          },
        );
        await this.touchConversation(conversation.conversationID);
      }
      if (!finalized && !res.writableEnded) {
        if (!controller.signal.aborted) {
          this.sendEvent(res, {
            type: 'error',
            message: this.publicError(err),
          });
        }
        this.end(res);
      }
    } finally {
      req.off('close', onClose);
    }
  }

  // ─── Persistence helpers ─────────────────────────────────────────────────

  private async requireOwnedConversation(
    conversationID: number,
    userID: number,
  ): Promise<ConversationRow> {
    const conversation = await this.supabase.selectOne<ConversationRow>(
      'hawi_hakim_conversation',
      `conversationID=eq.${conversationID}&select=conversationID,userID,title,scope_type,lectureID,courseID`,
    );
    if (!conversation) throw new NotFoundException('Conversation not found');
    if (Number(conversation.userID) !== Number(userID)) {
      throw new ForbiddenException('Not your conversation');
    }
    return conversation;
  }

  private async createConversation(
    userID: number,
    fields: {
      scope_type: string;
      lectureID: number | null;
      courseID: number | null;
      title: string;
    },
  ): Promise<ConversationRow> {
    const row = await this.supabase.insert<ConversationRow>(
      'hawi_hakim_conversation',
      { userID, ...fields, last_message_at: new Date().toISOString() },
      true,
    );
    if (!row) throw new Error('Failed to create conversation');
    return row;
  }

  private async loadHistory(conversationID: number): Promise<ChatMessage[]> {
    const rows = await this.supabase.select<MessageRow>(
      'hawi_hakim_message',
      `conversationID=eq.${conversationID}&select=role,content&order=created_at.desc&limit=${HISTORY_LIMIT}`,
    );
    return rows.reverse().map((r) => ({ role: r.role, content: r.content }));
  }

  private async persistMessage(
    conversation: ConversationRow,
    userID: number,
    role: 'user' | 'assistant',
    content: string,
    extra: Record<string, any> = {},
  ): Promise<{ messageID: number } | null> {
    return this.supabase.insert<{ messageID: number }>(
      'hawi_hakim_message',
      {
        conversationID: conversation.conversationID,
        userID,
        role,
        content,
        ...extra,
      },
      true,
    );
  }

  private async touchConversation(conversationID: number): Promise<void> {
    const now = new Date().toISOString();
    await this.supabase.update(
      'hawi_hakim_conversation',
      `conversationID=eq.${conversationID}`,
      { last_message_at: now, updated_at: now },
    );
  }

  private makeTitle(message: string): string {
    const trimmed = message.replace(/\s+/g, ' ').trim();
    return trimmed.length > 60 ? `${trimmed.slice(0, 57)}…` : trimmed;
  }

  // ─── SSE helpers ─────────────────────────────────────────────────────────

  private initSSE(res: Response): void {
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // disable proxy buffering
    res.flushHeaders?.();
  }

  private sendEvent(res: Response, payload: Record<string, any>): void {
    if (res.writableEnded) return;
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  }

  private sendLimit(res: Response, quota: QuotaDecision): void {
    this.sendEvent(res, {
      type: 'limit',
      reason: 'insufficient_points',
      freeLimit: quota.freeLimit,
      cost: quota.cost,
      usesToday: quota.usesToday,
    });
  }

  private end(res: Response): void {
    if (!res.writableEnded) res.end();
  }

  private publicError(err: any): string {
    // Surface intentional HTTP errors (bad request, not found, forbidden);
    // mask everything else behind a generic message.
    if (err instanceof HttpException) return err.message;
    return 'Hakim could not complete your request';
  }
}
