PRAGMA foreign_keys = ON;

CREATE TABLE learning_graph_problem_links (
  id TEXT PRIMARY KEY,
  graph_node_id TEXT NOT NULL REFERENCES learning_graph_nodes(id) ON DELETE CASCADE,
  problem_id TEXT NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
  relation_type TEXT NOT NULL CHECK (relation_type IN ('direct', 'supporting')),
  confidence REAL NOT NULL CHECK (confidence >= 0.0 AND confidence <= 1.0),
  evidence_type TEXT NOT NULL CHECK (evidence_type IN ('manual', 'concept_overlap', 'label_match')),
  rationale TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'candidate' CHECK (status IN ('candidate', 'approved', 'rejected', 'deprecated')),
  created_by TEXT NOT NULL REFERENCES users(id),
  reviewed_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  reviewed_at TEXT,
  UNIQUE (graph_node_id, problem_id, relation_type)
);

CREATE INDEX idx_graph_problem_links_node_status
  ON learning_graph_problem_links(graph_node_id, relation_type, status);
CREATE INDEX idx_graph_problem_links_problem_status
  ON learning_graph_problem_links(problem_id, relation_type, status);
