ALTER TABLE source_documents ADD COLUMN publisher_page_url TEXT;
ALTER TABLE source_documents ADD COLUMN pdf_display_mode TEXT NOT NULL DEFAULT 'external_only'
  CHECK (pdf_display_mode IN ('embed', 'external_only'));
ALTER TABLE source_documents ADD COLUMN source_status TEXT NOT NULL DEFAULT 'needs_review'
  CHECK (source_status IN ('active', 'unavailable', 'needs_review'));
ALTER TABLE source_documents ADD COLUMN source_checked_at TEXT;

-- Promote only the university-owned HTTPS hosts verified during the public-link
-- migration. Third-party mirrors and explicitly restricted records stay private.
UPDATE source_documents
SET access_scope = 'source_link_only'
WHERE access_scope = 'internal_only'
  AND (
    source_url LIKE 'https://admissions.isct.ac.jp/%'
    OR source_url LIKE 'https://cache1.jimu.kyutech.ac.jp/%'
    OR source_url LIKE 'https://program.math.tsukuba.ac.jp/%'
    OR source_url LIKE 'https://www.i.kyoto-u.ac.jp/%'
    OR source_url LIKE 'https://www.i.nagoya-u.ac.jp/%'
    OR source_url LIKE 'https://www.i.u-tokyo.ac.jp/%'
    OR source_url LIKE 'https://www.inf.shizuoka.ac.jp/%'
    OR source_url LIKE 'https://www.ist.osaka-u.ac.jp/%'
    OR source_url LIKE 'https://www.kwansei.ac.jp/%'
    OR source_url LIKE 'https://www.math.is.tohoku.ac.jp/%'
    OR source_url LIKE 'https://www.nitech.ac.jp/%'
    OR source_url LIKE 'https://www.oit.ac.jp/%'
    OR source_url LIKE 'https://www.ouj.ac.jp/%'
    OR source_url LIKE 'https://www.ritsumei.ac.jp/%'
    OR source_url LIKE 'https://www.sk.tsukuba.ac.jp/%'
    OR source_url LIKE 'https://www.uec.ac.jp/%'
  );

UPDATE source_documents
SET source_status = CASE
  WHEN source_url IS NOT NULL AND source_url <> '' AND access_scope IN ('source_link_only', 'public_ready') THEN 'active'
  ELSE 'needs_review'
END,
source_checked_at = datetime('now');

ALTER TABLE user_goals ADD COLUMN goal_text TEXT;
ALTER TABLE user_goals ADD COLUMN target_date TEXT;
ALTER TABLE user_goals ADD COLUMN sessions_per_week INTEGER NOT NULL DEFAULT 5
  CHECK (sessions_per_week BETWEEN 1 AND 7);
ALTER TABLE user_goals ADD COLUMN minutes_per_session INTEGER NOT NULL DEFAULT 45
  CHECK (minutes_per_session BETWEEN 15 AND 180);
ALTER TABLE user_goals ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1));
ALTER TABLE user_goals ADD COLUMN updated_at TEXT NOT NULL DEFAULT '';

CREATE TABLE learning_graphs (
  id TEXT PRIMARY KEY,
  topic TEXT NOT NULL,
  subject_key TEXT NOT NULL,
  source_repository TEXT NOT NULL,
  source_commit TEXT NOT NULL,
  source_model TEXT,
  payload_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'archived')),
  warnings TEXT NOT NULL DEFAULT '[]',
  generated_at TEXT,
  activated_at TEXT,
  created_by TEXT NOT NULL REFERENCES users(id),
  reviewed_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (subject_key, payload_hash)
);

CREATE TABLE learning_graph_nodes (
  id TEXT PRIMARY KEY,
  graph_id TEXT NOT NULL REFERENCES learning_graphs(id) ON DELETE CASCADE,
  upstream_node_id TEXT NOT NULL,
  label TEXT NOT NULL,
  node_type TEXT NOT NULL CHECK (node_type IN ('FOUNDATIONAL', 'BASIC', 'CORE', 'APPLICATION')),
  layer INTEGER NOT NULL CHECK (layer BETWEEN 0 AND 3),
  description TEXT NOT NULL DEFAULT '',
  sort_index INTEGER NOT NULL DEFAULT 0,
  UNIQUE (graph_id, upstream_node_id)
);

CREATE TABLE learning_graph_edges (
  graph_id TEXT NOT NULL REFERENCES learning_graphs(id) ON DELETE CASCADE,
  source_node_id TEXT NOT NULL REFERENCES learning_graph_nodes(id) ON DELETE CASCADE,
  target_node_id TEXT NOT NULL REFERENCES learning_graph_nodes(id) ON DELETE CASCADE,
  relationship TEXT NOT NULL DEFAULT 'prerequisite',
  weight REAL NOT NULL CHECK (weight >= 0.0 AND weight <= 1.0),
  description TEXT NOT NULL DEFAULT '',
  inferred_from TEXT NOT NULL DEFAULT 'edge' CHECK (inferred_from IN ('edge', 'prerequisites', 'both')),
  PRIMARY KEY (graph_id, source_node_id, target_node_id)
);

CREATE TABLE learning_graph_concept_links (
  graph_node_id TEXT NOT NULL REFERENCES learning_graph_nodes(id) ON DELETE CASCADE,
  concept_id TEXT NOT NULL REFERENCES concepts(id) ON DELETE CASCADE,
  confidence REAL NOT NULL DEFAULT 1.0 CHECK (confidence >= 0.0 AND confidence <= 1.0),
  status TEXT NOT NULL DEFAULT 'candidate' CHECK (status IN ('candidate', 'approved', 'rejected')),
  reviewed_by TEXT REFERENCES users(id),
  PRIMARY KEY (graph_node_id, concept_id)
);

CREATE TABLE study_plans (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  goal_id TEXT NOT NULL REFERENCES user_goals(id) ON DELETE CASCADE,
  graph_id TEXT NOT NULL REFERENCES learning_graphs(id),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'archived')),
  start_date TEXT NOT NULL,
  target_date TEXT,
  sessions_per_week INTEGER NOT NULL CHECK (sessions_per_week BETWEEN 1 AND 7),
  minutes_per_session INTEGER NOT NULL CHECK (minutes_per_session BETWEEN 15 AND 180),
  generated_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE study_plan_items (
  id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL REFERENCES study_plans(id) ON DELETE CASCADE,
  graph_node_id TEXT NOT NULL REFERENCES learning_graph_nodes(id),
  problem_id TEXT REFERENCES problems(id),
  sequence INTEGER NOT NULL,
  scheduled_date TEXT NOT NULL,
  estimated_minutes INTEGER NOT NULL CHECK (estimated_minutes BETWEEN 1 AND 180),
  mode TEXT NOT NULL CHECK (mode IN ('normal', 'review', 'foundation', 'challenge', 'concept')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'skipped')),
  reason TEXT NOT NULL,
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (plan_id, graph_node_id, problem_id, scheduled_date)
);

CREATE INDEX idx_source_documents_public_pdf ON source_documents(source_status, pdf_display_mode, access_scope);
CREATE INDEX idx_learning_graphs_active_subject ON learning_graphs(subject_key, status, activated_at DESC);
CREATE INDEX idx_learning_graph_nodes_graph_layer ON learning_graph_nodes(graph_id, layer, sort_index);
CREATE INDEX idx_learning_graph_edges_target ON learning_graph_edges(graph_id, target_node_id, weight DESC);
CREATE INDEX idx_learning_graph_links_concept ON learning_graph_concept_links(concept_id, status);
CREATE INDEX idx_study_plans_user_status ON study_plans(user_id, status, updated_at DESC);
CREATE UNIQUE INDEX idx_study_plans_one_active_per_user ON study_plans(user_id) WHERE status = 'active';
CREATE INDEX idx_study_plan_items_due ON study_plan_items(plan_id, status, scheduled_date, sequence);

INSERT OR IGNORE INTO learning_graphs (
  id, topic, subject_key, source_repository, source_commit, source_model, payload_hash,
  status, warnings, generated_at, activated_at, created_by, reviewed_by
) SELECT
  'lgr_sample_algorithms', 'アルゴリズムと離散数学', 'algorithms',
  'https://github.com/KTaisei/KnowledgeGraph',
  '4bb8bfe73e50aadf12d3e9f896e057b291c177ed',
  'sample-compatible', 'seed-learning-graph-algorithms-v1', 'active', '[]',
  datetime('now'), datetime('now'), 'usr_admin', 'usr_admin'
WHERE EXISTS (SELECT 1 FROM users WHERE id = 'usr_admin');

INSERT OR IGNORE INTO learning_graph_nodes (
  id, graph_id, upstream_node_id, label, node_type, layer, description, sort_index
) VALUES
  ('lgn_sample_graph', 'lgr_sample_algorithms', 'N01_GRAPH', 'グラフ理論', 'FOUNDATIONAL', 0, '頂点と辺、連結性、木などの基礎概念を理解する。', 0),
  ('lgn_sample_search', 'lgr_sample_algorithms', 'N02_SEARCH', 'グラフ探索', 'BASIC', 1, '幅優先探索と深さ優先探索でグラフを走査する。', 1),
  ('lgn_sample_union_find', 'lgr_sample_algorithms', 'N03_UNION_FIND', 'Union-Find', 'CORE', 2, '集合の併合と連結判定を効率的に行う。', 2),
  ('lgn_sample_dp', 'lgr_sample_algorithms', 'N04_DP', '動的計画法', 'APPLICATION', 3, '部分問題と漸化式から計算を組み立てる。', 3);

INSERT OR IGNORE INTO learning_graph_edges (
  graph_id, source_node_id, target_node_id, relationship, weight, description, inferred_from
) VALUES
  ('lgr_sample_algorithms', 'lgn_sample_graph', 'lgn_sample_search', 'prerequisite', 0.9, 'グラフ構造の理解が探索の前提となる。', 'both'),
  ('lgr_sample_algorithms', 'lgn_sample_graph', 'lgn_sample_union_find', 'prerequisite', 0.8, '連結性の理解が集合併合による判定の前提となる。', 'both'),
  ('lgr_sample_algorithms', 'lgn_sample_search', 'lgn_sample_dp', 'recommended_prerequisite', 0.6, '状態遷移を追う経験が動的計画法の理解を助ける。', 'edge');

INSERT OR IGNORE INTO learning_graph_concept_links (graph_node_id, concept_id, confidence, status, reviewed_by)
SELECT 'lgn_sample_graph', 'con_graph', 1.0, 'approved', 'usr_admin' WHERE EXISTS (SELECT 1 FROM concepts WHERE id = 'con_graph');
INSERT OR IGNORE INTO learning_graph_concept_links (graph_node_id, concept_id, confidence, status, reviewed_by)
SELECT 'lgn_sample_search', 'con_graph_search', 1.0, 'approved', 'usr_admin' WHERE EXISTS (SELECT 1 FROM concepts WHERE id = 'con_graph_search');
INSERT OR IGNORE INTO learning_graph_concept_links (graph_node_id, concept_id, confidence, status, reviewed_by)
SELECT 'lgn_sample_union_find', 'con_union_find', 1.0, 'approved', 'usr_admin' WHERE EXISTS (SELECT 1 FROM concepts WHERE id = 'con_union_find');
INSERT OR IGNORE INTO learning_graph_concept_links (graph_node_id, concept_id, confidence, status, reviewed_by)
SELECT 'lgn_sample_dp', 'con_dp', 1.0, 'approved', 'usr_admin' WHERE EXISTS (SELECT 1 FROM concepts WHERE id = 'con_dp');
