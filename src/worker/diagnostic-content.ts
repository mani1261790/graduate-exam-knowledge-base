export interface DiagnosticContentNodeInventoryRow {
  graph_id: string;
  subject_key: string;
  topic: string;
  graph_node_id: string;
  node_label: string;
  node_type: "FOUNDATIONAL" | "BASIC" | "CORE" | "APPLICATION";
  layer: number;
  mapped_concept_count: number;
  downstream_weight: number;
}

export interface DiagnosticContentCandidateRow {
  graph_node_id: string;
  problem_id: string;
  problem_label: string;
  edge_type: "tests" | "requires";
  explicit_direct?: number;
}

export interface DiagnosticContentNodeRow extends DiagnosticContentNodeInventoryRow {
  direct_problem_count: number;
  eligible_problem_count: number;
}

export interface DiagnosticContentGap {
  graph_node_id: string;
  subject_key: string;
  topic: string;
  node_label: string;
  node_type: DiagnosticContentNodeRow["node_type"];
  mapped_concept_count: number;
  direct_problem_count: number;
  eligible_problem_count: number;
  gap_type: "unmapped" | "no_direct_problem" | "single_direct_problem";
  action: string;
}

export interface DiagnosticContentCoverage {
  active_graphs: number;
  total_nodes: number;
  mapped_nodes: number;
  mapped_node_rate: number | null;
  ready_nodes: number;
  ready_rate: number | null;
  target_ready_rate: 0.8;
  minimum_direct_problems: 2;
  zero_candidate_nodes: number;
  single_candidate_nodes: number;
  by_subject: Array<{
    subject_key: string;
    topic: string;
    nodes: number;
    mapped_nodes: number;
    ready_nodes: number;
    ready_rate: number;
  }>;
  priority_gaps: DiagnosticContentGap[];
  status: "collecting" | "supported" | "neutral" | "rejected";
  hypothesis: {
    id: "P14_DIAGNOSTIC_CONTENT_COVERAGE";
    label: string;
    status: "collecting" | "supported" | "neutral" | "rejected";
    evidence: string;
  };
}

function round(value: number, digits = 3): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function mergeDiagnosticContentInventory(
  nodes: DiagnosticContentNodeInventoryRow[],
  candidates: DiagnosticContentCandidateRow[],
  matchesNode: (nodeLabel: string, problemLabel: string) => boolean,
): DiagnosticContentNodeRow[] {
  const nodeById = new Map(nodes.map((node) => [node.graph_node_id, node]));
  const eligibleByNode = new Map<string, Set<string>>();
  const directByNode = new Map<string, Set<string>>();
  for (const candidate of candidates) {
    const node = nodeById.get(candidate.graph_node_id);
    if (!node || (candidate.explicit_direct !== 1 && !matchesNode(node.node_label, candidate.problem_label))) continue;
    const eligible = eligibleByNode.get(node.graph_node_id) ?? new Set<string>();
    eligible.add(candidate.problem_id);
    eligibleByNode.set(node.graph_node_id, eligible);
    if (candidate.edge_type === "tests") {
      const direct = directByNode.get(node.graph_node_id) ?? new Set<string>();
      direct.add(candidate.problem_id);
      directByNode.set(node.graph_node_id, direct);
    }
  }
  return nodes.map((node) => ({
    ...node,
    direct_problem_count: directByNode.get(node.graph_node_id)?.size ?? 0,
    eligible_problem_count: eligibleByNode.get(node.graph_node_id)?.size ?? 0,
  }));
}

function gapFor(row: DiagnosticContentNodeRow): DiagnosticContentGap | null {
  if (row.direct_problem_count >= 2) return null;
  const gapType: DiagnosticContentGap["gap_type"] = row.mapped_concept_count === 0
    ? "unmapped"
    : row.direct_problem_count === 0
      ? "no_direct_problem"
      : "single_direct_problem";
  const action = gapType === "unmapped"
    ? "概念マッピングをレビューしてから問題を割り当てる"
    : gapType === "no_direct_problem"
      ? "承認済みtestsエッジを持つ直接測定問題を2問追加する"
      : "異なる出題形式の直接測定問題を1問追加する";
  return {
    graph_node_id: row.graph_node_id,
    subject_key: row.subject_key,
    topic: row.topic,
    node_label: row.node_label,
    node_type: row.node_type,
    mapped_concept_count: row.mapped_concept_count,
    direct_problem_count: row.direct_problem_count,
    eligible_problem_count: row.eligible_problem_count,
    gap_type: gapType,
    action,
  };
}

export function buildDiagnosticContentCoverage(inputRows: DiagnosticContentNodeRow[]): DiagnosticContentCoverage {
  const rows = inputRows
    .filter((row) => row.graph_id && row.graph_node_id && row.subject_key && row.node_label
      && Number.isInteger(row.layer) && row.layer >= 0 && row.layer <= 3
      && Number.isInteger(row.mapped_concept_count) && row.mapped_concept_count >= 0
      && Number.isInteger(row.direct_problem_count) && row.direct_problem_count >= 0
      && Number.isInteger(row.eligible_problem_count) && row.eligible_problem_count >= row.direct_problem_count
      && Number.isFinite(row.downstream_weight) && row.downstream_weight >= 0);
  const totalNodes = rows.length;
  const mappedNodes = rows.filter((row) => row.mapped_concept_count > 0).length;
  const readyNodes = rows.filter((row) => row.direct_problem_count >= 2).length;
  const readyRate = totalNodes === 0 ? null : readyNodes / totalNodes;
  const subjectMap = new Map<string, DiagnosticContentNodeRow[]>();
  for (const row of rows) {
    const subjectRows = subjectMap.get(row.subject_key) ?? [];
    subjectRows.push(row);
    subjectMap.set(row.subject_key, subjectRows);
  }
  const bySubject = [...subjectMap.entries()].map(([subjectKey, subjectRows]) => {
    const subjectReady = subjectRows.filter((row) => row.direct_problem_count >= 2).length;
    return {
      subject_key: subjectKey,
      topic: subjectRows[0].topic,
      nodes: subjectRows.length,
      mapped_nodes: subjectRows.filter((row) => row.mapped_concept_count > 0).length,
      ready_nodes: subjectReady,
      ready_rate: round(subjectReady / subjectRows.length),
    };
  }).sort((left, right) => left.ready_rate - right.ready_rate || left.subject_key.localeCompare(right.subject_key));
  const typePriority: Record<DiagnosticContentNodeRow["node_type"], number> = {
    FOUNDATIONAL: 4,
    BASIC: 3,
    CORE: 2,
    APPLICATION: 1,
  };
  const priorityGaps = rows
    .flatMap((row) => {
      const gap = gapFor(row);
      return gap ? [{ row, gap }] : [];
    })
    .sort((left, right) => left.gap.direct_problem_count - right.gap.direct_problem_count
      || Number(left.gap.gap_type !== "unmapped") - Number(right.gap.gap_type !== "unmapped")
      || typePriority[right.row.node_type] - typePriority[left.row.node_type]
      || right.row.downstream_weight - left.row.downstream_weight
      || left.row.layer - right.row.layer
      || left.row.node_label.localeCompare(right.row.node_label, "ja"))
    .slice(0, 20)
    .map(({ gap }) => gap);
  const status: DiagnosticContentCoverage["status"] = readyRate === null
    ? "collecting"
    : readyRate >= 0.8
      ? "supported"
      : readyRate < 0.5
        ? "rejected"
        : "neutral";
  return {
    active_graphs: new Set(rows.map((row) => row.graph_id)).size,
    total_nodes: totalNodes,
    mapped_nodes: mappedNodes,
    mapped_node_rate: totalNodes === 0 ? null : round(mappedNodes / totalNodes),
    ready_nodes: readyNodes,
    ready_rate: readyRate === null ? null : round(readyRate),
    target_ready_rate: 0.8,
    minimum_direct_problems: 2,
    zero_candidate_nodes: rows.filter((row) => row.direct_problem_count === 0).length,
    single_candidate_nodes: rows.filter((row) => row.direct_problem_count === 1).length,
    by_subject: bySubject,
    priority_gaps: priorityGaps,
    status,
    hypothesis: {
      id: "P14_DIAGNOSTIC_CONTENT_COVERAGE",
      label: "アクティブ学習ノードの80%以上で直接測定問題を2問以上確保する",
      status,
      evidence: readyRate === null ? "アクティブな学習ノードなし" : `${readyNodes} / ${totalNodes}ノード（${Math.round(readyRate * 100)}%）`,
    },
  };
}
