import type { DiagnosticContentNodeRow } from "./diagnostic-content";

export type DiagnosticContentLinkStatus = "candidate" | "approved" | "rejected" | "deprecated";

export interface DiagnosticRemediationCandidateRow {
  graph_node_id: string;
  problem_id: string;
  problem_label: string;
  university: string;
  exam_year: number;
  answer_format: string;
  estimated_minutes: number;
  statement_preview: string;
  source_url: string;
  page_start: number | null;
  page_end: number | null;
  concept_overlap: number;
  concept_names: string;
  label_match: number;
  link_id: string | null;
  link_status: DiagnosticContentLinkStatus | null;
  link_confidence: number | null;
  link_rationale: string | null;
  link_created_by: string | null;
  link_reviewed_by: string | null;
}

export interface DiagnosticRemediationCandidate {
  problem_id: string;
  problem_label: string;
  university: string;
  exam_year: number;
  answer_format: string;
  estimated_minutes: number;
  statement_preview: string;
  source_url: string;
  page_start: number | null;
  page_end: number | null;
  concept_overlap: number;
  concept_names: string;
  label_match: boolean;
  link: null | {
    id: string;
    status: DiagnosticContentLinkStatus;
    confidence: number;
    rationale: string;
    created_by: string | null;
    reviewed_by: string | null;
  };
}

export interface DiagnosticRemediationItem {
  graph_node_id: string;
  subject_key: string;
  topic: string;
  node_label: string;
  node_type: DiagnosticContentNodeRow["node_type"];
  layer: number;
  mapped_concept_count: number;
  current_direct_count: number;
  target_direct_count: 2;
  deficit: number;
  state: "ready" | "review_candidates" | "new_content_required";
  candidates: DiagnosticRemediationCandidate[];
}

export interface DiagnosticRemediationQueue {
  generated_at: string;
  summary: {
    total_nodes: number;
    ready_nodes: number;
    reviewable_nodes: number;
    new_content_nodes: number;
    pending_reviews: number;
    approved_explicit_links: number;
  };
  items: DiagnosticRemediationItem[];
}

const NODE_TYPE_PRIORITY: Record<DiagnosticContentNodeRow["node_type"], number> = {
  FOUNDATIONAL: 4,
  BASIC: 3,
  CORE: 2,
  APPLICATION: 1,
};

const STATE_PRIORITY: Record<DiagnosticRemediationItem["state"], number> = {
  review_candidates: 0,
  new_content_required: 1,
  ready: 2,
};

function validCandidate(row: DiagnosticRemediationCandidateRow): boolean {
  return Boolean(row.graph_node_id && row.problem_id && row.problem_label && row.university && row.source_url && row.concept_names)
    && Number.isInteger(row.exam_year)
    && Number.isInteger(row.estimated_minutes)
    && row.estimated_minutes > 0
    && Number.isInteger(row.concept_overlap)
    && row.concept_overlap > 0
    && (row.label_match === 0 || row.label_match === 1)
    && (row.link_status === null || ["candidate", "approved", "rejected", "deprecated"].includes(row.link_status));
}

function linkPriority(status: DiagnosticContentLinkStatus | null): number {
  if (status === "candidate") return 4;
  if (status === "approved") return 3;
  if (status === null) return 2;
  return 1;
}

export function buildDiagnosticRemediationQueue(
  nodes: DiagnosticContentNodeRow[],
  candidateRows: DiagnosticRemediationCandidateRow[],
  generatedAt = new Date().toISOString(),
): DiagnosticRemediationQueue {
  const candidatesByNode = new Map<string, DiagnosticRemediationCandidateRow[]>();
  for (const row of candidateRows.filter(validCandidate)) {
    const candidates = candidatesByNode.get(row.graph_node_id) ?? [];
    if (!candidates.some((candidate) => candidate.problem_id === row.problem_id)) candidates.push(row);
    candidatesByNode.set(row.graph_node_id, candidates);
  }

  const validNodes = nodes.filter((node) => node.graph_node_id && node.graph_id && node.subject_key && node.node_label
    && Number.isInteger(node.layer) && node.layer >= 0 && node.layer <= 3
    && Number.isInteger(node.mapped_concept_count) && node.mapped_concept_count >= 0
    && Number.isInteger(node.direct_problem_count) && node.direct_problem_count >= 0
    && Number.isFinite(node.downstream_weight) && node.downstream_weight >= 0);

  const items = validNodes.map((node): DiagnosticRemediationItem => {
    const candidates = [...(candidatesByNode.get(node.graph_node_id) ?? [])]
      .sort((left, right) => linkPriority(right.link_status) - linkPriority(left.link_status)
        || right.label_match - left.label_match
        || right.concept_overlap - left.concept_overlap
        || left.estimated_minutes - right.estimated_minutes
        || left.problem_label.localeCompare(right.problem_label, "ja"))
      .slice(0, 5)
      .map((candidate): DiagnosticRemediationCandidate => ({
        problem_id: candidate.problem_id,
        problem_label: candidate.problem_label,
        university: candidate.university,
        exam_year: candidate.exam_year,
        answer_format: candidate.answer_format,
        estimated_minutes: candidate.estimated_minutes,
        statement_preview: candidate.statement_preview,
        source_url: candidate.source_url,
        page_start: candidate.page_start === null ? null : Number(candidate.page_start),
        page_end: candidate.page_end === null ? null : Number(candidate.page_end),
        concept_overlap: candidate.concept_overlap,
        concept_names: candidate.concept_names,
        label_match: candidate.label_match === 1,
        link: candidate.link_id && candidate.link_status ? {
          id: candidate.link_id,
          status: candidate.link_status,
          confidence: Number(candidate.link_confidence ?? 0),
          rationale: candidate.link_rationale ?? "",
          created_by: candidate.link_created_by,
          reviewed_by: candidate.link_reviewed_by,
        } : null,
      }));
    const deficit = Math.max(0, 2 - node.direct_problem_count);
    const usableCandidates = candidates.filter((candidate) => candidate.link?.status !== "rejected" && candidate.link?.status !== "deprecated");
    const state: DiagnosticRemediationItem["state"] = deficit === 0
      ? "ready"
      : usableCandidates.length > 0
        ? "review_candidates"
        : "new_content_required";
    return {
      graph_node_id: node.graph_node_id,
      subject_key: node.subject_key,
      topic: node.topic,
      node_label: node.node_label,
      node_type: node.node_type,
      layer: node.layer,
      mapped_concept_count: node.mapped_concept_count,
      current_direct_count: node.direct_problem_count,
      target_direct_count: 2,
      deficit,
      state,
      candidates,
    };
  }).sort((left, right) => STATE_PRIORITY[left.state] - STATE_PRIORITY[right.state]
    || right.deficit - left.deficit
    || NODE_TYPE_PRIORITY[right.node_type] - NODE_TYPE_PRIORITY[left.node_type]
    || left.layer - right.layer
    || left.node_label.localeCompare(right.node_label, "ja"));

  const allLinks = items.flatMap((item) => item.candidates.map((candidate) => candidate.link).filter((link) => link !== null));
  return {
    generated_at: generatedAt,
    summary: {
      total_nodes: items.length,
      ready_nodes: items.filter((item) => item.state === "ready").length,
      reviewable_nodes: items.filter((item) => item.state === "review_candidates").length,
      new_content_nodes: items.filter((item) => item.state === "new_content_required").length,
      pending_reviews: allLinks.filter((link) => link.status === "candidate").length,
      approved_explicit_links: allLinks.filter((link) => link.status === "approved").length,
    },
    items,
  };
}
