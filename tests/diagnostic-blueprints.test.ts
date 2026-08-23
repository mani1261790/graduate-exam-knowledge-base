import { describe, expect, it } from "vitest";
import {
  buildDiagnosticBlueprintQueue,
  defaultDiagnosticBlueprint,
  validateDiagnosticBlueprintInput,
  type DiagnosticBlueprintRow,
} from "../src/worker/diagnostic-blueprints";
import type { DiagnosticContentNodeRow } from "../src/worker/diagnostic-content";

const contentNode: DiagnosticContentNodeRow = {
  graph_id: "graph-1",
  subject_key: "math",
  topic: "数学基礎と数理的手法",
  graph_node_id: "node-1",
  node_label: "線形代数",
  node_type: "FOUNDATIONAL",
  layer: 0,
  mapped_concept_count: 1,
  downstream_weight: 2,
  direct_problem_count: 0,
  eligible_problem_count: 0,
};

function row(slot: 1 | 2 | 3, overrides: Partial<DiagnosticBlueprintRow> = {}): DiagnosticBlueprintRow {
  const input = defaultDiagnosticBlueprint(contentNode, slot);
  return {
    id: `blueprint-${slot}`,
    graph_node_id: contentNode.graph_node_id,
    slot,
    title: input.title,
    assessment_objective: input.assessment_objective,
    evidence_expectation: input.evidence_expectation,
    cognitive_demand: input.cognitive_demand,
    answer_format: input.answer_format,
    difficulty: input.difficulty,
    estimated_minutes: input.estimated_minutes,
    rubric_json: JSON.stringify(input.rubric),
    misconception_targets_json: JSON.stringify(input.misconception_targets),
    originality_policy: "original_only",
    status: "approved",
    revision: 3,
    review_note: null,
    created_by: "editor",
    submitted_by: "editor",
    reviewed_by: "reviewer",
    submitted_at: "2026-08-23T00:00:00.000Z",
    reviewed_at: "2026-08-23T00:10:00.000Z",
    ...overrides,
  };
}

describe("diagnostic problem blueprints", () => {
  it("creates a valid original-only default without creating a problem statement", () => {
    const input = defaultDiagnosticBlueprint(contentNode, 1);
    const validation = validateDiagnosticBlueprintInput(input);
    expect(validation.issues).toEqual([]);
    expect(validation.data?.originality_policy).toBe("original_only");
    expect(input).not.toHaveProperty("statement_text");
  });

  it("rejects rubrics whose weights do not sum to one", () => {
    const input = defaultDiagnosticBlueprint(contentNode, 1);
    const validation = validateDiagnosticBlueprintInput({
      ...input,
      rubric: input.rubric.map((criterion) => ({ ...criterion, weight: 0.2 })),
    });
    expect(validation.issues).toContain("採点重みの合計は1.0にしてください");
  });

  it("requires two approved and valid specifications with different cognitive demands", () => {
    const queue = buildDiagnosticBlueprintQueue([contentNode], [row(1), row(2)]);
    expect(queue.items[0].state).toBe("specification_ready");
    expect(queue.summary).toMatchObject({ specification_ready_nodes: 1, approved_blueprints: 2 });
  });

  it("keeps an extra candidate in the review queue after the node is specification-ready", () => {
    const queue = buildDiagnosticBlueprintQueue([contentNode], [row(1), row(2), row(3, { status: "candidate" })]);
    expect(queue.items[0]).toMatchObject({ state: "in_review", specification_ready: true, pending_review_count: 1 });
    expect(queue.summary).toMatchObject({ specification_ready_nodes: 1, pending_blueprints: 1, review_nodes: 1 });
  });

  it("does not treat duplicate cognitive demand or malformed approved data as ready", () => {
    const duplicateDemand = row(2, { cognitive_demand: "concept_application" });
    const malformed = row(3, { rubric_json: "[]" });
    const queue = buildDiagnosticBlueprintQueue([contentNode], [row(1), duplicateDemand, malformed]);
    expect(queue.items[0].state).toBe("drafting");
    expect(queue.items[0].approved_cognitive_demands).toEqual(["concept_application"]);
    expect(queue.summary.approved_blueprints).toBe(2);
  });

  it("excludes nodes that already have two usable direct problems", () => {
    const queue = buildDiagnosticBlueprintQueue([{ ...contentNode, direct_problem_count: 2, eligible_problem_count: 2 }], []);
    expect(queue.summary.nodes_needing_problems).toBe(0);
    expect(queue.items).toEqual([]);
  });
});
