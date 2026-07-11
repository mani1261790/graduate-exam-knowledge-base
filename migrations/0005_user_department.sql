ALTER TABLE users ADD COLUMN department TEXT;

-- 所属を使う新しいスコアで次回アクセス時に推薦を作り直す。
DELETE FROM recommendation_candidates;
