INSERT OR IGNORE INTO users (id, display_name, email, role, status)
VALUES
  ('usr_admin', '管理者', 'admin@example.com', 'admin', 'active'),
  ('usr_member', '学習者', 'member@example.com', 'member', 'active');

INSERT OR IGNORE INTO concepts (id, slug, name_ja, name_en, aliases, concept_type, description, created_by, reviewed_by)
VALUES
  ('con_linear_algebra', 'math.linear_algebra', '線形代数', 'Linear Algebra', '["行列","ベクトル空間"]', 'field', '情報系院試で頻出する行列、線形写像、固有値の基礎分野。', 'usr_admin', 'usr_admin'),
  ('con_matrix_rank', 'math.linear_algebra.matrix_rank', 'ランク', 'Matrix rank', '["階数","列空間","零空間"]', 'concept', '行列の階数、列空間、核、一次独立性を扱う。', 'usr_admin', 'usr_admin'),
  ('con_determinant', 'math.linear_algebra.determinant', '行列式', 'Determinant', '["det","余因子展開","可逆性"]', 'concept', '行列式の計算と可逆性判定を扱う。', 'usr_admin', 'usr_admin'),
  ('con_eigenvalue', 'math.linear_algebra.eigenvalue', '固有値', 'Eigenvalue', '["eigenvalue","特性根","固有ベクトル","特性多項式"]', 'concept', '固有値、固有ベクトル、特性多項式を扱う。', 'usr_admin', 'usr_admin'),
  ('con_diagonalization', 'math.linear_algebra.diagonalization', '対角化', 'Diagonalization', '["対角化可能","固有空間"]', 'concept', '固有空間の次元と対角化可能性を扱う。', 'usr_admin', 'usr_admin'),
  ('con_conditional_probability', 'math.probability.conditional_probability', '条件付き確率', 'Conditional probability', '["ベイズ","独立性","条件付き"]', 'concept', '条件付き確率、ベイズの定理、独立性を扱う。', 'usr_admin', 'usr_admin'),
  ('con_graph', 'cs.discrete.graph', 'グラフ理論', 'Graph theory', '["木","連結","閉路","全域木"]', 'topic', 'グラフ、木、連結性、閉路、全域木を扱う。', 'usr_admin', 'usr_admin'),
  ('con_graph_search', 'cs.algorithm.graph_search', 'グラフ探索', 'Graph search', '["BFS","DFS","最短路","連結成分"]', 'algorithm', 'BFS、DFS、最短路、連結成分を扱う。', 'usr_admin', 'usr_admin'),
  ('con_dp', 'cs.algorithm.dynamic_programming', '動的計画法', 'Dynamic programming', '["DP","漸化式","ナップサック","LCS"]', 'solution_pattern', '部分問題と漸化式で最適値や個数を求める解法。', 'usr_admin', 'usr_admin'),
  ('con_union_find', 'cs.algorithm.union_find', 'Union-Find', 'Disjoint set union', '["素集合データ構造","DSU","経路圧縮","Kruskal"]', 'algorithm', '集合の併合と連結判定を効率よく扱うデータ構造。', 'usr_admin', 'usr_admin');

INSERT OR IGNORE INTO node_registry (node_id, entity_type, entity_id, display_name)
VALUES
  ('node_con_linear_algebra', 'concept', 'con_linear_algebra', '線形代数'),
  ('node_con_matrix_rank', 'concept', 'con_matrix_rank', 'ランク'),
  ('node_con_determinant', 'concept', 'con_determinant', '行列式'),
  ('node_con_eigenvalue', 'concept', 'con_eigenvalue', '固有値'),
  ('node_con_diagonalization', 'concept', 'con_diagonalization', '対角化'),
  ('node_con_conditional_probability', 'concept', 'con_conditional_probability', '条件付き確率'),
  ('node_con_graph', 'concept', 'con_graph', 'グラフ理論'),
  ('node_con_graph_search', 'concept', 'con_graph_search', 'グラフ探索'),
  ('node_con_dp', 'concept', 'con_dp', '動的計画法'),
  ('node_con_union_find', 'concept', 'con_union_find', 'Union-Find');

INSERT OR IGNORE INTO knowledge_edges (id, from_node_id, edge_type, to_node_id, weight, confidence, evidence_type, status, created_by, reviewed_by)
VALUES
  ('edge_det_eigen', 'node_con_determinant', 'prerequisite_of', 'node_con_eigenvalue', 0.9, 0.95, 'manual', 'approved', 'usr_admin', 'usr_admin'),
  ('edge_eigen_diag', 'node_con_eigenvalue', 'prerequisite_of', 'node_con_diagonalization', 0.9, 0.95, 'manual', 'approved', 'usr_admin', 'usr_admin'),
  ('edge_graph_uf', 'node_con_graph', 'prerequisite_of', 'node_con_union_find', 0.7, 0.85, 'manual', 'approved', 'usr_admin', 'usr_admin'),
  ('edge_graph_search_graph', 'node_con_graph_search', 'related_to', 'node_con_graph', 0.7, 0.8, 'manual', 'approved', 'usr_admin', 'usr_admin');

INSERT OR IGNORE INTO source_documents (id, source_type, title, university, graduate_school, department, exam_year, exam_category, source_url, file_hash, storage_path, access_scope, extraction_status, created_by)
VALUES
  ('src_sample_math', 'manual_input', 'サンプル大学 数学演習', 'サンプル大学', '情報学研究科', '情報工学科', 2026, 'サンプル', 'https://example.com/sample-math', 'seed-hash-sample-math', 'samples/math.txt', 'public_ready', 'reviewed', 'usr_admin'),
  ('src_sample_algo', 'manual_input', 'サンプル大学 アルゴリズム演習', 'サンプル大学', '情報学研究科', '情報工学科', 2026, 'サンプル', 'https://example.com/sample-algorithms', 'seed-hash-sample-algo', 'samples/algorithms.txt', 'public_ready', 'reviewed', 'usr_admin');

INSERT OR IGNORE INTO node_registry (node_id, entity_type, entity_id, display_name)
VALUES
  ('node_src_sample_math', 'source_document', 'src_sample_math', 'サンプル大学 数学演習'),
  ('node_src_sample_algo', 'source_document', 'src_sample_algo', 'サンプル大学 アルゴリズム演習');

INSERT OR IGNORE INTO problems (id, source_document_id, problem_label, statement_text, answer_text, explanation_text, subject_raw, difficulty, estimated_minutes, answer_format, status, embedding_status, created_by, reviewed_by)
VALUES
  ('prob_eigen_001', 'src_sample_math', '大問1', '3次正方行列Aの特性多項式が与えられている。固有値を求め、Aが対角化可能であるための条件を述べよ。', '固有値は特性多項式の根であり、各固有値の幾何重複度の和が3なら対角化可能。', '特性多項式を因数分解し、固有空間の次元を確認する。重複固有値では固有空間の次元不足に注意する。', '数学', 3, 25, 'derivation', 'reviewed', 'stale', 'usr_admin', 'usr_admin'),
  ('prob_rank_001', 'src_sample_math', '大問2', 'パラメータtを含む行列Bについて、rank Bが変化するtの値をすべて求めよ。', '行基本変形後の主小行列式が0となるtを調べる。', '通常時のrankと退化時のrankを分けて、行列式と小行列式を確認する。', '数学', 2, 20, 'derivation', 'reviewed', 'stale', 'usr_admin', 'usr_admin'),
  ('prob_union_find_001', 'src_sample_algo', '問2', '無向グラフに辺が順に追加される。各時点で連結成分数を出力する効率的なアルゴリズムを述べ、計算量を示せ。', 'Union-Findを用いて異なる成分を併合し、併合が起きたときだけ成分数を1減らす。ならし計算量はほぼO(α(n))。', '連結成分を明示的に探索し直さず、素集合データ構造で代表元を管理する。', 'アルゴリズム', 3, 20, 'essay', 'reviewed', 'stale', 'usr_admin', 'usr_admin'),
  ('prob_dp_001', 'src_sample_algo', '問3', '長さnの数列から隣接しない要素を選ぶとき、和の最大値を求める動的計画法を設計せよ。', 'dp[i]=max(dp[i-1], dp[i-2]+a[i]) とする。', '最後の要素を選ぶか選ばないかで場合分けし、部分問題を定義する。', 'アルゴリズム', 2, 15, 'programming', 'reviewed', 'stale', 'usr_admin', 'usr_admin');

INSERT OR IGNORE INTO node_registry (node_id, entity_type, entity_id, display_name)
VALUES
  ('node_prob_eigen_001', 'problem', 'prob_eigen_001', 'サンプル大学 2026 大問1 固有値と対角化'),
  ('node_prob_rank_001', 'problem', 'prob_rank_001', 'サンプル大学 2026 大問2 ランク'),
  ('node_prob_union_find_001', 'problem', 'prob_union_find_001', 'サンプル大学 2026 問2 Union-Find'),
  ('node_prob_dp_001', 'problem', 'prob_dp_001', 'サンプル大学 2026 問3 動的計画法');

INSERT OR IGNORE INTO knowledge_edges (id, from_node_id, edge_type, to_node_id, weight, confidence, evidence_type, status, created_by, reviewed_by)
VALUES
  ('edge_prob_eigen_tests', 'node_prob_eigen_001', 'tests', 'node_con_eigenvalue', 0.95, 0.95, 'manual', 'approved', 'usr_admin', 'usr_admin'),
  ('edge_prob_eigen_requires_det', 'node_prob_eigen_001', 'requires', 'node_con_determinant', 0.8, 0.9, 'manual', 'approved', 'usr_admin', 'usr_admin'),
  ('edge_prob_eigen_solved_diag', 'node_prob_eigen_001', 'solved_by', 'node_con_diagonalization', 0.85, 0.9, 'manual', 'approved', 'usr_admin', 'usr_admin'),
  ('edge_prob_rank_tests', 'node_prob_rank_001', 'tests', 'node_con_matrix_rank', 0.95, 0.95, 'manual', 'approved', 'usr_admin', 'usr_admin'),
  ('edge_prob_rank_requires_det', 'node_prob_rank_001', 'requires', 'node_con_determinant', 0.75, 0.85, 'manual', 'approved', 'usr_admin', 'usr_admin'),
  ('edge_prob_uf_tests', 'node_prob_union_find_001', 'tests', 'node_con_union_find', 0.95, 0.95, 'manual', 'approved', 'usr_admin', 'usr_admin'),
  ('edge_prob_uf_requires_graph', 'node_prob_union_find_001', 'requires', 'node_con_graph', 0.7, 0.9, 'manual', 'approved', 'usr_admin', 'usr_admin'),
  ('edge_prob_dp_tests', 'node_prob_dp_001', 'tests', 'node_con_dp', 0.95, 0.95, 'manual', 'approved', 'usr_admin', 'usr_admin'),
  ('edge_prob_eigen_sim_rank', 'node_prob_eigen_001', 'similar_to', 'node_prob_rank_001', 0.58, 0.75, 'manual', 'approved', 'usr_admin', 'usr_admin'),
  ('edge_prob_rank_sim_eigen', 'node_prob_rank_001', 'similar_to', 'node_prob_eigen_001', 0.58, 0.75, 'manual', 'approved', 'usr_admin', 'usr_admin');

INSERT OR IGNORE INTO problem_search_fts (rowid, problem_id, statement_text, explanation_text)
SELECT rowid, id, statement_text, explanation_text FROM problems;
