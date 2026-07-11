PRAGMA foreign_keys = ON;

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL CHECK (role IN ('member', 'editor', 'reviewer', 'admin')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'deleted')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE source_documents (
  id TEXT PRIMARY KEY,
  source_type TEXT NOT NULL CHECK (source_type IN ('official_pdf', 'unofficial_pdf', 'scan', 'web_page', 'manual_input', 'book', 'other')),
  title TEXT NOT NULL,
  university TEXT NOT NULL,
  graduate_school TEXT,
  department TEXT,
  exam_year INTEGER NOT NULL,
  exam_category TEXT,
  source_url TEXT,
  file_hash TEXT NOT NULL UNIQUE,
  storage_path TEXT NOT NULL,
  access_scope TEXT NOT NULL CHECK (access_scope IN ('internal_only', 'source_link_only', 'public_ready', 'restricted')),
  extraction_status TEXT NOT NULL DEFAULT 'uploaded' CHECK (extraction_status IN ('uploaded', 'text_extracted', 'problem_split', 'reviewed', 'deprecated')),
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE assets (
  id TEXT PRIMARY KEY,
  asset_type TEXT NOT NULL CHECK (asset_type IN ('pdf', 'page_image', 'figure', 'table_image', 'solution_image', 'other')),
  storage_path TEXT NOT NULL,
  file_hash TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  source_document_id TEXT REFERENCES source_documents(id),
  problem_id TEXT,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE problems (
  id TEXT PRIMARY KEY,
  source_document_id TEXT NOT NULL REFERENCES source_documents(id),
  problem_label TEXT NOT NULL,
  page_start INTEGER,
  page_end INTEGER,
  statement_text TEXT,
  statement_asset_ids TEXT NOT NULL DEFAULT '[]',
  answer_text TEXT,
  explanation_text TEXT,
  subject_raw TEXT,
  difficulty INTEGER NOT NULL CHECK (difficulty BETWEEN 1 AND 5),
  estimated_minutes INTEGER NOT NULL CHECK (estimated_minutes BETWEEN 1 AND 180),
  answer_format TEXT NOT NULL CHECK (answer_format IN ('multiple_choice', 'numeric', 'short_text', 'proof', 'derivation', 'programming', 'essay', 'mixed')),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'candidate', 'reviewed', 'deprecated', 'duplicate')),
  duplicate_of TEXT REFERENCES problems(id),
  embedding_status TEXT NOT NULL DEFAULT 'not_created' CHECK (embedding_status IN ('not_created', 'created', 'stale')),
  created_by TEXT NOT NULL REFERENCES users(id),
  reviewed_by TEXT REFERENCES users(id),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  CONSTRAINT no_duplicate_target_unless_duplicate CHECK ((status = 'duplicate' AND duplicate_of IS NOT NULL) OR (status <> 'duplicate' AND duplicate_of IS NULL))
);

CREATE TABLE problem_parts (
  id TEXT PRIMARY KEY,
  problem_id TEXT NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
  part_label TEXT NOT NULL,
  statement_text TEXT,
  answer_text TEXT,
  explanation_text TEXT,
  difficulty INTEGER CHECK (difficulty BETWEEN 1 AND 5),
  estimated_minutes INTEGER CHECK (estimated_minutes BETWEEN 1 AND 180)
);

CREATE TABLE concepts (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name_ja TEXT NOT NULL,
  name_en TEXT,
  aliases TEXT NOT NULL DEFAULT '[]',
  concept_type TEXT NOT NULL CHECK (concept_type IN ('field', 'topic', 'concept', 'formula', 'theorem', 'algorithm', 'solution_pattern', 'mistake_pattern', 'exam_skill')),
  description TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'merged', 'deprecated')),
  merged_into TEXT REFERENCES concepts(id),
  created_by TEXT NOT NULL REFERENCES users(id),
  reviewed_by TEXT REFERENCES users(id)
);

CREATE TABLE node_registry (
  node_id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('problem', 'problem_part', 'concept', 'source_document', 'university', 'graduate_school', 'book', 'paper', 'video', 'user')),
  entity_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (entity_type, entity_id)
);

CREATE TABLE knowledge_edges (
  id TEXT PRIMARY KEY,
  from_node_id TEXT NOT NULL REFERENCES node_registry(node_id),
  edge_type TEXT NOT NULL CHECK (edge_type IN ('tests', 'requires', 'uses_formula', 'solved_by', 'commonly_missed_by', 'similar_to', 'same_template_as', 'variant_of', 'easier_version_of', 'prerequisite_problem_of', 'prerequisite_of', 'broader_than', 'related_to', 'contrast_with', 'part_of')),
  to_node_id TEXT NOT NULL REFERENCES node_registry(node_id),
  weight REAL NOT NULL CHECK (weight >= 0.0 AND weight <= 1.0),
  confidence REAL NOT NULL CHECK (confidence >= 0.0 AND confidence <= 1.0),
  evidence_type TEXT NOT NULL CHECK (evidence_type IN ('manual', 'llm_suggested', 'embedding_similarity', 'imported', 'derived')),
  status TEXT NOT NULL DEFAULT 'candidate' CHECK (status IN ('candidate', 'approved', 'rejected', 'deprecated')),
  created_by TEXT NOT NULL REFERENCES users(id),
  reviewed_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (from_node_id, edge_type, to_node_id)
);

CREATE TABLE user_goals (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_university TEXT,
  target_graduate_school TEXT,
  target_department TEXT,
  exam_month TEXT,
  target_subjects TEXT NOT NULL DEFAULT '[]',
  priority_concept_ids TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE attempts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  problem_id TEXT NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
  started_at TEXT NOT NULL,
  submitted_at TEXT,
  time_spent_minutes INTEGER,
  score_rate REAL CHECK (score_rate >= 0.0 AND score_rate <= 1.0),
  result TEXT NOT NULL CHECK (result IN ('not_checked', 'correct', 'partial', 'wrong', 'skipped')),
  used_hint INTEGER NOT NULL DEFAULT 0 CHECK (used_hint IN (0, 1)),
  looked_solution INTEGER NOT NULL DEFAULT 0 CHECK (looked_solution IN (0, 1)),
  self_confidence INTEGER CHECK (self_confidence BETWEEN 1 AND 5),
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE mistakes (
  id TEXT PRIMARY KEY,
  attempt_id TEXT NOT NULL REFERENCES attempts(id) ON DELETE CASCADE,
  concept_id TEXT REFERENCES concepts(id),
  mistake_type TEXT NOT NULL CHECK (mistake_type IN ('concept_missing', 'formula_missing', 'calculation_error', 'proof_gap', 'misread_problem', 'time_over', 'implementation_error', 'unknown')),
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE user_concept_states (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  concept_id TEXT NOT NULL REFERENCES concepts(id) ON DELETE CASCADE,
  mastery_score REAL NOT NULL CHECK (mastery_score >= 0.0 AND mastery_score <= 1.0),
  evidence_count INTEGER NOT NULL DEFAULT 0,
  last_attempted_at TEXT,
  last_failed_at TEXT,
  review_due_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, concept_id)
);

CREATE TABLE recommendation_candidates (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  problem_id TEXT NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
  mode TEXT NOT NULL CHECK (mode IN ('normal', 'review', 'foundation', 'challenge')),
  score REAL NOT NULL,
  reasons TEXT NOT NULL DEFAULT '[]',
  computed_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, problem_id, mode)
);

CREATE TABLE audit_logs (
  id TEXT PRIMARY KEY,
  actor_user_id TEXT NOT NULL REFERENCES users(id),
  action_type TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  before_json TEXT,
  after_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE VIRTUAL TABLE problem_search_fts USING fts5(
  problem_id UNINDEXED,
  statement_text,
  explanation_text,
  content=''
);

CREATE INDEX idx_source_documents_university_year ON source_documents(university, exam_year);
CREATE INDEX idx_problems_source_status ON problems(source_document_id, status);
CREATE INDEX idx_problems_status_difficulty ON problems(status, difficulty);
CREATE INDEX idx_concepts_slug ON concepts(slug);
CREATE INDEX idx_edges_from_type_status ON knowledge_edges(from_node_id, edge_type, status);
CREATE INDEX idx_edges_to_type_status ON knowledge_edges(to_node_id, edge_type, status);
CREATE INDEX idx_attempts_user_problem ON attempts(user_id, problem_id);
CREATE INDEX idx_user_concept_states_due ON user_concept_states(user_id, review_due_at);
CREATE INDEX idx_recommendation_candidates_user_mode_score ON recommendation_candidates(user_id, mode, score DESC);
