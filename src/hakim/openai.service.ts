import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface StreamResult {
  /** Yields content deltas as they arrive. */
  stream: AsyncIterable<string>;
  /** Resolves with token usage once the stream is fully consumed. */
  getUsage: () => Record<string, number> | null;
}

/**
 * Thin wrapper around the OpenAI SDK. Keeps model ids configurable and exposes
 * just the two calls Hakim needs: a non-streaming completion (for the cheap
 * query-rewrite step) and a streaming chat completion (for answers).
 */
@Injectable()
export class OpenAiService {
  private readonly logger = new Logger(OpenAiService.name);
  private readonly client: OpenAI;
  readonly embeddingModel: string;
  readonly answerModel: string;
  readonly rewriteModel: string;

  constructor(configService: ConfigService) {
    this.client = new OpenAI({
      apiKey: configService.getOrThrow<string>('OPENAI_API_KEY'),
    });
    this.embeddingModel =
      configService.get<string>('HAKIM_EMBEDDING_MODEL') ??
      'text-embedding-3-small';
    this.answerModel =
      configService.get<string>('HAKIM_ANSWER_MODEL') ?? 'gpt-5-mini';
    this.rewriteModel =
      configService.get<string>('HAKIM_REWRITE_MODEL') ?? 'gpt-5-nano';
  }

  async embed(input: string): Promise<number[]> {
    const res = await this.client.embeddings.create({
      model: this.embeddingModel,
      input: input.trim(),
    });
    return res.data[0].embedding;
  }

  /** Non-streaming completion. Used for the small structured rewrite call. */
  async complete(messages: ChatMessage[], model?: string): Promise<string> {
    const res = await this.client.chat.completions.create({
      model: model ?? this.rewriteModel,
      messages,
    });
    return res.choices[0]?.message?.content?.trim() ?? '';
  }

  /**
   * Streaming chat completion. Returns an async iterable of content deltas plus
   * a getter for the final usage (populated once the stream is drained).
   */
  async chatStream(
    messages: ChatMessage[],
    opts: { model?: string; signal?: AbortSignal } = {},
  ): Promise<StreamResult> {
    const completion = await this.client.chat.completions.create(
      {
        model: opts.model ?? this.answerModel,
        messages,
        stream: true,
        stream_options: { include_usage: true },
      },
      { signal: opts.signal },
    );

    let usage: Record<string, number> | null = null;

    async function* iterate(): AsyncIterable<string> {
      for await (const chunk of completion) {
        if (chunk.usage) {
          usage = chunk.usage as unknown as Record<string, number>;
        }
        const delta = chunk.choices[0]?.delta?.content;
        if (delta) yield delta;
      }
    }

    return { stream: iterate(), getUsage: () => usage };
  }
}
