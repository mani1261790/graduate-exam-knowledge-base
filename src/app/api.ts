import type { Concept, LearningGraphSubject, Problem, ProblemDetail, Recommendation, SourceDocument, SourceStats, StudyGoal, StudyPlanResponse, User } from "./types";
import type { ProblemChatMessage } from "./types";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    cache: init?.cache ?? "no-store",
    headers: {
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `${response.status} ${response.statusText}`);
  }
  return (await response.json()) as T;
}

export const api = {
  login: (email: string, password: string) => request<{ user: User }>("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }),
  logout: () => request<{ ok: boolean }>("/api/auth/logout", { method: "POST", body: "{}" }),
  session: () => request<{ user: User }>("/api/session"),
  updateProfile: (body: { department: string }) => request<{ user: User }>("/api/profile", { method: "PATCH", body: JSON.stringify(body) }),
  concepts: (q = "") => request<{ concepts: Concept[] }>(`/api/concepts${q ? `?q=${encodeURIComponent(q)}` : ""}`),
  concept: (id: string) => request<{ concept: Concept & { description?: string; edges: unknown[]; problems: Problem[] } }>(`/api/concepts/${encodeURIComponent(id)}`),
  problems: (params: URLSearchParams) => request<{ problems: Problem[] }>(`/api/problems?${params.toString()}`),
  problem: (id: string) => request<{ problem: ProblemDetail }>(`/api/problems/${encodeURIComponent(id)}`),
  askProblemChat: (id: string, messages: ProblemChatMessage[]) =>
    request<{ answer: string }>(`/api/problems/${encodeURIComponent(id)}/chat`, {
      method: "POST",
      body: JSON.stringify({ messages }),
    }),
  recommendations: (mode: string) => request<{ recommendations: Recommendation[] }>(`/api/recommendations?mode=${mode}`),
  studyGoal: () => request<{ goal: StudyGoal | null }>("/api/study-goal"),
  learningGraphSubjects: () => request<{ subjects: LearningGraphSubject[] }>("/api/learning-graphs/subjects"),
  saveStudyGoal: (body: Record<string, unknown>) => request<{ goal: StudyGoal }>("/api/study-goal", { method: "PUT", body: JSON.stringify(body) }),
  currentStudyPlan: () => request<{ study_plan: StudyPlanResponse | null }>("/api/study-plans/current"),
  generateStudyPlan: () => request<{ study_plan: StudyPlanResponse }>("/api/study-plans", { method: "POST", body: "{}" }),
  completeStudyPlanItem: (id: string, status: "completed" | "skipped") =>
    request<{ id: string; status: string }>(`/api/study-plan-items/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify({ status }),
    }),
  progress: () => request<{ progress: Array<Concept & { evidence_count: number; review_due_at: string | null }> }>("/api/progress"),
  sources: (params = new URLSearchParams()) => request<{ sources: SourceDocument[]; total: number; limit: number; offset: number }>(`/api/sources?${params.toString()}`),
  sourceStats: () => request<SourceStats>("/api/source-stats"),
  createAttempt: (body: Record<string, unknown>) =>
    request<{ id: string; score_rate: number }>("/api/attempts", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  updateProblem: (id: string, body: Record<string, unknown>) =>
    request<{ id: string; changed: boolean }>(`/api/problems/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  createSource: (body: Record<string, unknown>) =>
    request<{ id: string }>("/api/sources", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  updateSource: (id: string, body: Record<string, unknown>) =>
    request<{ id: string }>(`/api/sources/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  createProblem: (body: Record<string, unknown>) =>
    request<{ id: string }>("/api/problems", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  createConcept: (body: Record<string, unknown>) =>
    request<{ id: string }>("/api/concepts", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  createEdge: (body: Record<string, unknown>) =>
    request<{ id: string }>("/api/edges", {
      method: "POST",
      body: JSON.stringify(body),
    }),
};
