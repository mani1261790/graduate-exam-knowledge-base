CREATE TABLE learning_schedule_adaptation_experiments (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  goal_id TEXT NOT NULL REFERENCES user_goals(id) ON DELETE CASCADE,
  model_version TEXT NOT NULL,
  proposal_key TEXT NOT NULL,
  exposure_date TEXT NOT NULL,
  baseline_sessions_per_week INTEGER NOT NULL CHECK (baseline_sessions_per_week BETWEEN 1 AND 7),
  baseline_minutes_per_session INTEGER NOT NULL CHECK (baseline_minutes_per_session BETWEEN 15 AND 180),
  proposed_sessions_per_week INTEGER NOT NULL CHECK (proposed_sessions_per_week BETWEEN 1 AND 7),
  proposed_minutes_per_session INTEGER NOT NULL CHECK (proposed_minutes_per_session BETWEEN 15 AND 180),
  baseline_plan_adherence REAL NOT NULL CHECK (baseline_plan_adherence BETWEEN 0.0 AND 1.0),
  baseline_weekly_pace REAL NOT NULL CHECK (baseline_weekly_pace >= 0.0),
  baseline_due_sessions INTEGER NOT NULL CHECK (baseline_due_sessions >= 0),
  exposed_at TEXT NOT NULL,
  accepted_at TEXT,
  followup_plan_adherence REAL CHECK (followup_plan_adherence IS NULL OR followup_plan_adherence BETWEEN 0.0 AND 1.0),
  followup_weekly_pace REAL CHECK (followup_weekly_pace IS NULL OR followup_weekly_pace >= 0.0),
  adherence_uplift REAL CHECK (adherence_uplift IS NULL OR adherence_uplift BETWEEN -1.0 AND 1.0),
  followup_due_sessions INTEGER CHECK (followup_due_sessions IS NULL OR followup_due_sessions >= 0),
  completed_at TEXT,
  cancelled_at TEXT,
  UNIQUE (user_id, goal_id, model_version, proposal_key, exposure_date),
  CHECK (proposed_sessions_per_week < baseline_sessions_per_week)
);

CREATE INDEX idx_schedule_adaptation_user
  ON learning_schedule_adaptation_experiments(user_id, exposed_at DESC);

CREATE INDEX idx_schedule_adaptation_completed
  ON learning_schedule_adaptation_experiments(completed_at DESC)
  WHERE completed_at IS NOT NULL AND cancelled_at IS NULL;
