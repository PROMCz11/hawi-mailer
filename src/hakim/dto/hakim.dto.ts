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
   * Requested answer model id (see models.ts). Honoured for admins now; for
   * regular users it's ignored until HAKIM_USER_MODEL_SELECTION is enabled.
   */
  model?: string;
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
}
