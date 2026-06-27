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
}

export interface ExplainQuestionRequest {
  questionID?: number;
  body: string;
  answers: { content: string; correct?: boolean }[];
  explanation?: string;
  lectureID?: number | null;
  courseID?: number | null;
}
