import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OpenAiService, ChatMessage } from './openai.service';
import { SupabaseService } from '../supabase/supabase.service';

export interface RetrievalScope {
  lectureID?: number | null;
  courseID?: number | null;
}

export interface RetrievedContext {
  /** Assembled context text injected into the prompt for this turn only. */
  contextText: string;
  /** IDs of the chunks that made it into the context (stored for auditing). */
  chunkIDs: number[];
  /** Standalone search query produced by the rewrite step. */
  searchQuery: string;
}

interface MatchRow {
  chunkID: number;
  content: string;
  similarity: number;
}

const NO_CONTEXT = 'No relevant context found.';

/**
 * RAG retrieval for Hakim. Improves on the old single-shot approach with a
 * conversation-aware query rewrite, wider recall, a similarity floor, and a
 * token-budgeted assembly (replacing the brittle MAX_DROPOFF filter). The
 * embedding model is fixed to text-embedding-3-small to stay compatible with
 * the already-vectorized hawi_lecture_chunk corpus.
 */
@Injectable()
export class RetrievalService {
  private readonly logger = new Logger(RetrievalService.name);
  private readonly matchCount: number;
  private readonly minSimilarity: number;
  private readonly tokenBudget: number;

  constructor(
    configService: ConfigService,
    private readonly openai: OpenAiService,
    private readonly supabase: SupabaseService,
  ) {
    this.matchCount = parseInt(
      configService.get<string>('HAKIM_MATCH_COUNT') ?? '30',
      10,
    );
    this.minSimilarity = parseFloat(
      configService.get<string>('HAKIM_MIN_SIMILARITY') ?? '0.4',
    );
    this.tokenBudget = parseInt(
      configService.get<string>('HAKIM_CONTEXT_TOKEN_BUDGET') ?? '6000',
      10,
    );
  }

  /**
   * Condense the conversation + latest user turn into a single standalone
   * search query. Fixes follow-ups ("وماذا عن مضاعفاتها؟") that embed terribly
   * on their own. Falls back to the raw message if the rewrite fails.
   */
  async rewriteQuery(
    history: ChatMessage[],
    latestMessage: string,
  ): Promise<string> {
    if (history.length === 0) return latestMessage;

    const transcript = history
      .slice(-6)
      .map((m) => `${m.role === 'user' ? 'Student' : 'Hakim'}: ${m.content}`)
      .join('\n');

    const messages: ChatMessage[] = [
      {
        role: 'system',
        content:
          "You rewrite a medical student's latest message into a single, standalone " +
          'search query for retrieving lecture material. Resolve pronouns and ellipsis ' +
          'using the conversation. Keep the original language (Arabic or English). ' +
          'Output ONLY the query text, nothing else.',
      },
      {
        role: 'user',
        content: `Conversation so far:\n${transcript}\n\nLatest message: ${latestMessage}\n\nStandalone search query:`,
      },
    ];

    try {
      const rewritten = await this.openai.complete(
        messages,
        this.openai.rewriteModel,
      );
      return rewritten && rewritten.length > 0 ? rewritten : latestMessage;
    } catch (err: any) {
      this.logger.warn(
        `Query rewrite failed, using raw message: ${err?.message}`,
      );
      return latestMessage;
    }
  }

  /** Embed the query, search the corpus, and assemble token-budgeted context. */
  async retrieve(
    searchQuery: string,
    scope: RetrievalScope = {},
  ): Promise<RetrievedContext> {
    let chunkIDs: number[] = [];
    let contextText = NO_CONTEXT;

    try {
      const embedding = await this.openai.embed(searchQuery);

      const matches = await this.supabase.rpc<MatchRow[]>(
        'match_lecture_chunks',
        {
          query_embedding: embedding,
          match_count: this.matchCount,
          lecture_id: scope.lectureID ?? null,
          course_id: scope.courseID ?? null,
        },
      );

      const relevant = (matches ?? []).filter(
        (m) => m.similarity >= this.minSimilarity,
      );
      const assembled = this.assemble(relevant);
      if (assembled.chunks.length) {
        chunkIDs = assembled.chunks.map((c) => c.chunkID);
        contextText = assembled.chunks.map((c) => c.content).join('\n\n');
      }
    } catch (err: any) {
      this.logger.error(`Retrieval failed: ${err?.message}`);
    }

    return { contextText, chunkIDs, searchQuery };
  }

  /** Dedupe by content and pack chunks until the token budget is exhausted. */
  private assemble(matches: MatchRow[]): { chunks: MatchRow[] } {
    const seen = new Set<string>();
    const picked: MatchRow[] = [];
    let usedTokens = 0;

    for (const m of matches) {
      const normalized = m.content.trim();
      if (!normalized || seen.has(normalized)) continue;

      const estTokens = this.estimateTokens(normalized);
      if (usedTokens + estTokens > this.tokenBudget && picked.length > 0) break;

      seen.add(normalized);
      picked.push(m);
      usedTokens += estTokens;
    }

    return { chunks: picked };
  }

  /** Rough token estimate (~4 chars/token) — good enough for budgeting. */
  private estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }
}
