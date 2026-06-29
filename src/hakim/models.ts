/**
 * Catalogue of answer models Hakim can run. Selection is implemented end-to-end
 * (DTO → service → provider) but locked to admins for now; regular users always
 * get the default until HAKIM_USER_MODEL_SELECTION is flipped on (see
 * HakimService.resolveModel). Embeddings + query-rewrite are NOT covered here —
 * those stay pinned to OpenAI regardless of the chosen answer model.
 */
export type ModelProvider = 'openai' | 'deepseek';

export interface HakimModelInfo {
  /** API model id sent to the provider. */
  id: string;
  /** Human label for the picker. */
  label: string;
  provider: ModelProvider;
  /**
   * True when the model streams a visible chain-of-thought we can render
   * (DeepSeek V4 in thinking mode emits `delta.reasoning_content`). OpenAI's
   * GPT-5 family reasons internally but never exposes those tokens, so it's
   * false there.
   */
  thinking: boolean;
}

/** The default answerer when none is requested / selection is locked. */
export const DEFAULT_ANSWER_MODEL = 'deepseek-v4-flash';

/**
 * Ordered registry. Order is the display order in the picker. Only ids present
 * here are selectable — anything else falls back to the default.
 */
export const HAKIM_MODELS: HakimModelInfo[] = [
  {
    id: 'deepseek-v4-flash',
    label: 'DeepSeek V4 Flash',
    provider: 'deepseek',
    thinking: true,
  },
  {
    id: 'deepseek-v4-pro',
    label: 'DeepSeek V4 Pro',
    provider: 'deepseek',
    thinking: true,
  },
  {
    id: 'gpt-5-mini',
    label: 'GPT-5 Mini',
    provider: 'openai',
    thinking: false,
  },
  {
    id: 'gpt-5.4-mini',
    label: 'GPT-5.4 Mini',
    provider: 'openai',
    thinking: false,
  },
  {
    id: 'gpt-5',
    label: 'GPT-5',
    provider: 'openai',
    thinking: false,
  },
];

const MODELS_BY_ID = new Map(HAKIM_MODELS.map((m) => [m.id, m]));

/** Look up a model by id, or undefined if it isn't a known/allowed model. */
export function findModel(id?: string | null): HakimModelInfo | undefined {
  if (!id) return undefined;
  return MODELS_BY_ID.get(id);
}
