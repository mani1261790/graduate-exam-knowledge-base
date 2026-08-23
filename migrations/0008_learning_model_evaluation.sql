ALTER TABLE recommendation_candidates ADD COLUMN model_version TEXT NOT NULL DEFAULT 'recommendation-v3';
ALTER TABLE recommendation_candidates ADD COLUMN predicted_success REAL CHECK (predicted_success IS NULL OR (predicted_success >= 0.0 AND predicted_success <= 1.0));
ALTER TABLE recommendation_candidates ADD COLUMN baseline_success REAL CHECK (baseline_success IS NULL OR (baseline_success >= 0.0 AND baseline_success <= 1.0));
ALTER TABLE recommendation_candidates ADD COLUMN prediction_confidence REAL CHECK (prediction_confidence IS NULL OR (prediction_confidence >= 0.0 AND prediction_confidence <= 1.0));

CREATE TABLE learning_model_predictions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  problem_id TEXT NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
  mode TEXT NOT NULL CHECK (mode IN ('normal', 'review', 'foundation', 'challenge')),
  model_version TEXT NOT NULL,
  personalized_prediction REAL NOT NULL CHECK (personalized_prediction >= 0.0 AND personalized_prediction <= 1.0),
  baseline_prediction REAL NOT NULL CHECK (baseline_prediction >= 0.0 AND baseline_prediction <= 1.0),
  prediction_confidence REAL NOT NULL CHECK (prediction_confidence >= 0.0 AND prediction_confidence <= 1.0),
  rank_position INTEGER NOT NULL CHECK (rank_position >= 1 AND rank_position <= 100),
  recommendation_score REAL NOT NULL CHECK (recommendation_score >= 0.0 AND recommendation_score <= 1.0),
  exposure_date TEXT NOT NULL,
  exposed_at TEXT NOT NULL,
  observed_attempt_id TEXT REFERENCES attempts(id) ON DELETE SET NULL,
  observed_score REAL CHECK (observed_score IS NULL OR (observed_score >= 0.0 AND observed_score <= 1.0)),
  observed_at TEXT,
  UNIQUE (user_id, problem_id, mode, model_version, exposure_date)
);

CREATE TABLE learning_model_shadow_predictions (
  prediction_id TEXT NOT NULL REFERENCES learning_model_predictions(id) ON DELETE CASCADE,
  candidate_version TEXT NOT NULL,
  hypothesis_id TEXT NOT NULL,
  candidate_label TEXT NOT NULL,
  predicted_success REAL NOT NULL CHECK (predicted_success >= 0.0 AND predicted_success <= 1.0),
  PRIMARY KEY (prediction_id, candidate_version)
);

CREATE TABLE learning_strategy_experiments (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  analytics_model_version TEXT NOT NULL,
  strategy_key TEXT NOT NULL,
  recommended_mode TEXT NOT NULL CHECK (recommended_mode IN ('normal', 'review', 'foundation', 'challenge')),
  strategy_confidence TEXT NOT NULL CHECK (strategy_confidence IN ('low', 'medium', 'high')),
  baseline_score REAL CHECK (baseline_score IS NULL OR (baseline_score >= 0.0 AND baseline_score <= 1.0)),
  exposure_date TEXT NOT NULL,
  exposed_at TEXT NOT NULL,
  accepted_at TEXT,
  matched_attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (matched_attempt_count >= 0 AND matched_attempt_count <= 3),
  followup_score REAL CHECK (followup_score IS NULL OR (followup_score >= 0.0 AND followup_score <= 1.0)),
  score_uplift REAL CHECK (score_uplift IS NULL OR (score_uplift >= -1.0 AND score_uplift <= 1.0)),
  completed_at TEXT,
  cancelled_at TEXT,
  UNIQUE (user_id, analytics_model_version, strategy_key, exposure_date)
);

CREATE TABLE learning_readiness_snapshots (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  goal_id TEXT NOT NULL REFERENCES user_goals(id) ON DELETE CASCADE,
  model_version TEXT NOT NULL,
  snapshot_date TEXT NOT NULL,
  target_date TEXT,
  status TEXT NOT NULL CHECK (status IN ('collecting', 'progressing', 'on_track', 'at_risk', 'target_passed')),
  readiness_score REAL NOT NULL CHECK (readiness_score >= 0.0 AND readiness_score <= 1.0),
  lower_bound REAL NOT NULL CHECK (lower_bound >= 0.0 AND lower_bound <= 1.0),
  upper_bound REAL NOT NULL CHECK (upper_bound >= 0.0 AND upper_bound <= 1.0),
  knowledge_readiness REAL CHECK (knowledge_readiness IS NULL OR (knowledge_readiness >= 0.0 AND knowledge_readiness <= 1.0)),
  evidence_coverage REAL CHECK (evidence_coverage IS NULL OR (evidence_coverage >= 0.0 AND evidence_coverage <= 1.0)),
  plan_adherence REAL CHECK (plan_adherence IS NULL OR (plan_adherence >= 0.0 AND plan_adherence <= 1.0)),
  weekly_pace REAL NOT NULL CHECK (weekly_pace >= 0.0),
  required_weekly_pace REAL NOT NULL CHECK (required_weekly_pace >= 0.0),
  recorded_at TEXT NOT NULL,
  UNIQUE (user_id, goal_id, model_version, snapshot_date),
  CHECK (lower_bound <= readiness_score AND readiness_score <= upper_bound)
);

CREATE INDEX idx_learning_model_predictions_user_observed
  ON learning_model_predictions(user_id, observed_at DESC, model_version);
CREATE INDEX idx_learning_model_predictions_user_exposed
  ON learning_model_predictions(user_id, exposed_at);
CREATE INDEX idx_learning_model_predictions_pending
  ON learning_model_predictions(user_id, problem_id, exposed_at DESC)
  WHERE observed_attempt_id IS NULL;
CREATE INDEX idx_learning_model_shadow_predictions_candidate
  ON learning_model_shadow_predictions(candidate_version, prediction_id);
CREATE INDEX idx_learning_strategy_experiments_user
  ON learning_strategy_experiments(user_id, exposed_at DESC);
CREATE INDEX idx_learning_strategy_experiments_completed
  ON learning_strategy_experiments(completed_at DESC, recommended_mode)
  WHERE completed_at IS NOT NULL AND cancelled_at IS NULL;
CREATE INDEX idx_learning_readiness_snapshots_user
  ON learning_readiness_snapshots(user_id, goal_id, snapshot_date DESC);
