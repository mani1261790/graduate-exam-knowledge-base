CREATE TABLE learning_diagnostic_item_exposures (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  goal_id TEXT NOT NULL REFERENCES user_goals(id) ON DELETE CASCADE,
  plan_id TEXT NOT NULL REFERENCES study_plans(id) ON DELETE CASCADE,
  information_gain_experiment_id TEXT NOT NULL REFERENCES learning_information_gain_experiments(id) ON DELETE CASCADE,
  graph_node_id TEXT NOT NULL REFERENCES learning_graph_nodes(id) ON DELETE CASCADE,
  model_version TEXT NOT NULL,
  selected_problem_id TEXT NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
  baseline_problem_id TEXT NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
  selected_utility REAL NOT NULL CHECK (selected_utility BETWEEN 0.0 AND 1.0),
  baseline_utility REAL NOT NULL CHECK (baseline_utility BETWEEN 0.0 AND 1.0),
  target_concept_count INTEGER NOT NULL CHECK (target_concept_count >= 1),
  direct_concept_count INTEGER NOT NULL CHECK (direct_concept_count >= 0),
  weighted_evidence_potential REAL NOT NULL CHECK (weighted_evidence_potential >= 0.0),
  baseline_node_evidence_count INTEGER NOT NULL CHECK (baseline_node_evidence_count >= 0),
  estimated_minutes INTEGER NOT NULL CHECK (estimated_minutes BETWEEN 1 AND 180),
  exposed_at TEXT NOT NULL,
  observed_attempt_id TEXT REFERENCES attempts(id) ON DELETE SET NULL,
  observed_result TEXT CHECK (observed_result IS NULL OR observed_result IN ('not_checked', 'correct', 'partial', 'wrong', 'skipped')),
  observed_direct_evidence_count INTEGER CHECK (observed_direct_evidence_count IS NULL OR observed_direct_evidence_count >= 0),
  observed_total_evidence_gain INTEGER CHECK (observed_total_evidence_gain IS NULL OR observed_total_evidence_gain >= 0),
  observed_time_minutes INTEGER CHECK (observed_time_minutes IS NULL OR observed_time_minutes >= 0),
  completion_latency_hours REAL CHECK (completion_latency_hours IS NULL OR completion_latency_hours >= 0.0),
  observed_at TEXT,
  cancelled_at TEXT,
  UNIQUE (information_gain_experiment_id)
);

CREATE INDEX idx_diagnostic_item_user
  ON learning_diagnostic_item_exposures(user_id, exposed_at DESC);

CREATE INDEX idx_diagnostic_item_health
  ON learning_diagnostic_item_exposures(exposed_at DESC)
  WHERE cancelled_at IS NULL;
