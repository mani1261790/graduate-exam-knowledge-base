import type { Concept, Problem, ProblemDetail, Recommendation, SourceDocument, User } from "./types";
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
  concepts: (q = "") => request<{ concepts: Concept[] }>(`/api/concepts${q ? `?q=${encodeURIComponent(q)}` : ""}`),
  concept: (id: string) => request<{ concept: Concept & { description?: string; edges: unknown[]; problems: Problem[] } }>(`/api/concepts/${encodeURIComponent(id)}`),
  problems: (params: URLSearchParams) => request<{ problems: Problem[] }>(`/api/problems?${params.toString()}`),
  problem: (id: string) => request<{ problem: ProblemDetail }>(`/api/problems/${encodeURIComponent(id)}`),
  problemWorkspace: (id: string) =>
    request<{ workspace: { strokes: unknown[]; revision: number; updated_at: string } | null }>(
      `/api/problems/${encodeURIComponent(id)}/workspace`,
    ),
  saveProblemWorkspace: (id: string, strokes: unknown[]) =>
    request<{ revision: number; updated_at: string }>(`/api/problems/${encodeURIComponent(id)}/workspace`, {
      method: "PUT",
      body: JSON.stringify({ strokes }),
    }),
  askProblemChat: (id: string, messages: ProblemChatMessage[]) =>
    request<{ answer: string }>(`/api/problems/${encodeURIComponent(id)}/chat`, {
      method: "POST",
      body: JSON.stringify({ messages }),
    }),
  recommendations: (mode: string) => request<{ recommendations: Recommendation[] }>(`/api/recommendations?mode=${mode}`),
  progress: () => request<{ progress: Array<Concept & { evidence_count: number; review_due_at: string | null }> }>("/api/progress"),
  sources: () => request<{ sources: SourceDocument[] }>("/api/sources?limit=80"),
  sourceStats: () => request<{ total: number; byUniversity: Array<{ university: string; count: number }>; byScope: Array<{ access_scope: string; count: number }> }>("/api/source-stats"),
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
