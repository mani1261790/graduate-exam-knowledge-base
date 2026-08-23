import { describe, expect, it } from "vitest";
import {
  buildDiagnosticContentCoverage,
  mergeDiagnosticContentInventory,
  type DiagnosticContentNodeRow,
} from "../src/worker/diagnostic-content";

function node(index: number, overrides: Partial<DiagnosticContentNodeRow> = {}): DiagnosticContentNodeRow {
  return {
    graph_id: "graph_math",
    subject_key: "math",
    topic: "数学",
    graph_node_id: `node_${index}`,
    node_label: `ノード${index}`,
    node_type: "CORE",
    layer: 2,
    mapped_concept_count: 2,
    direct_problem_count: 2,
    eligible_problem_count: 3,
    downstream_weight: 1,
    ...overrides,
  };
}

describe("diagnostic content coverage", () => {
  it("counts only candidates accepted by the same node-title matcher used by study plans", () => {
    const inventory = node(1);
    const merged = mergeDiagnosticContentInventory(
      [{
        graph_id: inventory.graph_id,
        subject_key: inventory.subject_key,
        topic: inventory.topic,
        graph_node_id: inventory.graph_node_id,
        node_label: "確率",
        node_type: inventory.node_type,
        layer: inventory.layer,
        mapped_concept_count: inventory.mapped_concept_count,
        downstream_weight: inventory.downstream_weight,
      }],
      [
        { graph_node_id: inventory.graph_node_id, problem_id: "focused", problem_label: "確率の確認問題", edge_type: "tests" },
        { graph_node_id: inventory.graph_node_id, problem_id: "broad", problem_label: "データ分析総合", edge_type: "tests" },
        { graph_node_id: inventory.graph_node_id, problem_id: "required", problem_label: "確率の応用", edge_type: "requires" },
      ],
      (nodeLabel, problemLabel) => problemLabel.includes(nodeLabel),
    );
    expect(merged[0].direct_problem_count).toBe(1);
    expect(merged[0].eligible_problem_count).toBe(2);
  });

  it("counts an approved explicit direct link when the title matcher rejects it", () => {
    const inventory = node(1);
    const merged = mergeDiagnosticContentInventory(
      [{
        graph_id: inventory.graph_id,
        subject_key: inventory.subject_key,
        topic: inventory.topic,
        graph_node_id: inventory.graph_node_id,
        node_label: "確率",
        node_type: inventory.node_type,
        layer: inventory.layer,
        mapped_concept_count: inventory.mapped_concept_count,
        downstream_weight: inventory.downstream_weight,
      }],
      [{ graph_node_id: inventory.graph_node_id, problem_id: "explicit", problem_label: "専門科目 M2", edge_type: "tests", explicit_direct: 1 }],
      () => false,
    );
    expect(merged[0].direct_problem_count).toBe(1);
  });

  it("supports content readiness when at least 80% of active nodes have two direct problems", () => {
    const rows = Array.from({ length: 10 }, (_, index) => node(index, {
      direct_problem_count: index < 8 ? 2 : 1,
      eligible_problem_count: index < 8 ? 3 : 1,
    }));
    const health = buildDiagnosticContentCoverage(rows);
    expect(health.status).toBe("supported");
    expect(health.ready_rate).toBe(0.8);
    expect(health.single_candidate_nodes).toBe(2);
  });

  it("rejects a catalog where fewer than half of nodes are diagnostically ready", () => {
    const rows = Array.from({ length: 10 }, (_, index) => node(index, {
      direct_problem_count: index < 4 ? 2 : 0,
      eligible_problem_count: index < 4 ? 2 : 0,
    }));
    const health = buildDiagnosticContentCoverage(rows);
    expect(health.status).toBe("rejected");
    expect(health.ready_rate).toBe(0.4);
    expect(health.zero_candidate_nodes).toBe(6);
  });

  it("prioritizes unmapped and foundational zero-problem nodes before single-problem gaps", () => {
    const health = buildDiagnosticContentCoverage([
      node(1, { direct_problem_count: 1, eligible_problem_count: 1 }),
      node(2, { mapped_concept_count: 0, direct_problem_count: 0, eligible_problem_count: 0, node_type: "APPLICATION" }),
      node(3, { direct_problem_count: 0, eligible_problem_count: 1, node_type: "FOUNDATIONAL", downstream_weight: 3 }),
    ]);
    expect(health.priority_gaps.map((gap) => gap.gap_type)).toEqual([
      "unmapped",
      "no_direct_problem",
      "single_direct_problem",
    ]);
    expect(health.priority_gaps[0].action).toContain("概念マッピング");
  });

  it("drops malformed rows instead of inflating the readiness denominator", () => {
    const malformed = node(2, { direct_problem_count: 3, eligible_problem_count: 1 });
    const health = buildDiagnosticContentCoverage([node(1), malformed]);
    expect(health.total_nodes).toBe(1);
    expect(health.ready_rate).toBe(1);
  });
});
