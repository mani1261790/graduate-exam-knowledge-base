CREATE TABLE learning_plan_focus_experiments (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  goal_id TEXT NOT NULL REFERENCES user_goals(id) ON DELETE CASCADE,
  plan_id TEXT NOT NULL REFERENCES study_plans(id) ON DELETE CASCADE,
  model_version TEXT NOT NULL,
  proposal_key TEXT NOT NULL,
  exposure_date TEXT NOT NULL,
  focus_node_ids TEXT NOT NULL,
  focus_node_labels TEXT NOT NULL,
  baseline_distribution TEXT NOT NULL,
  proposed_distribution TEXT NOT NULL,
  baseline_focus_mastery REAL NOT NULL CHECK (baseline_focus_mastery BETWEEN 0.0 AND 1.0),
  baseline_plan_adherence REAL NOT NULL CHECK (baseline_plan_adherence BETWEEN 0.0 AND 1.0),
  baseline_due_sessions INTEGER NOT NULL CHECK (baseline_due_sessions >= 0),
  baseline_distinct_nodes INTEGER NOT NULL CHECK (baseline_distinct_nodes >= 1),
  proposed_distinct_nodes INTEGER NOT NULL CHECK (proposed_distinct_nodes >= 1),
  exposed_at TEXT NOT NULL,
  accepted_at TEXT,
  followup_focus_mastery REAL CHECK (followup_focus_mastery IS NULL OR (followup_focus_mastery BETWEEN 0.0 AND 1.0)),
  focus_mastery_uplift REAL CHECK (focus_mastery_uplift IS NULL OR (focus_mastery_uplift BETWEEN -1.0 AND 1.0)),
  followup_plan_adherence REAL CHECK (followup_plan_adherence IS NULL OR (followup_plan_adherence BETWEEN 0.0 AND 1.0)),
  adherence_uplift REAL CHECK (adherence_uplift IS NULL OR (adherence_uplift BETWEEN -1.0 AND 1.0)),
  followup_due_sessions INTEGER CHECK (followup_due_sessions IS NULL OR followup_due_sessions >= 0),
  coverage_rate REAL CHECK (coverage_rate IS NULL OR (coverage_rate BETWEEN 0.0 AND 1.0)),
  completed_at TEXT,
  cancelled_at TEXT,
  UNIQUE (user_id, goal_id, model_version, proposal_key, exposure_date)
);

CREATE INDEX idx_plan_focus_user
  ON learning_plan_focus_experiments(user_id, exposed_at DESC);

CREATE INDEX idx_plan_focus_completed
  ON learning_plan_focus_experiments(completed_at DESC)
  WHERE completed_at IS NOT NULL AND cancelled_at IS NULL;
