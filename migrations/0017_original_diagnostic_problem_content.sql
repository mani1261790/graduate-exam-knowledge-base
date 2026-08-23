PRAGMA foreign_keys = ON;

CREATE TABLE diagnostic_problem_contents (
  id TEXT PRIMARY KEY,
  blueprint_id TEXT NOT NULL UNIQUE REFERENCES diagnostic_problem_blueprints(id) ON DELETE RESTRICT,
  problem_id TEXT NOT NULL UNIQUE,
  problem_node_id TEXT NOT NULL UNIQUE,
  graph_problem_link_id TEXT NOT NULL UNIQUE,
  problem_label TEXT NOT NULL,
  statement_text TEXT NOT NULL DEFAULT '',
  answer_text TEXT NOT NULL DEFAULT '',
  explanation_text TEXT NOT NULL DEFAULT '',
  scoring_examples_json TEXT NOT NULL DEFAULT '[]',
  adversarial_checks_json TEXT NOT NULL DEFAULT '[]',
  originality_note TEXT NOT NULL DEFAULT '',
  content_fingerprint TEXT UNIQUE,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'candidate', 'approved', 'rejected', 'retired')),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  review_note TEXT,
  created_by TEXT NOT NULL REFERENCES users(id),
  submitted_by TEXT REFERENCES users(id),
  reviewed_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  submitted_at TEXT,
  reviewed_at TEXT,
  materialized_at TEXT
);

CREATE INDEX idx_diagnostic_problem_contents_status
  ON diagnostic_problem_contents(status, submitted_at);
CREATE INDEX idx_diagnostic_problem_contents_blueprint_status
  ON diagnostic_problem_contents(blueprint_id, status);
