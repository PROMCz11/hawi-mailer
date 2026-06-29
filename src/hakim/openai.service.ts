import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { DEFAULT_ANSWER_MODEL, HakimModelInfo, findModel } from './models';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/** A single streamed delta — either visible answer text or thinking tokens. */
export interface StreamChunk {
  kind: 'content' | 'reasoning';
  value: string;
}

export interface StreamResult {
  /** Yields content + reasoning deltas as they arrive. */
  stream: AsyncIterable<StreamChunk>;
  /** Resolves with token usage once the stream is fully consumed. */
  getUsage: () => Record<string, number> | null;
}

/** DeepSeek (and other reasoning providers) add this onto the streamed delta. */
interface ReasoningDelta {
  content?: string | null;
  reasoning_content?: string | null;
}

const DEEPSEEK_BASE_URL = 'https://api.deepseek.com';

/**
 * Wrapper around the OpenAI SDK that fronts two OpenAI-compatible providers:
 * OpenAI itself (embeddings, query-rewrite, GPT-5 answers) and DeepSeek (V4
 * answers, base_url swapped). Embeddings + rewrite always go to OpenAI; only the
 * answer stream is provider-aware, picked from the model registry.
 */
@Injectable()
export class OpenAiService {
  private readonly logger = new Logger(OpenAiService.name);
  private readonly openaiClient: OpenAI;
  private readonly deepseekClient: OpenAI | null;
  readonly embeddingModel: string;
  readonly rewriteModel: string;
  private readonly defaultAnswerModelID: string;

  constructor(configService: ConfigService) {
    this.openaiClient = new OpenAI({
      apiKey: configService.getOrThrow<string>('OPENAI_API_KEY'),
    });

    const deepseekKey = configService.get<string>('DEEPSEEK_API_KEY');
    this.deepseekClient = deepseekKey
      ? new OpenAI({ apiKey: deepseekKey, baseURL: DEEPSEEK_BASE_URL })
      : null;

    this.embeddingModel =
      configService.get<string>('HAKIM_EMBEDDING_MODEL') ??
      'text-embedding-3-small';
    this.rewriteModel =
      configService.get<string>('HAKIM_REWRITE_MODEL') ?? 'gpt-5-nano';
    this.defaultAnswerModelID =
      configService.get<string>('HAKIM_ANSWER_MODEL') ?? DEFAULT_ANSWER_MODEL;
  }

  /** Resolve a (possibly requested) model id to a known model, else default. */
  resolveModel(requested?: string | null): HakimModelInfo {
    return (
      findModel(requested) ??
      findModel(this.defaultAnswerModelID) ??
      findModel(DEFAULT_ANSWER_MODEL)!
    );
  }

  async embed(input: string): Promise<number[]> {
    const res = await this.openaiClient.embeddings.create({
      model: this.embeddingModel,
      input: input.trim(),
    });
    return res.data[0].embedding;
  }

  /** Embed many strings in one call (used when ingesting lecture chunks). */
  async embedBatch(inputs: string[]): Promise<number[][]> {
    if (inputs.length === 0) return [];
    const res = await this.openaiClient.embeddings.create({
      model: this.embeddingModel,
      input: inputs,
    });
    // Preserve input order (the API returns items with an `index`).
    return res.data
      .sort((a, b) => a.index - b.index)
      .map((item) => item.embedding);
  }

  /** Non-streaming completion. Used for the small structured rewrite call. */
  async complete(messages: ChatMessage[], model?: string): Promise<string> {
    const res = await this.openaiClient.chat.completions.create({
      model: model ?? this.rewriteModel,
      messages,
    });
    return res.choices[0]?.message?.content?.trim() ?? '';
  }

  /**
   * Streaming chat completion. Routes to the model's provider, enables thinking
   * for DeepSeek, and yields content + reasoning deltas separately so callers
   * can render the chain-of-thought. Usage is populated once the stream drains.
   */
  async chatStream(
    messages: ChatMessage[],
    opts: {
      model: HakimModelInfo;
      thinkingEnabled?: boolean;
      signal?: AbortSignal;
    },
  ): Promise<StreamResult> {
    const model = opts.model;
    const client =
      model.provider === 'deepseek'
        ? this.requireDeepseek()
        : this.openaiClient;

    const body: Record<string, unknown> = {
      model: model.id,
      messages,
      stream: true,
      stream_options: { include_usage: true },
    };
    // DeepSeek V4 supports toggling thinking per-request. We pass the explicit
    // type so behaviour matches the caller's intent regardless of account defaults.
    if (model.provider === 'deepseek') {
      body.thinking = { type: opts.thinkingEnabled ? 'enabled' : 'disabled' };
    }

    const completion = await client.chat.completions.create(
      body as unknown as OpenAI.Chat.ChatCompletionCreateParamsStreaming,
      { signal: opts.signal },
    );

    let usage: Record<string, number> | null = null;

    async function* iterate(): AsyncIterable<StreamChunk> {
      for await (const chunk of completion) {
        if (chunk.usage) {
          usage = chunk.usage as unknown as Record<string, number>;
        }
        const delta = chunk.choices[0]?.delta as ReasoningDelta | undefined;
        if (delta?.reasoning_content) {
          yield { kind: 'reasoning', value: delta.reasoning_content };
        }
        if (delta?.content) {
          yield { kind: 'content', value: delta.content };
        }
      }
    }

    return { stream: iterate(), getUsage: () => usage };
  }

  private requireDeepseek(): OpenAI {
    if (!this.deepseekClient) {
      this.logger.error(
        'DeepSeek model requested but DEEPSEEK_API_KEY is unset',
      );
      throw new Error('DeepSeek is not configured');
    }
    return this.deepseekClient;
  }
}
