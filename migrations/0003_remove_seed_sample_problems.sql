PRAGMA foreign_keys = ON;

DELETE FROM recommendation_candidates
WHERE problem_id IN ('prob_eigen_001', 'prob_rank_001', 'prob_union_find_001', 'prob_dp_001');

DELETE FROM mistakes
WHERE attempt_id IN (
  SELECT id FROM attempts
  WHERE problem_id IN ('prob_eigen_001', 'prob_rank_001', 'prob_union_find_001', 'prob_dp_001')
);

DELETE FROM attempts
WHERE problem_id IN ('prob_eigen_001', 'prob_rank_001', 'prob_union_find_001', 'prob_dp_001');

DELETE FROM problem_parts
WHERE problem_id IN ('prob_eigen_001', 'prob_rank_001', 'prob_union_find_001', 'prob_dp_001');

DELETE FROM problem_search_fts
WHERE problem_id IN ('prob_eigen_001', 'prob_rank_001', 'prob_union_find_001', 'prob_dp_001');

DELETE FROM knowledge_edges
WHERE from_node_id IN (
  'node_prob_eigen_001',
  'node_prob_rank_001',
  'node_prob_union_find_001',
  'node_prob_dp_001',
  'node_src_tokyo_2024_math',
  'node_src_osaka_2023_algo'
)
OR to_node_id IN (
  'node_prob_eigen_001',
  'node_prob_rank_001',
  'node_prob_union_find_001',
  'node_prob_dp_001',
  'node_src_tokyo_2024_math',
  'node_src_osaka_2023_algo'
);

DELETE FROM node_registry
WHERE entity_type = 'problem'
  AND entity_id IN ('prob_eigen_001', 'prob_rank_001', 'prob_union_find_001', 'prob_dp_001');

DELETE FROM problems
WHERE id IN ('prob_eigen_001', 'prob_rank_001', 'prob_union_find_001', 'prob_dp_001');

DELETE FROM assets
WHERE source_document_id IN ('src_tokyo_2024_math', 'src_osaka_2023_algo');

DELETE FROM node_registry
WHERE entity_type = 'source_document'
  AND entity_id IN ('src_tokyo_2024_math', 'src_osaka_2023_algo');

DELETE FROM source_documents
WHERE id IN ('src_tokyo_2024_math', 'src_osaka_2023_algo')
  AND source_url LIKE 'https://example.com/%';
