import { describe, expect, it } from "vitest";
import {
  buildFocusedNodeSequence,
  buildPlanFocusHealth,
  buildPlanFocusProposal,
  type PlanFocusNodeSignal,
} from "../src/worker/plan-focus";

function node(overrides: Partial<PlanFocusNodeSignal> & Pick<PlanFocusNodeSignal, "id" | "label">): PlanFocusNodeSignal {
  return {
    status: "ready",
    mastery: 0.5,
    evidence_count: 0,
    review_due: false,
    downstream_weight: 0,
    layer: 1,
    ...overrides,
  };
}

describe("plan focus proposal", () => {
  it("does not call an unobserved node a weakness", () => {
    const proposal = buildPlanFocusProposal([
      node({ id: "unknown", label: "未観測", mastery: 0.5, evidence_count: 0 }),
      node({ id: "other", label: "別分野", mastery: 0.5, evidence_count: 0 }),
    ], 10);
    expect(proposal).toBeNull();
  });

  it("does not propose a nominal focus when a two-node plan would keep the same allocation", () => {
    expect(buildPlanFocusProposal([
      node({ id: "weak", label: "弱点", mastery: 0.3, evidence_count: 4 }),
      node({ id: "other", label: "別分野", mastery: 0.7, evidence_count: 4 }),
    ], 10)).toBeNull();
  });

  it("focuses measured bottlenecks while keeping at least half of sessions distributed", () => {
    const nodes = [
      node({ id: "weak", label: "弱点", mastery: 0.35, evidence_count: 4, downstream_weight: 2, layer: 0 }),
      node({ id: "due", label: "復習期限", mastery: 0.7, evidence_count: 5, review_due: true }),
      node({ id: "other", label: "分散対象", mastery: 0.6, evidence_count: 3 }),
    ];
    const proposal = buildPlanFocusProposal(nodes, 10);
    expect(proposal?.focus_node_ids).toEqual(["due"]);
    expect(proposal?.proposed_distinct_nodes).toBe(3);
    const focused = buildFocusedNodeSequence(nodes, proposal?.focus_node_ids ?? [], 10);
    const focusCount = focused.filter((item) => proposal?.focus_node_ids.includes(item.id)).length;
    expect(focusCount).toBeGreaterThanOrEqual(5);
    expect(focused.filter((_, index) => index % 2 === 1)).toHaveLength(5);
  });

  it("refuses a focus policy that would narrow topic coverage below the guardrail", () => {
    const nodes = Array.from({ length: 10 }, (_, index) => node({
      id: `n${index}`,
      label: `分野${index}`,
      mastery: index === 0 ? 0.2 : 0.7,
      evidence_count: 4,
    }));
    expect(buildPlanFocusProposal(nodes, 10)).toBeNull();
  });
});

describe("plan focus health", () => {
  it("suppresses aggregate effects until privacy thresholds are met", () => {
    const rows = Array.from({ length: 30 }, () => ({
      user_id: "one",
      focus_mastery_uplift: 0.08,
      adherence_uplift: 0,
      coverage_rate: 0.8,
    }));
    expect(buildPlanFocusHealth(rows).status).toBe("collecting");
  });

  it("supports focus only when mastery improves and both guardrails hold", () => {
    const rows = Array.from({ length: 30 }, (_, index) => ({
      user_id: `user_${index % 10}`,
      focus_mastery_uplift: 0.08,
      adherence_uplift: -0.03,
      coverage_rate: 0.8,
    }));
    expect(buildPlanFocusHealth(rows).status).toBe("supported");
  });

  it("rejects a plan that improves mastery by sacrificing adherence", () => {
    const rows = Array.from({ length: 30 }, (_, index) => ({
      user_id: `user_${index % 10}`,
      focus_mastery_uplift: 0.1,
      adherence_uplift: -0.2,
      coverage_rate: 0.9,
    }));
    expect(buildPlanFocusHealth(rows).status).toBe("rejected");
  });
});
