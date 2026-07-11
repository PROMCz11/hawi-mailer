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
  /**
   * Codename shown to regular users instead of `id`/`label`, so the real
   * provider/model never leaves the server for non-admin traffic (see
   * toPublicModel). Also accepted as an input alongside the real id in
   * findModel, so older callers sending the real id keep working.
   */
  alias: string;
  aliasLabel: string;
}

/** What non-admin callers get back — never the real id/label/provider. */
export interface PublicHakimModelInfo {
  id: string;
  label: string;
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
    alias: 'fast',
    aliasLabel: 'Fast',
  },
  {
    id: 'deepseek-v4-pro',
    label: 'DeepSeek V4 Pro',
    provider: 'deepseek',
    thinking: true,
    alias: 'smart',
    aliasLabel: 'Smart',
  },
  {
    id: 'gpt-5-mini',
    label: 'GPT-5 Mini',
    provider: 'openai',
    thinking: false,
    alias: 'light',
    aliasLabel: 'Light',
  },
  {
    id: 'gpt-5.4-mini',
    label: 'GPT-5.4 Mini',
    provider: 'openai',
    thinking: false,
    alias: 'plus',
    aliasLabel: 'Plus',
  },
  {
    id: 'gpt-5',
    label: 'GPT-5',
    provider: 'openai',
    thinking: false,
    alias: 'genius',
    aliasLabel: 'Genius',
  },
];

const MODELS_BY_ID = new Map(HAKIM_MODELS.map((m) => [m.id, m]));
const MODELS_BY_ALIAS = new Map(HAKIM_MODELS.map((m) => [m.alias, m]));

/**
 * Look up a model by its real id or its public alias, or undefined if it
 * isn't a known/allowed model. Accepting both keeps older callers that still
 * send the real id (e.g. hardcoded content-generation features) working.
 */
export function findModel(id?: string | null): HakimModelInfo | undefined {
  if (!id) return undefined;
  return MODELS_BY_ID.get(id) ?? MODELS_BY_ALIAS.get(id);
}

/**
 * Public-facing view of a model. Admin (ephemeral) callers see the real
 * id/label so /control/hakim stays useful for debugging; everyone else gets
 * the codename so the real provider/model never leaves the server.
 */
export function toPublicModel(
  model: HakimModelInfo,
  revealReal: boolean,
): PublicHakimModelInfo {
  return revealReal
    ? { id: model.id, label: model.label, thinking: model.thinking }
    : { id: model.alias, label: model.aliasLabel, thinking: model.thinking };
}
