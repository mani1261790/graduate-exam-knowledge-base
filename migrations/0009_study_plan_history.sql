ALTER TABLE study_plan_items ADD COLUMN superseded_at TEXT;

ALTER TABLE study_plan_items ADD COLUMN superseded_reason TEXT
  CHECK (superseded_reason IS NULL OR superseded_reason IN ('overdue_replanned'));

CREATE INDEX idx_study_plan_items_history
  ON study_plan_items(plan_id, scheduled_date, superseded_at, status);
