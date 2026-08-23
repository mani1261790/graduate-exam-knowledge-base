import { describe, expect, it } from "vitest";
import { buildDiagnosticRemediationQueue, type DiagnosticRemediationCandidateRow } from "../src/worker/diagnostic-remediation";
import type { DiagnosticContentNodeRow } from "../src/worker/diagnostic-content";

function node(id: string, direct = 0, nodeType: DiagnosticContentNodeRow["node_type"] = "BASIC"): DiagnosticContentNodeRow {
  return {
    graph_id: "graph-1",
    subject_key: "subject-1",
    topic: "数学",
    graph_node_id: id,
    node_label: `ノード${id}`,
    node_type: nodeType,
    layer: nodeType === "FOUNDATIONAL" ? 0 : 1,
    mapped_concept_count: 1,
    downstream_weight: nodeType === "FOUNDATIONAL" ? 3 : 1,
    direct_problem_count: direct,
    eligible_problem_count: direct,
  };
}

function candidate(nodeId: string, problemId: string, overrides: Partial<DiagnosticRemediationCandidateRow> = {}): DiagnosticRemediationCandidateRow {
  return {
    graph_node_id: nodeId,
    problem_id: problemId,
    problem_label: `問題${problemId}`,
    university: "テスト大学",
    exam_year: 2026,
    answer_format: "proof",
    estimated_minutes: 30,
    statement_preview: "問題文のプレビュー",
    source_url: "https://example.com/exam.pdf",
    page_start: 1,
    page_end: 1,
    concept_overlap: 1,
    concept_names: "確率",
    label_match: 0,
    link_id: null,
    link_status: null,
    link_confidence: null,
    link_rationale: null,
    link_created_by: null,
    link_reviewed_by: null,
    ...overrides,
  };
}

describe("diagnostic content remediation queue", () => {
  it("separates review candidates from nodes that need new content", () => {
    const queue = buildDiagnosticRemediationQueue(
      [node("review"), node("new")],
      [candidate("review", "p1")],
      "2026-08-23T00:00:00.000Z",
    );
    expect(queue.summary).toMatchObject({ total_nodes: 2, reviewable_nodes: 1, new_content_nodes: 1, ready_nodes: 0 });
    expect(queue.items.map((item) => item.state)).toEqual(["review_candidates", "new_content_required"]);
  });

  it("places pending review links before unlinked candidates", () => {
    const queue = buildDiagnosticRemediationQueue(
      [node("review")],
      [
        candidate("review", "unlinked", { label_match: 1 }),
        candidate("review", "pending", { link_id: "link-1", link_status: "candidate", link_confidence: 0.8, link_rationale: "根拠" }),
      ],
    );
    expect(queue.items[0].candidates.map((item) => item.problem_id)).toEqual(["pending", "unlinked"]);
    expect(queue.summary.pending_reviews).toBe(1);
  });

  it("marks nodes with two direct problems as ready", () => {
    const queue = buildDiagnosticRemediationQueue([node("ready", 2)], []);
    expect(queue.items[0]).toMatchObject({ state: "ready", deficit: 0 });
    expect(queue.summary.ready_nodes).toBe(1);
  });

  it("drops malformed candidates instead of exposing them to reviewers", () => {
    const queue = buildDiagnosticRemediationQueue([node("safe")], [candidate("safe", "bad", { concept_overlap: 0 })]);
    expect(queue.items[0]).toMatchObject({ state: "new_content_required", candidates: [] });
  });
});
