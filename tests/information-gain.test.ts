import { describe, expect, it } from "vitest";
import {
  buildExplorationNodeSequence,
  buildInformationGainHealth,
  buildInformationGainProposal,
  type InformationGainNodeSignal,
} from "../src/worker/information-gain";

function node(overrides: Partial<InformationGainNodeSignal> & Pick<InformationGainNodeSignal, "id" | "label">): InformationGainNodeSignal {
  return {
    status: "ready",
    mastery: 0.5,
    evidence_count: 0,
    review_due: false,
    downstream_weight: 0,
    layer: 1,
    available_problem_count: 1,
    ...overrides,
  };
}

describe("diagnostic exploration proposal", () => {
  it("never proposes an unknown node without a focused practice problem", () => {
    expect(buildInformationGainProposal([
      node({ id: "unknown", label: "未知", available_problem_count: 0 }),
      node({ id: "observed", label: "観測済み", evidence_count: 3 }),
    ], 10)).toBeNull();
  });

  it("never explores an observed node as though it were unknown", () => {
    expect(buildInformationGainProposal([
      node({ id: "observed", label: "観測済み", evidence_count: 1 }),
      node({ id: "other", label: "別分野", evidence_count: 2 }),
    ], 10)).toBeNull();
  });

  it("front-loads no more than 20 percent and preserves topic coverage", () => {
    const nodes = [
      node({ id: "unknown", label: "未知", downstream_weight: 3, available_problem_count: 3 }),
      node({ id: "n2", label: "分野2", evidence_count: 2 }),
      node({ id: "n3", label: "分野3", evidence_count: 2 }),
      node({ id: "n4", label: "分野4", evidence_count: 2 }),
    ];
    const proposal = buildInformationGainProposal(nodes, 10);
    expect(proposal?.exploration_node_id).toBe("unknown");
    expect(proposal?.exploration_sessions).toBe(2);
    expect((proposal?.proposed_distinct_nodes ?? 0) / (proposal?.baseline_distinct_nodes ?? 1)).toBeGreaterThanOrEqual(0.7);
    const sequence = buildExplorationNodeSequence(nodes, "unknown", 10);
    expect(sequence.filter((item) => item.id === "unknown")).toHaveLength(2);
    expect(sequence[0].id).toBe("unknown");
    expect(sequence[2].id).toBe("unknown");
  });

  it("never creates more confirmation sessions than available practice problems", () => {
    const nodes = [
      node({ id: "unknown", label: "未知", available_problem_count: 1 }),
      node({ id: "other", label: "別分野", evidence_count: 2 }),
    ];
    const proposal = buildInformationGainProposal(nodes, 10);
    expect(proposal?.exploration_sessions).toBe(1);
    expect(buildExplorationNodeSequence(nodes, "unknown", 10).filter((item) => item.id === "unknown")).toHaveLength(1);
  });
});

describe("diagnostic exploration health", () => {
  const rows = (acquired: number, adherence: number, coverage: number, users = 10) =>
    Array.from({ length: 30 }, (_, index) => ({
      user_id: `user_${index % users}`,
      evidence_acquired_at: index < acquired ? "2026-08-24T00:00:00.000Z" : null,
      evidence_latency_hours: index < acquired ? 24 : null,
      followup_plan_adherence: adherence,
      coverage_rate: coverage,
    }));

  it("suppresses aggregate rates below the user threshold", () => {
    const health = buildInformationGainHealth(rows(25, 0.8, 0.8, 1));
    expect(health.status).toBe("collecting");
    expect(health.acquisition_rate).toBeNull();
  });

  it("supports an actionable exploration policy only when both guardrails hold", () => {
    const health = buildInformationGainHealth(rows(20, 0.7, 0.8));
    expect(health.status).toBe("supported");
    expect(health.acquisition_rate).toBeCloseTo(2 / 3, 3);
  });

  it("rejects high acquisition that sacrifices plan adherence", () => {
    expect(buildInformationGainHealth(rows(25, 0.4, 0.9)).status).toBe("rejected");
  });
});
