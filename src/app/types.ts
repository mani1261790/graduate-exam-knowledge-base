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
  file_hash: string;
  storage_path: string;
  access_scope: string;
  extraction_status: string;
  created_at: string;
}

export interface ProblemChatMessage {
  role: "user" | "assistant";
  content: string;
}
