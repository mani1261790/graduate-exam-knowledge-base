export type Role = "member" | "editor" | "reviewer" | "admin";
export type ProblemStatus = "draft" | "candidate" | "reviewed" | "deprecated" | "duplicate";
export type EdgeStatus = "candidate" | "approved" | "rejected" | "deprecated";
export type RecommendationMode = "normal" | "review" | "foundation" | "challenge";

export interface AppUser {
  id: string;
  display_name: string;
  email: string;
  department: string | null;
  role: Role;
  status: "active" | "suspended" | "deleted";
}

export interface ProblemListItem {
  id: string;
  problem_label: string;
  statement_text: string | null;
  university: string;
  graduate_school: string | null;
  department: string | null;
  exam_year: number;
  subject_raw: string | null;
  difficulty: number;
  estimated_minutes: number;
  answer_format: string;
  status: ProblemStatus;
  answer_text: string | null;
  explanation_text: string | null;
  completed: boolean;
  page_start?: number | null;
  page_end?: number | null;
  source_url?: string | null;
  concepts: ConceptSummary[];
}

export interface ProblemDetail extends ProblemListItem {
  source_title: string;
  access_scope: string;
  statement_asset_ids: string[];
  similar: SimilarProblem[];
  attempts: Record<string, unknown>[];
}

export interface ConceptSummary {
  id: string;
  slug: string;
  name_ja: string;
  concept_type: string;
  mastery_score?: number | null;
  problem_count?: number;
}

export interface SimilarProblem {
  id: string;
  problem_label: string;
  university: string;
  exam_year: number;
  difficulty: number;
  score: number;
  statement_text: string | null;
}

export interface AttemptInput {
  problem_id: string;
  started_at?: string;
  time_spent_minutes?: number;
  score_rate?: number;
  result: "not_checked" | "correct" | "partial" | "wrong" | "skipped";
  used_hint?: boolean;
  looked_solution?: boolean;
  self_confidence?: number;
  note?: string;
  mistakes?: Array<{
    concept_id?: string;
    mistake_type: "concept_missing" | "formula_missing" | "calculation_error" | "proof_gap" | "misread_problem" | "time_over" | "implementation_error" | "unknown";
    note?: string;
  }>;
}

export interface RecommendationQueueMessage {
  userId: string;
  reason: "attempt_saved" | "manual";
}
