import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
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
import { HAKIM_MODELS, HakimModelInfo } from './models';

/**
 * Who is making the request. `ephemeral` requests (super/ambassador admins on
 * the /control test page) get unlimited usage and persist nothing — their
 * userID is null and history is supplied by the client.
 */
export interface HakimAuth {
  userID: number | null;
  ephemeral: boolean;
}

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
  private readonly userModelSelection: boolean;
  private readonly userThinkingSelection: boolean;
  private readonly defaultThinking: boolean;

  constructor(
    private readonly supabase: SupabaseService,
    private readonly openai: OpenAiService,
    private readonly retrieval: RetrievalService,
    private readonly quota: QuotaService,
    configService: ConfigService,
  ) {
    this.userModelSelection =
      (configService.get<string>('HAKIM_USER_MODEL_SELECTION') ?? 'false') ===
      'true';
    this.userThinkingSelection =
      (configService.get<string>('HAKIM_USER_THINKING_SELECTION') ??
        'false') === 'true';
    this.defaultThinking =
      (configService.get<string>('HAKIM_DEFAULT_THINKING') ?? 'false') ===
      'true';
  }

  /**
   * courseIDs explicitly approved for user-facing Hakim (hawi_course.hakim_supported).
   * Used by the app to filter the user's owned-bank courses down to ones
   * worth offering as a chat scope — without this, a user could scope a
   * conversation to a course Hakim doesn't serve and get rejected with no
   * warning beforehand. Open to any authenticated caller (not admin-gated
   * like /hakim/ingestion/*) since it leaks no admin-only detail, just IDs.
   * Distinct from ingestion status (chunk_count > 0, used by the admin-only
   * /control/hakim* pages) — a course can be ingested without being
   * published yet.
   */
  async supportedCourseIDs(): Promise<{ courseIDs: number[] }> {
    const courses = await this.supabase.select<{ courseID: number }>(
      'hawi_course',
      'hakim_supported=eq.true&select=courseID',
    );
    return { courseIDs: courses.map((c) => Number(c.courseID)) };
  }

  /**
   * Reject scoping to a courseID that hasn't been explicitly approved for
   * users (hawi_course.hakim_supported). Only applies to real (non-ephemeral)
   * callers — admin testers on /control/hakim can scope to any ingested
   * course regardless of publish status. Mirrors the quota "insufficient"
   * early-return: sends a terminal SSE event and ends the stream before any
   * quota check or message is persisted, so a rejected course never costs
   * the user a free use or points. Returns true if the request was rejected
   * (caller must stop).
   */
  private async rejectIfUnsupportedCourse(
    auth: HakimAuth,
    res: Response,
    courseID: number | null | undefined,
  ): Promise<boolean> {
    if (auth.ephemeral || !courseID) return false;

    const course = await this.supabase.selectOne<{
      hakim_supported: boolean;
    }>('hawi_course', `courseID=eq.${courseID}&select=hakim_supported`);

    if (course?.hakim_supported) return false;

    this.sendEvent(res, { type: 'unsupported_course', courseID });
    this.end(res);
    return true;
  }

  /**
   * Reject a chat turn that has no courseID at all. Only applies to real
   * (non-ephemeral) callers — admin testers on /control/hakim can still run
   * unscoped test conversations. The app now requires users to pick a course
   * before starting or resuming a conversation, but this is the actual gate:
   * without it, a stale client or a direct API call could still create/
   * continue a general/unscoped conversation. Mirrors rejectIfUnsupportedCourse
   * — sends a terminal SSE event and ends the stream before quota or
   * persistence, so a rejected turn never costs the user a free use or points.
   * Returns true if the request was rejected (caller must stop).
   */
  private rejectIfCourseRequired(
    auth: HakimAuth,
    res: Response,
    courseID: number | null | undefined,
  ): boolean {
    if (auth.ephemeral || courseID) return false;

    this.sendEvent(res, { type: 'course_required' });
    this.end(res);
    return true;
  }

  /** Models available to the caller + which one is the default. */
  listModels(auth: HakimAuth) {
    const selectable = auth.ephemeral || this.userModelSelection;
    const thinkingSelectable = auth.ephemeral || this.userThinkingSelection;
    return {
      models: HAKIM_MODELS,
      default: this.openai.resolveModel().id,
      selectable,
      defaultThinking: this.defaultThinking,
      thinkingSelectable,
    };
  }

  /**
   * Pick the answer model. Selection is locked unless the caller is an admin
   * (ephemeral) or user-selection has been globally enabled; otherwise the
   * requested model is ignored and the default is used.
   */
  private resolveModel(auth: HakimAuth, requested?: string): HakimModelInfo {
    const allowed = auth.ephemeral || this.userModelSelection;
    return this.openai.resolveModel(allowed ? requested : undefined);
  }

  /**
   * Whether to enable thinking for this request. Only meaningful on DeepSeek
   * models. Admins can choose; regular users are locked to the default until
   * HAKIM_USER_THINKING_SELECTION is enabled.
   */
  private resolveThinking(auth: HakimAuth, requested?: boolean): boolean {
    const allowed = auth.ephemeral || this.userThinkingSelection;
    return allowed && requested !== undefined
      ? requested
      : this.defaultThinking;
  }

  // ─── Public SSE endpoints ────────────────────────────────────────────────

  async streamChat(
    auth: HakimAuth,
    body: ChatRequest,
    req: Request,
    res: Response,
  ): Promise<void> {
    const message = (body?.message ?? '').trim();
    if (!message) throw new BadRequestException('Empty message');

    // Resolve conversation (verifying ownership) before committing to SSE, so a
    // 404/403 returns a normal HTTP error instead of an event-stream error.
    // Ephemeral (admin) requests never touch persisted conversations.
    let conversation =
      body.conversationID && !auth.ephemeral
        ? await this.requireOwnedConversation(body.conversationID, auth.userID!)
        : null;

    // A resumed conversation keeps its original scope unless the client
    // explicitly sends one for this turn — otherwise reopening a course-scoped
    // chat and asking a follow-up would silently fall back to unscoped/general
    // retrieval (the app's scope selector resets per session).
    const scope: RetrievalScope = {
      lectureID: body.scope?.lectureID ?? conversation?.lectureID ?? null,
      courseID: body.scope?.courseID ?? conversation?.courseID ?? null,
    };
    const model = this.resolveModel(auth, body.model);
    const thinkingEnabled = this.resolveThinking(auth, body.thinking);

    this.initSSE(res);

    try {
      if (this.rejectIfCourseRequired(auth, res, scope.courseID)) {
        return;
      }

      if (await this.rejectIfUnsupportedCourse(auth, res, scope.courseID)) {
        return;
      }

      const quota = auth.ephemeral
        ? this.unlimitedQuota()
        : await this.quota.check(auth.userID!);
      if (quota.mode === 'insufficient') {
        this.sendLimit(res, quota);
        return this.end(res);
      }

      const history = auth.ephemeral
        ? this.clientHistory(body.history)
        : conversation
          ? await this.loadHistory(conversation.conversationID)
          : [];

      if (!auth.ephemeral && !conversation) {
        conversation = await this.createConversation(auth.userID!, {
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
        conversationID: conversation?.conversationID ?? null,
        ephemeral: auth.ephemeral,
        model: model.id,
        thinking: model.thinking && thinkingEnabled,
      });

      if (conversation) {
        await this.persistMessage(conversation, auth.userID!, 'user', message);
      }

      const searchQuery = await this.retrieval.rewriteQuery(history, message);
      const retrieved = await this.retrieval.retrieve(
        searchQuery,
        scope,
        !auth.ephemeral,
      );

      const modelMessages: ChatMessage[] = [
        { role: 'system', content: HAKIM_SYSTEM_PROMPT },
        ...history,
        buildContextMessage(retrieved.contextText),
        { role: 'user', content: message },
      ];

      await this.streamAndFinalize(
        req,
        res,
        auth.userID,
        conversation,
        modelMessages,
        retrieved.chunkIDs,
        quota,
        model,
        thinkingEnabled,
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
    auth: HakimAuth,
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
    const model = this.resolveModel(auth, body.model);
    const thinkingEnabled = this.resolveThinking(auth, body.thinking);

    this.initSSE(res);

    try {
      if (await this.rejectIfUnsupportedCourse(auth, res, scope.courseID)) {
        return;
      }

      const quota = auth.ephemeral
        ? this.unlimitedQuota()
        : await this.quota.check(auth.userID!);
      if (quota.mode === 'insufficient') {
        this.sendLimit(res, quota);
        return this.end(res);
      }

      const conversation = auth.ephemeral
        ? null
        : await this.createConversation(auth.userID!, {
            scope_type: 'question',
            lectureID: scope.lectureID ?? null,
            courseID: scope.courseID ?? null,
            title: body.questionID
              ? `شرح سؤال #${body.questionID}`
              : 'شرح سؤال',
          });

      this.sendEvent(res, {
        type: 'start',
        conversationID: conversation?.conversationID ?? null,
        ephemeral: auth.ephemeral,
        model: model.id,
        thinking: model.thinking && thinkingEnabled,
      });

      const userPrompt = buildMcqUserPrompt(body);
      if (conversation) {
        await this.persistMessage(
          conversation,
          auth.userID!,
          'user',
          userPrompt,
        );
      }

      const searchText = `${body.body}\n${body.answers.map((a) => a.content).join('\n')}`;
      const retrieved = await this.retrieval.retrieve(
        searchText,
        scope,
        !auth.ephemeral,
      );

      const modelMessages: ChatMessage[] = [
        { role: 'system', content: HAKIM_SYSTEM_PROMPT },
        buildContextMessage(retrieved.contextText),
        { role: 'user', content: userPrompt },
      ];

      await this.streamAndFinalize(
        req,
        res,
        auth.userID,
        conversation,
        modelMessages,
        retrieved.chunkIDs,
        quota,
        model,
        thinkingEnabled,
      );
    } catch (err: any) {
      this.logger.error(`streamExplainQuestion failed: ${err?.message}`);
      if (!res.writableEnded) {
        this.sendEvent(res, { type: 'error', message: this.publicError(err) });
        this.end(res);
      }
    }
  }

  // ─── Conversation read endpoints (real users only) ───────────────────────

  async listConversations(userID: number) {
    const conversations = await this.supabase.select(
      'hawi_hakim_conversation',
      `userID=eq.${userID}&select=conversationID,title,scope_type,lectureID,courseID,last_message_at,created_at` +
        `&order=last_message_at.desc.nullslast&limit=50`,
    );
    return { conversations };
  }

  async getConversation(userID: number, conversationID: number) {
    const conversation = await this.requireOwnedConversation(
      conversationID,
      userID,
    );
    const messages = await this.supabase.select(
      'hawi_hakim_message',
      `conversationID=eq.${conversationID}` +
        `&select=messageID,role,content,context_chunk_ids,charged_points,created_at` +
        `&order=created_at.asc`,
    );
    // Scope is included so the client can restore the course/lecture selector
    // when reopening a conversation — without it, resuming a scoped chat in
    // the UI looks unscoped even though the server still retrieves correctly
    // (streamChat falls back to the conversation's persisted scope).
    return {
      conversation: {
        conversationID: conversation.conversationID,
        title: conversation.title,
        scope_type: conversation.scope_type,
        lectureID: conversation.lectureID,
        courseID: conversation.courseID,
      },
      messages,
    };
  }

  async renameConversation(
    userID: number,
    conversationID: number,
    title: string,
  ) {
    await this.requireOwnedConversation(conversationID, userID);
    const clean = (title ?? '').replace(/\s+/g, ' ').trim();
    if (!clean) throw new BadRequestException('Title cannot be empty');
    const capped = clean.length > 80 ? clean.slice(0, 80) : clean;
    await this.supabase.update(
      'hawi_hakim_conversation',
      `conversationID=eq.${conversationID}`,
      { title: capped, updated_at: new Date().toISOString() },
    );
    return { conversationID, title: capped };
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
    userID: number | null,
    conversation: ConversationRow | null,
    modelMessages: ChatMessage[],
    contextChunkIDs: number[],
    quota: QuotaDecision,
    model: HakimModelInfo,
    thinkingEnabled: boolean,
  ): Promise<void> {
    const controller = new AbortController();
    const onClose = () => controller.abort();
    req.on('close', onClose);

    let assistantText = '';
    let reasoningText = '';
    let finalized = false;

    try {
      const { stream, getUsage } = await this.openai.chatStream(modelMessages, {
        model,
        thinkingEnabled,
        signal: controller.signal,
      });

      for await (const delta of stream) {
        if (delta.kind === 'reasoning') {
          reasoningText += delta.value;
          this.sendEvent(res, { type: 'reasoning', value: delta.value });
        } else {
          assistantText += delta.value;
          this.sendEvent(res, { type: 'token', value: delta.value });
        }
      }

      // Stream completed normally — persist the answer (real users) and settle
      // the charge. Ephemeral admin tests have no conversation, so they skip it.
      let saved: { messageID: number } | null = null;
      if (conversation) {
        saved = await this.persistMessage(
          conversation,
          userID!,
          'assistant',
          assistantText,
          {
            context_chunk_ids: contextChunkIDs,
            charged_points: quota.mode === 'charged' ? quota.cost : 0,
            usage: this.buildUsage(getUsage(), model, reasoningText),
          },
        );
        await this.touchConversation(conversation.conversationID);
      }
      if (quota.mode === 'charged' && userID != null) {
        await this.quota.recordUsage(userID, quota.cost);
      }
      finalized = true;

      this.sendEvent(res, {
        type: 'done',
        conversationID: conversation?.conversationID ?? null,
        messageID: saved?.messageID ?? null,
      });
      this.end(res);
    } catch (err: any) {
      // Aborted (client disconnect) or generation error after we may have charged.
      if (quota.mode === 'charged' && userID != null) {
        await this.quota.refund(userID, quota.cost);
      }
      // Keep a coherent history if we got partial text; it was effectively free.
      if (conversation && assistantText.trim().length > 0) {
        await this.persistMessage(
          conversation,
          userID!,
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

  /** Sanitise and cap client-supplied history (ephemeral mode only). */
  private clientHistory(history: ChatRequest['history']): ChatMessage[] {
    if (!Array.isArray(history)) return [];
    return history
      .filter(
        (m) =>
          m &&
          (m.role === 'user' || m.role === 'assistant') &&
          typeof m.content === 'string' &&
          m.content.trim().length > 0,
      )
      .slice(-HISTORY_LIMIT)
      .map((m) => ({ role: m.role, content: m.content }));
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

  private unlimitedQuota(): QuotaDecision {
    return { mode: 'free', cost: 0, usesToday: 0, freeLimit: 0 };
  }

  /**
   * Assemble the message `usage` jsonb: token counts plus the model that
   * answered and (for thinking models) the captured chain-of-thought, so it
   * isn't lost even though we don't surface it to regular users yet.
   */
  private buildUsage(
    tokenUsage: Record<string, number> | null,
    model: HakimModelInfo,
    reasoning: string,
  ): Record<string, any> {
    const usage: Record<string, any> = {
      ...(tokenUsage ?? {}),
      model: model.id,
    };
    if (reasoning.trim().length > 0) usage.reasoning = reasoning;
    return usage;
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
