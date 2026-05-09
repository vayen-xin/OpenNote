import type {
  AttemptRequest,
  AttemptResponse,
  ChapterSummary,
  DoodleLayer,
  DoodlePayload,
  ImportTaskSummary,
  ImportQuestionBankResult,
  ProgressSummary,
  QuestionBank,
  QuestionDetail,
  QuestionListItem,
  QuestionOption,
  QuestionStatus,
} from "./types";

const rawApiBase = (import.meta.env.VITE_API_BASE as string | undefined)?.trim();
const API_BASE = rawApiBase && rawApiBase.length > 0 ? rawApiBase.replace(/\/+$/, "") : "/api";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
    ...init,
  });
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }
  if (response.status === 204) {
    return undefined as T;
  }
  return response.json() as Promise<T>;
}

export async function importQuestionBank(file: File): Promise<ImportQuestionBankResult> {
  const form = new FormData();
  form.append("file", file);
  const response = await fetch(`${API_BASE}/imports/question-bank`, {
    method: "POST",
    body: form,
  });
  if (!response.ok) {
    throw new Error(`Import failed: ${response.status}`);
  }
  return response.json() as Promise<ImportQuestionBankResult>;
}

export async function createImportTask(input: {
  mode: "single" | "double";
  materialName: string;
  splitPage?: number;
  questionFile: File;
  answerFile?: File;
  providerModelName?: string;
  providerBaseUrl?: string;
  providerApiKey?: string;
}): Promise<ImportTaskSummary> {
  const form = new FormData();
  form.append("mode", input.mode);
  form.append("materialName", input.materialName);
  form.append("questionFile", input.questionFile);
  if (typeof input.splitPage === "number") {
    form.append("splitPage", String(input.splitPage));
  }
  if (input.answerFile) {
    form.append("answerFile", input.answerFile);
  }
  if (input.providerModelName?.trim()) {
    form.append("providerModelName", input.providerModelName.trim());
  }
  if (input.providerBaseUrl?.trim()) {
    form.append("providerBaseUrl", input.providerBaseUrl.trim());
  }
  if (input.providerApiKey?.trim()) {
    form.append("providerApiKey", input.providerApiKey.trim());
  }
  const response = await fetch(`${API_BASE}/import-tasks`, {
    method: "POST",
    body: form,
  });
  if (!response.ok) {
    throw new Error(`Create import task failed: ${response.status}`);
  }
  return response.json() as Promise<ImportTaskSummary>;
}

export async function getImportTasks(): Promise<ImportTaskSummary[]> {
  return request<ImportTaskSummary[]>("/import-tasks");
}

export async function getBanks(): Promise<QuestionBank[]> {
  return request<QuestionBank[]>("/banks");
}

export async function getChapters(bankId: number): Promise<ChapterSummary[]> {
  const data = await request<any[]>(`/banks/${bankId}/chapters`);
  return data.map((item) => ({
    id: Number(item.id),
    bankId: Number(item.bankId),
    title: item.title,
    sortNo: Number(item.sortNo),
    totalQuestions: Number(item.totalQuestions),
    completedQuestions: Number(item.completedQuestions),
    accuracy: Math.round(Number(item.accuracy)),
  }));
}

function mapQuestion(raw: any): QuestionDetail {
  const options: QuestionOption[] = Array.isArray(raw.options)
    ? raw.options.map((text: string, idx: number) => ({ key: String.fromCharCode(65 + idx), text }))
    : [];
  return {
    id: Number(raw.id),
    bankId: Number(raw.bankId),
    chapterId: Number(raw.chapterId),
    chapterTitle: raw.chapterTitle ?? "",
    sortNo: Number(raw.sortNo ?? 0),
    type: raw.type === "single_choice" ? "single_choice" : "fill",
    stem: raw.stem ?? "",
    options,
    explanation: raw.explanation ?? "",
    status: (raw.status as QuestionStatus) ?? "unanswered",
    selectedAnswerIndex:
      typeof raw.selectedAnswerIndex === "number" ? Number(raw.selectedAnswerIndex) : undefined,
  };
}

function mapQuestionListItem(raw: any): QuestionListItem {
  return {
    id: Number(raw.id),
    bankId: Number(raw.bankId),
    chapterId: Number(raw.chapterId),
    chapterTitle: raw.chapterTitle ?? "",
    sortNo: Number(raw.sortNo ?? 0),
    type: raw.type === "single_choice" ? "single_choice" : "fill",
    status: (raw.status as QuestionStatus) ?? "unanswered",
    selectedAnswerIndex:
      typeof raw.selectedAnswerIndex === "number" ? Number(raw.selectedAnswerIndex) : undefined,
  };
}

export async function getQuestionsByBank(bankId: number): Promise<QuestionDetail[]> {
  const rows = await request<any[]>(`/banks/${bankId}/questions`);
  return rows.map(mapQuestion);
}

export async function getQuestionIndexByBank(bankId: number): Promise<QuestionListItem[]> {
  const rows = await request<any[]>(`/banks/${bankId}/question-index`);
  return rows.map(mapQuestionListItem);
}

export async function getQuestionDetail(questionId: number): Promise<QuestionDetail> {
  const raw = await request<any>(`/questions/${questionId}/detail`);
  return mapQuestion(raw);
}

export async function submitAttempt(questionId: number, payload: AttemptRequest): Promise<AttemptResponse> {
  const raw = await request<any>(`/questions/${questionId}/attempt`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return {
    questionId: Number(raw.questionId),
    status: (raw.status as QuestionStatus) ?? "pending_review",
    selectedAnswerIndex: typeof raw.answer === "number" ? Number(raw.answer) : undefined,
  };
}

export async function getProgress(bankId: number): Promise<ProgressSummary> {
  const raw = await request<any>(`/progress?bankId=${bankId}`);
  return {
    bankId: Number(raw.bankId),
    total: Number(raw.total ?? 0),
    completed: Number(raw.done ?? 0),
    correct: Number(raw.correct ?? 0),
    wrong: Number(raw.wrong ?? 0),
    accuracy: Math.round(Number(raw.accuracy ?? 0)),
  };
}

export async function getDoodle(questionId: number, layer: DoodleLayer): Promise<DoodlePayload | null> {
  return request<DoodlePayload | null>(`/doodles/${questionId}?layer=${layer}`);
}

export async function saveDoodle(questionId: number, layer: DoodleLayer, payload: DoodlePayload): Promise<void> {
  await request<void>(`/doodles/${questionId}?layer=${layer}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}
