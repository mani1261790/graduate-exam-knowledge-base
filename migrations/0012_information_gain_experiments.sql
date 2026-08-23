CREATE TABLE learning_information_gain_experiments (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  goal_id TEXT NOT NULL REFERENCES user_goals(id) ON DELETE CASCADE,
  plan_id TEXT NOT NULL REFERENCES study_plans(id) ON DELETE CASCADE,
  model_version TEXT NOT NULL,
  proposal_key TEXT NOT NULL,
  exposure_date TEXT NOT NULL,
  exploration_node_id TEXT NOT NULL REFERENCES learning_graph_nodes(id) ON DELETE CASCADE,
  exploration_node_label TEXT NOT NULL,
  baseline_evidence_count INTEGER NOT NULL CHECK (baseline_evidence_count >= 0),
  baseline_distribution TEXT NOT NULL,
  proposed_distribution TEXT NOT NULL,
  baseline_distinct_nodes INTEGER NOT NULL CHECK (baseline_distinct_nodes >= 1),
  proposed_distinct_nodes INTEGER NOT NULL CHECK (proposed_distinct_nodes >= 1),
  exploration_sessions INTEGER NOT NULL CHECK (exploration_sessions >= 1),
  baseline_plan_adherence REAL CHECK (baseline_plan_adherence IS NULL OR baseline_plan_adherence BETWEEN 0.0 AND 1.0),
  baseline_due_sessions INTEGER NOT NULL CHECK (baseline_due_sessions >= 0),
  exposed_at TEXT NOT NULL,
  accepted_at TEXT,
  evidence_acquired_at TEXT,
  evidence_latency_hours REAL CHECK (evidence_latency_hours IS NULL OR evidence_latency_hours >= 0.0),
  followup_plan_adherence REAL CHECK (followup_plan_adherence IS NULL OR followup_plan_adherence BETWEEN 0.0 AND 1.0),
  followup_due_sessions INTEGER CHECK (followup_due_sessions IS NULL OR followup_due_sessions >= 0),
  coverage_rate REAL CHECK (coverage_rate IS NULL OR coverage_rate BETWEEN 0.0 AND 1.0),
  completed_at TEXT,
  cancelled_at TEXT,
  UNIQUE (user_id, goal_id, model_version, proposal_key, exposure_date)
);

CREATE INDEX idx_information_gain_user
  ON learning_information_gain_experiments(user_id, exposed_at DESC);

CREATE INDEX idx_information_gain_completed
  ON learning_information_gain_experiments(completed_at DESC)
  WHERE completed_at IS NOT NULL AND cancelled_at IS NULL;
