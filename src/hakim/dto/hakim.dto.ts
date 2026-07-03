// Plain request shapes. The project doesn't use class-validator, so the
// controllers/service validate the few required fields manually.

export interface ChatScope {
  lectureID?: number | null;
  courseID?: number | null;
}

export interface ChatRequest {
  conversationID?: number;
  message: string;
  scope?: ChatScope;
  /**
   * Optional custom message type for the user turn (see hakim.prompts message
   * registry / the client's messageTypes.js). Only affects how the message is
   * rendered and persisted — the model still receives `message` verbatim.
   * Unknown values are coerced to 'text' server-side.
   */
  messageType?: string;
  /**
   * Display-only metadata for the custom message type (e.g. the chosen explain
   * option + question ref). Persisted as jsonb and echoed back on load; never
   * sent to the model. Capped in size and only stored for known messageTypes.
   */
  meta?: Record<string, unknown>;
  /**
   * Requested answer model id (see models.ts). Honoured for admins now; for
   * regular users it's ignored until HAKIM_USER_MODEL_SELECTION is enabled.
   */
  model?: string;
  /**
   * Enable DeepSeek thinking mode for this request. Only applies to models that
   * support it (provider === 'deepseek'). Honoured for admins now; ignored for
   * regular users until HAKIM_USER_THINKING_SELECTION is enabled.
   */
  thinking?: boolean;
  /**
   * Prior turns supplied by the client. Only used in ephemeral mode (admin test
   * page), where nothing is persisted server-side so history can't be loaded.
   */
  history?: { role: 'user' | 'assistant'; content: string }[];
}

export interface ExplainQuestionRequest {
  questionID?: number;
  body: string;
  answers: { content: string; correct?: boolean }[];
  explanation?: string;
  lectureID?: number | null;
  courseID?: number | null;
  /** Requested answer model id (admin-gated; see ChatRequest.model). */
  model?: string;
  /** Enable DeepSeek thinking mode (admin-gated; see ChatRequest.thinking). */
  thinking?: boolean;
}
