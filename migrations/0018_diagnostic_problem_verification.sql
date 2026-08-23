PRAGMA foreign_keys = ON;

ALTER TABLE diagnostic_problem_contents ADD COLUMN verification_cases_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE diagnostic_problem_contents ADD COLUMN verification_status TEXT NOT NULL DEFAULT 'unverified'
  CHECK (verification_status IN ('unverified', 'passed', 'failed'));
ALTER TABLE diagnostic_problem_contents ADD COLUMN verification_revision INTEGER;
ALTER TABLE diagnostic_problem_contents ADD COLUMN verified_by TEXT REFERENCES users(id);
ALTER TABLE diagnostic_problem_contents ADD COLUMN verified_at TEXT;

CREATE TABLE diagnostic_problem_verification_runs (
  id TEXT PRIMARY KEY,
  content_id TEXT NOT NULL REFERENCES diagnostic_problem_contents(id) ON DELETE CASCADE,
  content_revision INTEGER NOT NULL CHECK (content_revision >= 1),
  verifier_id TEXT NOT NULL REFERENCES users(id),
  outcome TEXT NOT NULL CHECK (outcome IN ('passed', 'failed')),
  contract_json TEXT NOT NULL,
  results_json TEXT NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_diagnostic_problem_verification_runs_content
  ON diagnostic_problem_verification_runs(content_id, created_at DESC);
CREATE INDEX idx_diagnostic_problem_verification_runs_outcome
  ON diagnostic_problem_verification_runs(outcome, created_at DESC);
