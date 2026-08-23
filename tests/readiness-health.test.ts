import { describe, expect, it } from "vitest";
import { buildReadinessHealth, pairReadinessSnapshots, type ReadinessHealthRow } from "../src/worker/readiness-health";

function pairedRows(input: { pairs: number; users: number; lowGain?: number; highGain?: number }): ReadinessHealthRow[] {
  const rows: ReadinessHealthRow[] = [];
  for (let index = 0; index < input.pairs; index += 1) {
    const high = index < input.pairs / 2;
    const gain = high ? (input.highGain ?? 0.2) : (input.lowGain ?? 0.02);
    const baselineKnowledge = 0.4;
    const outcomeKnowledge = baselineKnowledge + gain;
    rows.push(
      {
        user_id: `user_${index % input.users}`,
        goal_id: `goal_${index}`,
        snapshot_date: "2026-06-01",
        readiness_score: outcomeKnowledge - 0.01,
        knowledge_readiness: baselineKnowledge,
        plan_adherence: high ? 0.9 : 0.3,
      },
      {
        user_id: `user_${index % input.users}`,
        goal_id: `goal_${index}`,
        snapshot_date: "2026-06-29",
        readiness_score: outcomeKnowledge,
        knowledge_readiness: outcomeKnowledge,
        plan_adherence: high ? 0.9 : 0.3,
      },
    );
  }
  return rows;
}

describe("readiness model health", () => {
  it("uses one baseline per user-goal week and pairs the closest 28-day outcome", () => {
    const rows: ReadinessHealthRow[] = [
      { user_id: "user_1", goal_id: "goal_1", snapshot_date: "2026-06-01", readiness_score: 0.5, knowledge_readiness: 0.4, plan_adherence: 0.8 },
      { user_id: "user_1", goal_id: "goal_1", snapshot_date: "2026-06-02", readiness_score: 0.52, knowledge_readiness: 0.41, plan_adherence: 0.8 },
      { user_id: "user_1", goal_id: "goal_1", snapshot_date: "2026-06-28", readiness_score: 0.65, knowledge_readiness: 0.62, plan_adherence: 0.8 },
      { user_id: "user_1", goal_id: "goal_1", snapshot_date: "2026-06-29", readiness_score: 0.66, knowledge_readiness: 0.64, plan_adherence: 0.8 },
    ];
    const pairs = pairReadinessSnapshots(rows, new Date("2026-08-23T00:00:00.000Z"));
    expect(pairs).toHaveLength(1);
    expect(pairs[0]?.baselineKnowledge).toBe(0.4);
    expect(pairs[0]?.outcomeKnowledge).toBe(0.64);
  });

  it("supports forecast accuracy and adherence association only after aggregate thresholds", () => {
    const health = buildReadinessHealth(
      pairedRows({ pairs: 60, users: 20 }),
      new Date("2026-08-23T00:00:00.000Z"),
    );
    expect(health.paired_snapshots).toBe(60);
    expect(health.forecast_mae).toBeCloseTo(0.01);
    expect(health.knowledge_only_mae).toBeGreaterThan(health.forecast_mae ?? 1);
    expect(health.hypotheses.find((item) => item.id === "P7_GOAL_READINESS")?.status).toBe("supported");
    expect(health.adherence_association.gain_gap).toBeCloseTo(0.18);
    expect(health.hypotheses.find((item) => item.id === "P8_PLAN_ADHERENCE")?.status).toBe("supported");
  });

  it("suppresses metrics when repeated pairs come from one user", () => {
    const health = buildReadinessHealth(
      pairedRows({ pairs: 60, users: 1 }),
      new Date("2026-08-23T00:00:00.000Z"),
    );
    expect(health.forecast_mae).toBeNull();
    expect(health.mae_improvement).toBeNull();
    expect(health.adherence_association.gain_gap).toBeNull();
    expect(health.bands.every((band) => band.observed_knowledge === null)).toBe(true);
    expect(health.hypotheses.every((hypothesis) => hypothesis.status === "collecting")).toBe(true);
  });

  it("rejects a readiness forecast that is materially worse than current knowledge", () => {
    const rows = pairedRows({ pairs: 50, users: 10 }).map((row, index) => index % 2 === 0 ? { ...row, readiness_score: 0.05 } : row);
    const health = buildReadinessHealth(rows, new Date("2026-08-23T00:00:00.000Z"));
    expect(health.hypotheses.find((item) => item.id === "P7_GOAL_READINESS")?.status).toBe("rejected");
  });
});
