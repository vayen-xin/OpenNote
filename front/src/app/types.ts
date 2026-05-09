export type QuestionType = "fill" | "single_choice";
export type QuestionStatus = "correct" | "wrong" | "unanswered" | "pending_review";
export type DoodleLayer = "question_area" | "answer_area" | "full_canvas";
export type DoodleTool = "pen" | "eraser";

export interface QuestionBank {
  id: number;
  name: string;
}

export interface ChapterSummary {
  id: number;
  bankId: number;
  title: string;
  sortNo: number;
  totalQuestions: number;
  completedQuestions: number;
  accuracy: number;
}

export interface QuestionOption {
  key: string;
  text: string;
}

export interface QuestionDetail {
  id: number;
  bankId: number;
  chapterId: number;
  chapterTitle: string;
  sortNo: number;
  type: QuestionType;
  stem: string;
  options: QuestionOption[];
  explanation: string;
  status: QuestionStatus;
  selectedAnswerIndex?: number;
}

export interface QuestionListItem {
  id: number;
  bankId: number;
  chapterId: number;
  chapterTitle: string;
  sortNo: number;
  type: QuestionType;
  status: QuestionStatus;
  selectedAnswerIndex?: number;
}

export interface AttemptRequest {
  answer?: string | number | null;
  status?: QuestionStatus;
}

export interface AttemptResponse {
  questionId: number;
  status: QuestionStatus;
  selectedAnswerIndex?: number;
}

export interface ProgressSummary {
  bankId: number;
  total: number;
  completed: number;
  correct: number;
  wrong: number;
  accuracy: number;
}

export interface DoodlePoint {
  nx: number;
  ny: number;
  t: number;
}

export interface DoodleStroke {
  seqNo: number;
  tool: DoodleTool;
  color: string;
  width: number;
  points: DoodlePoint[];
}

export interface DoodlePayload {
  questionId: number;
  layer: DoodleLayer;
  baseWidth: number;
  baseHeight: number;
  layoutVersion: number;
  fontScale: number;
  strokes: DoodleStroke[];
}

export interface ImportQuestionBankResult {
  bankId: number;
  chapterCount: number;
  questionCount: number;
  mediaBaseUrl: string;
  warnings: string[];
}

export interface ImportTaskSummary {
  id: string;
  mode: "single" | "double";
  materialName: string;
  status: "queued" | "running" | "done" | "failed";
  createdAt: string;
  updatedAt: string;
  questionFileName: string;
  answerFileName?: string | null;
  splitPage?: number | null;
  providerLabel: string;
  importedBankId?: number | null;
  importedQuestionCount?: number | null;
  importedChapterCount?: number | null;
  mediaBaseUrl?: string | null;
  warnings: string[];
  lastError?: string | null;
  matchReport?: {
    summary?: {
      questions?: number;
      answers?: number;
      matchedQuestions?: number;
      extraAnswers?: number;
      statusCounts?: Record<string, number>;
    };
  } | null;
}
