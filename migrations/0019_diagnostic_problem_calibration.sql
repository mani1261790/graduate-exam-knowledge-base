PRAGMA foreign_keys = ON;

CREATE TABLE diagnostic_problem_calibration_decisions (
  id TEXT PRIMARY KEY,
  content_id TEXT NOT NULL REFERENCES diagnostic_problem_contents(id) ON DELETE CASCADE,
  content_revision INTEGER NOT NULL CHECK (content_revision >= 1),
  validity_model_version TEXT NOT NULL,
  snapshot_key TEXT NOT NULL,
  users INTEGER NOT NULL CHECK (users >= 0),
  paired_users INTEGER NOT NULL CHECK (paired_users >= 0),
  mean_score REAL,
  score_stddev REAL,
  anchor_correlation REAL,
  target_score REAL NOT NULL,
  observed_status TEXT NOT NULL CHECK (observed_status IN ('healthy', 'watch', 'halt_candidate')),
  decision TEXT NOT NULL CHECK (decision IN ('mastery_enabled', 'monitor_only')),
  rationale TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'candidate'
    CHECK (status IN ('candidate', 'approved', 'rejected', 'superseded')),
  proposed_by TEXT NOT NULL REFERENCES users(id),
  reviewed_by TEXT REFERENCES users(id),
  review_note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  reviewed_at TEXT,
  valid_until TEXT
);

CREATE UNIQUE INDEX idx_diagnostic_calibration_candidate
  ON diagnostic_problem_calibration_decisions(content_id)
  WHERE status = 'candidate';

CREATE UNIQUE INDEX idx_diagnostic_calibration_approved
  ON diagnostic_problem_calibration_decisions(content_id)
  WHERE status = 'approved';

CREATE INDEX idx_diagnostic_calibration_status_expiry
  ON diagnostic_problem_calibration_decisions(status, decision, valid_until);
