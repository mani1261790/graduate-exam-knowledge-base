import type { Concept, DiagnosticBlueprintInput, DiagnosticBlueprintQueue, DiagnosticProblemAuthoringQueue, DiagnosticProblemCalibration, DiagnosticProblemContentInput, DiagnosticRemediationQueue, DiagnosticVerificationResult, LearningGraphSubject, ModelHealth, PersonalAnalytics, Problem, ProblemDetail, Recommendation, SourceDocument, SourceStats, StudyGoal, StudyPlanResponse, User } from "./types";
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
  personalAnalytics: () => request<{ analytics: PersonalAnalytics }>("/api/analytics/personal"),
  acceptPersonalStrategy: (id: string) =>
    request<{ id: string; accepted: true }>(`/api/analytics/strategy/${encodeURIComponent(id)}/accept`, {
      method: "POST",
      body: "{}",
    }),
  acceptScheduleAdaptation: (id: string) =>
    request<{ accepted: true; goal: StudyGoal; study_plan: StudyPlanResponse }>(`/api/analytics/schedule-adaptation/${encodeURIComponent(id)}/accept`, {
      method: "POST",
      body: "{}",
    }),
  acceptPlanFocus: (id: string) =>
    request<{ accepted: true; study_plan: StudyPlanResponse }>(`/api/analytics/plan-focus/${encodeURIComponent(id)}/accept`, {
      method: "POST",
      body: "{}",
    }),
  acceptInformationGain: (id: string) =>
    request<{ accepted: true; study_plan: StudyPlanResponse }>(`/api/analytics/information-gain/${encodeURIComponent(id)}/accept`, {
      method: "POST",
      body: "{}",
    }),
  modelHealth: () => request<{ model_health: ModelHealth }>("/api/admin/model-health"),
  proposeDiagnosticProblemCalibration: (contentId: string, body: { decision: "mastery_enabled" | "monitor_only"; rationale: string; expected_snapshot_key: string }) =>
    request<{ calibration: DiagnosticProblemCalibration }>(`/api/admin/model-health/original-problems/${encodeURIComponent(contentId)}/calibrations`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  reviewDiagnosticProblemCalibration: (contentId: string, decisionId: string, body: { status: "approved" | "rejected"; expected_snapshot_key: string; review_note: string }) =>
    request<{ calibration: DiagnosticProblemCalibration }>(`/api/admin/model-health/original-problems/${encodeURIComponent(contentId)}/calibrations/${encodeURIComponent(decisionId)}/review`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  diagnosticRemediation: () => request<{ remediation: DiagnosticRemediationQueue }>("/api/admin/diagnostic-content/remediation"),
  proposeDiagnosticLink: (graphNodeId: string, problemId: string) =>
    request<{ link: { id: string; status: string }; created: boolean }>("/api/admin/diagnostic-content/links", {
      method: "POST",
      body: JSON.stringify({ graph_node_id: graphNodeId, problem_id: problemId }),
    }),
  reviewDiagnosticLink: (id: string, status: "approved" | "rejected") =>
    request<{ link: { id: string; status: string } }>(`/api/admin/diagnostic-content/links/${encodeURIComponent(id)}/review`, {
      method: "PATCH",
      body: JSON.stringify({ status, expected_status: "candidate" }),
    }),
  resubmitDiagnosticLink: (id: string) =>
    request<{ link: { id: string; status: string } }>(`/api/admin/diagnostic-content/links/${encodeURIComponent(id)}/resubmit`, {
      method: "PATCH",
      body: JSON.stringify({ expected_status: "rejected" }),
    }),
  diagnosticBlueprints: () => request<{ blueprint_queue: DiagnosticBlueprintQueue }>("/api/admin/diagnostic-content/blueprints"),
  createDiagnosticBlueprint: (graphNodeId: string, slot: number) =>
    request<{ blueprint: { id: string; revision: number }; created: boolean }>("/api/admin/diagnostic-content/blueprints", {
      method: "POST",
      body: JSON.stringify({ graph_node_id: graphNodeId, slot }),
    }),
  updateDiagnosticBlueprint: (id: string, expectedRevision: number, blueprint: DiagnosticBlueprintInput) =>
    request<{ blueprint: { id: string; revision: number } }>(`/api/admin/diagnostic-content/blueprints/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify({ expected_revision: expectedRevision, blueprint }),
    }),
  submitDiagnosticBlueprint: (id: string, expectedRevision: number) =>
    request<{ blueprint: { id: string; revision: number; status: string } }>(`/api/admin/diagnostic-content/blueprints/${encodeURIComponent(id)}/submit`, {
      method: "PATCH",
      body: JSON.stringify({ expected_revision: expectedRevision, measurable_attested: true, originality_attested: true }),
    }),
  reviewDiagnosticBlueprint: (
    id: string,
    expectedRevision: number,
    status: "approved" | "rejected",
    reviewNote: string,
    checks: { objective_matches_node: boolean; rubric_scores_evidence: boolean; originality_confirmed: boolean },
  ) => request<{ blueprint: { id: string; revision: number; status: string } }>(`/api/admin/diagnostic-content/blueprints/${encodeURIComponent(id)}/review`, {
    method: "PATCH",
    body: JSON.stringify({ expected_revision: expectedRevision, status, review_note: reviewNote, checks }),
  }),
  diagnosticOriginalProblems: () => request<{ authoring_queue: DiagnosticProblemAuthoringQueue }>("/api/admin/diagnostic-content/original-problems"),
  createDiagnosticOriginalProblem: (blueprintId: string) =>
    request<{ content: { id: string; revision: number }; created: boolean }>("/api/admin/diagnostic-content/original-problems", {
      method: "POST",
      body: JSON.stringify({ blueprint_id: blueprintId }),
    }),
  updateDiagnosticOriginalProblem: (id: string, expectedRevision: number, content: DiagnosticProblemContentInput) =>
    request<{ content: { id: string; revision: number } }>(`/api/admin/diagnostic-content/original-problems/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify({ expected_revision: expectedRevision, content }),
    }),
  submitDiagnosticOriginalProblem: (id: string, expectedRevision: number) =>
    request<{ content: { id: string; revision: number; status: string } }>(`/api/admin/diagnostic-content/original-problems/${encodeURIComponent(id)}/submit`, {
      method: "PATCH",
      body: JSON.stringify({ expected_revision: expectedRevision, answer_verified: true, rubric_calibrated: true, originality_attested: true }),
    }),
  verifyDiagnosticOriginalProblem: (id: string, expectedRevision: number, results: DiagnosticVerificationResult[], note: string) =>
    request<{ content: { id: string; revision: number; status: string }; verification: { id: string; outcome: "passed" | "failed" } }>(`/api/admin/diagnostic-content/original-problems/${encodeURIComponent(id)}/verify`, {
      method: "PATCH",
      body: JSON.stringify({ expected_revision: expectedRevision, results, note }),
    }),
  reviewDiagnosticOriginalProblem: (
    id: string,
    expectedRevision: number,
    status: "approved" | "rejected",
    reviewNote: string,
    checks: { statement_matches_blueprint: boolean; scoring_calibrated: boolean; originality_confirmed: boolean },
  ) => request<{ content: { id: string; revision: number; status: string } }>(`/api/admin/diagnostic-content/original-problems/${encodeURIComponent(id)}/review`, {
    method: "PATCH",
    body: JSON.stringify({ expected_revision: expectedRevision, status, review_note: reviewNote, checks }),
  }),
  sources: (params = new URLSearchParams()) => request<{ sources: SourceDocument[]; total: number; limit: number; offset: number }>(`/api/sources?${params.toString()}`),
  sourceStats: () => request<SourceStats>("/api/source-stats"),
  createAttempt: (body: Record<string, unknown>) =>
    request<{ id: string; score_rate: number; mastery_evidence_applied: boolean }>("/api/attempts", {
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
