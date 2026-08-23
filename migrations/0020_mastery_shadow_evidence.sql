PRAGMA foreign_keys = ON;

CREATE TABLE learning_mastery_shadow_evidence (
  id TEXT PRIMARY KEY,
  attempt_id TEXT NOT NULL REFERENCES attempts(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  concept_id TEXT NOT NULL REFERENCES concepts(id) ON DELETE CASCADE,
  problem_id TEXT NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
  difficulty INTEGER NOT NULL CHECK (difficulty BETWEEN 1 AND 5),
  target_score REAL NOT NULL CHECK (target_score > 0 AND target_score < 1),
  raw_evidence REAL NOT NULL CHECK (raw_evidence BETWEEN 0 AND 1),
  relevance_weight REAL NOT NULL CHECK (relevance_weight BETWEEN 0 AND 1),
  previous_mastery REAL,
  evidence_count_before INTEGER NOT NULL CHECK (evidence_count_before >= 0),
  current_prediction REAL NOT NULL CHECK (current_prediction BETWEEN 0 AND 1),
  candidate_prediction REAL NOT NULL CHECK (candidate_prediction BETWEEN 0 AND 1),
  current_model_version TEXT NOT NULL,
  candidate_model_version TEXT NOT NULL,
  observed_attempt_id TEXT REFERENCES attempts(id) ON DELETE SET NULL,
  observed_score REAL CHECK (observed_score BETWEEN 0 AND 1),
  observed_at TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (attempt_id, concept_id)
);

CREATE INDEX idx_mastery_shadow_pending
  ON learning_mastery_shadow_evidence(user_id, concept_id, observed_attempt_id, created_at);

CREATE INDEX idx_mastery_shadow_evaluation
  ON learning_mastery_shadow_evidence(candidate_model_version, observed_at);
