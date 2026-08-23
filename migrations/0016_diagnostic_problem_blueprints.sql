PRAGMA foreign_keys = ON;

CREATE TABLE diagnostic_problem_blueprints (
  id TEXT PRIMARY KEY,
  graph_node_id TEXT NOT NULL REFERENCES learning_graph_nodes(id) ON DELETE CASCADE,
  slot INTEGER NOT NULL CHECK (slot BETWEEN 1 AND 3),
  title TEXT NOT NULL,
  assessment_objective TEXT NOT NULL,
  evidence_expectation TEXT NOT NULL,
  cognitive_demand TEXT NOT NULL CHECK (cognitive_demand IN ('concept_application', 'multi_step_reasoning', 'transfer')),
  answer_format TEXT NOT NULL CHECK (answer_format IN ('multiple_choice', 'numeric', 'short_text', 'proof', 'derivation', 'programming', 'essay', 'mixed')),
  difficulty INTEGER NOT NULL CHECK (difficulty BETWEEN 1 AND 5),
  estimated_minutes INTEGER NOT NULL CHECK (estimated_minutes BETWEEN 5 AND 120),
  rubric_json TEXT NOT NULL,
  misconception_targets_json TEXT NOT NULL,
  originality_policy TEXT NOT NULL DEFAULT 'original_only' CHECK (originality_policy = 'original_only'),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'candidate', 'approved', 'rejected', 'retired')),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  review_note TEXT,
  created_by TEXT NOT NULL REFERENCES users(id),
  submitted_by TEXT REFERENCES users(id),
  reviewed_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  submitted_at TEXT,
  reviewed_at TEXT,
  UNIQUE (graph_node_id, slot)
);

CREATE INDEX idx_diagnostic_blueprints_node_status
  ON diagnostic_problem_blueprints(graph_node_id, status, slot);
CREATE INDEX idx_diagnostic_blueprints_review_status
  ON diagnostic_problem_blueprints(status, submitted_at);
