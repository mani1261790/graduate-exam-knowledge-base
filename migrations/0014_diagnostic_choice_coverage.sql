ALTER TABLE learning_diagnostic_item_exposures
  ADD COLUMN candidate_problem_count INTEGER NOT NULL DEFAULT 1
  CHECK (candidate_problem_count >= 1);

ALTER TABLE learning_diagnostic_item_exposures
  ADD COLUMN comparable_candidate_count INTEGER NOT NULL DEFAULT 1
  CHECK (comparable_candidate_count >= 1 AND comparable_candidate_count <= candidate_problem_count);

ALTER TABLE learning_diagnostic_item_exposures
  ADD COLUMN utility_spread REAL NOT NULL DEFAULT 0.0
  CHECK (utility_spread BETWEEN 0.0 AND 1.0);

ALTER TABLE learning_diagnostic_item_exposures
  ADD COLUMN ranking_opportunity INTEGER NOT NULL DEFAULT 0
  CHECK (ranking_opportunity IN (0, 1));

ALTER TABLE learning_diagnostic_item_exposures
  ADD COLUMN selection_changed INTEGER NOT NULL DEFAULT 0
  CHECK (selection_changed IN (0, 1));

CREATE INDEX idx_diagnostic_item_opportunity
  ON learning_diagnostic_item_exposures(ranking_opportunity, exposed_at DESC)
  WHERE cancelled_at IS NULL;
