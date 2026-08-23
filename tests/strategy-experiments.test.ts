import { describe, expect, it } from "vitest";
import { evaluateStrategyOutcome, strategyEvaluation, updateActiveStrategyOutcome } from "../src/worker/strategy-experiments";

describe("personal strategy experiments", () => {
  it("compares exactly the first three matched attempts with the prior baseline", () => {
    const outcome = evaluateStrategyOutcome(0.5, [0.7, 0.8, 0.6, 0.1]);
    expect(outcome.matchedAttemptCount).toBe(3);
    expect(outcome.followupScore).toBeCloseTo(0.7);
    expect(outcome.scoreUplift).toBeCloseTo(0.2);
  });

  it("does not invent uplift without a prior baseline", () => {
    const outcome = evaluateStrategyOutcome(null, [0.7, 0.8, 0.6]);
    expect(outcome.followupScore).toBeCloseTo(0.7);
    expect(outcome.scoreUplift).toBeNull();
  });

  it("classifies completed and in-progress experiments", () => {
    const base = {
      id: "exp_1",
      recommended_mode: "foundation" as const,
      strategy_confidence: "medium" as const,
      baseline_score: 0.5,
      accepted_at: "2026-08-01T00:00:00.000Z",
      matched_attempt_count: 3,
      followup_score: 0.7,
      score_uplift: 0.2,
      completed_at: "2026-08-03T00:00:00.000Z",
      cancelled_at: null,
    };
    expect(strategyEvaluation(base)?.status).toBe("improving");
    expect(strategyEvaluation({ ...base, matched_attempt_count: 1, followup_score: null, score_uplift: null, completed_at: null })?.status).toBe("in_progress");
    expect(strategyEvaluation({ ...base, cancelled_at: "2026-08-02T00:00:00.000Z" })).toBeNull();
  });

  it("completes an accepted strategy from the first three attributed attempts", async () => {
    const updates: unknown[][] = [];
    const db = {
      prepare(sql: string) {
        return {
          bind(...values: unknown[]) {
            return {
              async first() {
                if (!sql.includes("ORDER BY accepted_at")) return null;
                return {
                  id: "exp_1",
                  recommended_mode: "foundation",
                  baseline_score: 0.5,
                  accepted_at: "2026-08-01T00:00:00.000Z",
                };
              },
              async all() {
                if (!sql.includes("FROM attempts")) return { results: [] };
                return { results: [
                  { id: "attempt_1", score_rate: 0.6 },
                  { id: "attempt_2", score_rate: 0.7 },
                  { id: "attempt_3", score_rate: 0.8 },
                ] };
              },
              async run() {
                if (sql.includes("UPDATE learning_strategy_experiments")) updates.push(values);
                return { success: true };
              },
            };
          },
        };
      },
    } as unknown as D1Database;
    await updateActiveStrategyOutcome(db, "usr_1", new Date("2026-08-03T00:00:00.000Z"));
    expect(updates).toHaveLength(1);
    expect(updates[0]?.[0]).toBe(3);
    expect(updates[0]?.[1]).toBeCloseTo(0.7);
    expect(updates[0]?.[2]).toBeCloseTo(0.2);
    expect(updates[0]?.[3]).toBe("2026-08-03T00:00:00.000Z");
    expect(updates[0]?.[4]).toBe("exp_1");
  });
});
