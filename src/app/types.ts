export interface User {
  id: string;
  display_name: string;
  email: string;
  department: string | null;
  role: "member" | "editor" | "reviewer" | "admin";
}

export interface Concept {
  id: string;
  slug: string;
  name_ja: string;
  concept_type: string;
  mastery_score?: number | null;
  problem_count?: number;
}

export interface Problem {
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
  status: string;
  answer_text: string | null;
  explanation_text: string | null;
  completed: boolean;
  page_start?: number | null;
  page_end?: number | null;
  source_url?: string | null;
  publisher_page_url?: string | null;
  pdf_display_mode?: "embed" | "external_only";
  source_status?: "active" | "unavailable" | "needs_review";
  concepts: Concept[];
}

export interface ProblemDetail extends Problem {
  source_title: string;
  source_url?: string | null;
  access_scope: string;
  similar: Array<{
    id: string;
    problem_label: string;
    statement_text: string | null;
    university: string;
    exam_year: number;
    difficulty: number;
    score: number;
  }>;
  attempts: Array<{
    id: string;
    score_rate: number;
    result: string;
    time_spent_minutes: number | null;
    note: string | null;
    used_hint: number;
    looked_solution: number;
    self_confidence: number | null;
    created_at: string;
  }>;
}

export interface Recommendation extends Problem {
  score: number;
  reasons: string[];
}

export interface SourceDocument {
  id: string;
  source_type: string;
  title: string;
  university: string;
  graduate_school: string | null;
  department: string | null;
  exam_year: number;
  exam_category: string | null;
  source_url: string | null;
  publisher_page_url: string | null;
  file_hash: string;
  storage_path: string;
  access_scope: string;
  pdf_display_mode: "embed" | "external_only";
  source_status: "active" | "unavailable" | "needs_review";
  source_checked_at: string | null;
  extraction_status: string;
  created_at: string;
  problem_count: number;
}

export interface LearningGraphSubject {
  subject_key: string;
  topic: string;
  source_repository: string;
  source_commit: string;
  activated_at: string | null;
}

export interface SourceStats {
  total: number;
  byUniversity: Array<{ university: string; count: number }>;
  byScope: Array<{ access_scope: string; count: number }>;
  byStatus: Array<{ source_status: SourceDocument["source_status"]; count: number }>;
  byDisplay: Array<{ pdf_display_mode: SourceDocument["pdf_display_mode"]; count: number }>;
}

export interface StudyGoal {
  id: string;
  goal_text: string;
  subject_key: string;
  target_university: string | null;
  target_graduate_school: string | null;
  target_department: string | null;
  target_date: string | null;
  sessions_per_week: number;
  minutes_per_session: number;
  updated_at: string;
}

export interface StudyPlanNode {
  id: string;
  label: string;
  node_type: "FOUNDATIONAL" | "BASIC" | "CORE" | "APPLICATION";
  layer: number;
  description: string;
  mastery: number;
  readiness: number;
  status: "completed" | "ready" | "blocked";
  prerequisites: Array<{ id: string; label: string; weight: number; mastery: number }>;
}

export interface StudyPlanItem {
  id: string;
  graph_node_id: string;
  node_label: string;
  problem_id: string | null;
  scheduled_date: string;
  estimated_minutes: number;
  mode: "normal" | "review" | "foundation" | "challenge" | "concept";
  status: "pending" | "completed" | "skipped";
  reason: string;
  problem?: Problem;
  concepts?: Array<Pick<Concept, "id" | "slug" | "name_ja" | "concept_type" | "problem_count">>;
}

export interface StudyPlanResponse {
  plan: {
    id: string;
    topic: string;
    subject_key: string;
    goal_text: string;
    target_date: string | null;
    sessions_per_week: number;
    minutes_per_session: number;
    source_repository: string;
    source_commit: string;
  };
  nodes: StudyPlanNode[];
  items: StudyPlanItem[];
  today: StudyPlanItem[];
}

export interface ProblemChatMessage {
  role: "user" | "assistant";
  content: string;
}
