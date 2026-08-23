import { describe, expect, it } from "vitest";
import {
  buildModelHealth,
  type ModelHealthEvaluationRow,
  type ModelHealthOutcomeRow,
  type ModelHealthShadowRow,
  type ModelHealthStrategyRow,
} from "../src/worker/model-health";

function evaluationRows(input: { count: number; personalized: number; baseline: number; observed: number; users?: number }): ModelHealthEvaluationRow[] {
  return Array.from({ length: input.count }, (_, index) => ({
    user_id: `user_${index % (input.users ?? 5)}`,
    mode: index % 2 === 0 ? "normal" : "foundation",
    personalized_prediction: input.personalized,
    baseline_prediction: input.baseline,
    prediction_confidence: index % 2 === 0 ? 0.8 : 0.3,
    observed_score: input.observed,
    observed_at: `2026-08-${String((index % 20) + 1).padStart(2, "0")}T12:00:00.000Z`,
    user_attempt_count: index % 3 === 0 ? 3 : 25,
  }));
}

function shadowRows(input: { count: number; candidate: number; current: number; observed: number; users?: number }): ModelHealthShadowRow[] {
  return Array.from({ length: input.count }, (_, index) => ({
    user_id: `user_${index % (input.users ?? 5)}`,
    candidate_version: "candidate-v1",
    hypothesis_id: "H_TEST_CANDIDATE",
    candidate_label: "検証候補",
    candidate_prediction: input.candidate,
    current_prediction: input.current,
    observed_score: input.observed,
  }));
}

function outcomeRows(input: { top: number; lower: number; topAttempts: number; lowerAttempts: number; users?: number }): ModelHealthOutcomeRow[] {
  const users = input.users ?? 10;
  const makeRows = (count: number, attempts: number, rank: number, offset: number) =>
    Array.from({ length: count }, (_, index) => ({
      user_id: `user_${(index + offset) % users}`,
      rank_position: rank,
      recommendation_score: rank <= 3 ? 0.8 : 0.5,
      attempted_7d: index < attempts ? 1 : 0,
      latency_hours: index < attempts ? 24 + (index % 4) * 12 : null,
    }));
  return [
    ...makeRows(input.top, input.topAttempts, 1, 0),
    ...makeRows(input.lower, input.lowerAttempts, 5, 3),
  ];
}

function strategyRows(input: { count: number; uplift: number; users?: number; mode?: ModelHealthStrategyRow["recommended_mode"] }): ModelHealthStrategyRow[] {
  return Array.from({ length: input.count }, (_, index) => ({
    user_id: `strategy_user_${index % (input.users ?? 10)}`,
    recommended_mode: input.mode ?? "foundation",
    score_uplift: input.uplift,
  }));
}

describe("model health", () => {
  it("keeps the rollout healthy when personalized error beats the baseline", () => {
    const health = buildModelHealth(
      evaluationRows({ count: 50, personalized: 0.72, baseline: 0.4, observed: 0.75 }),
      { modelVersion: "recommendation-v4", totalExposures: 100, now: new Date("2026-08-23T00:00:00.000Z") },
    );
    expect(health.decision).toBe("healthy");
    expect(health.overview.personalized_mae).toBeCloseTo(0.03);
    expect(health.overview.baseline_mae).toBeCloseTo(0.35);
    expect(health.overview.observation_rate).toBe(0.5);
    expect(health.segments.length).toBeGreaterThan(0);
    expect(health.hypotheses.find((item) => item.id === "H2_BEATS_BASELINE")?.status).toBe("supported");
  });

  it("raises a halt candidate when the global regression crosses the stop line", () => {
    const health = buildModelHealth(
      evaluationRows({ count: 50, personalized: 0.3, baseline: 0.75, observed: 0.8 }),
      { modelVersion: "recommendation-v4", totalExposures: 50 },
    );
    expect(health.decision).toBe("halt_candidate");
    expect(health.overview.mae_improvement).toBeLessThan(-0.03);
    expect(health.hypotheses.find((item) => item.id === "H2_BEATS_BASELINE")?.status).toBe("rejected");
  });

  it("suppresses small cohorts and refuses an early model decision", () => {
    const health = buildModelHealth(
      evaluationRows({ count: 20, personalized: 0.7, baseline: 0.5, observed: 0.75, users: 4 }),
      { modelVersion: "recommendation-v4", totalExposures: 40 },
    );
    expect(health.decision).toBe("collecting");
    expect(health.segments).toHaveLength(0);
    expect(health.suppressed_segments).toBeGreaterThan(0);
  });

  it("does not treat repeated observations from one user as aggregate evidence", () => {
    const health = buildModelHealth(
      evaluationRows({ count: 50, personalized: 0.72, baseline: 0.4, observed: 0.75, users: 1 }),
      { modelVersion: "recommendation-v4", totalExposures: 50 },
    );
    expect(health.decision).toBe("collecting");
    expect(health.segments).toHaveLength(0);
    expect(health.hypotheses.find((item) => item.id === "H2_BEATS_BASELINE")?.status).toBe("collecting");
    expect(health.hypotheses.find((item) => item.id === "H3_CONFIDENCE_IS_MEANINGFUL")?.status).toBe("collecting");
  });

  it("supports a shadow candidate only after a paired 50-observation, 5-user comparison", () => {
    const health = buildModelHealth(
      evaluationRows({ count: 50, personalized: 0.7, baseline: 0.4, observed: 0.75 }),
      {
        modelVersion: "recommendation-v4",
        totalExposures: 50,
        shadowRows: shadowRows({ count: 50, candidate: 0.74, current: 0.7, observed: 0.75 }),
      },
    );
    const candidate = health.shadow_candidates.find((item) => item.candidate_version === "candidate-v1");
    expect(candidate?.status).toBe("supported");
    expect(candidate?.mae_improvement).toBeCloseTo(0.04);
    expect(candidate?.candidate_brier).toBeLessThan(candidate?.current_brier ?? 0);
    expect(health.hypotheses.find((item) => item.id === "H_TEST_CANDIDATE")?.status).toBe("supported");
  });

  it("hides shadow candidate error metrics for a single-user cohort", () => {
    const health = buildModelHealth(
      [],
      {
        modelVersion: "recommendation-v4",
        totalExposures: 50,
        shadowRows: shadowRows({ count: 50, candidate: 0.74, current: 0.7, observed: 0.75, users: 1 }),
      },
    );
    const candidate = health.shadow_candidates.find((item) => item.candidate_version === "candidate-v1");
    expect(candidate?.status).toBe("collecting");
    expect(candidate?.candidate_mae).toBeNull();
    expect(candidate?.mae_improvement).toBeNull();
  });

  it("supports actionable top ranks using only mature seven-day outcome rows", () => {
    const health = buildModelHealth([], {
      modelVersion: "recommendation-v4",
      totalExposures: 120,
      outcomeRows: outcomeRows({ top: 60, lower: 60, topAttempts: 36, lowerAttempts: 12 }),
    });
    expect(health.recommendation_effectiveness.conversion_rate_7d).toBe(0.4);
    expect(health.recommendation_effectiveness.median_latency_hours).not.toBeNull();
    expect(health.recommendation_effectiveness.rank_bands.find((band) => band.id === "top-3")?.conversion_rate_7d).toBe(0.6);
    expect(health.hypotheses.find((item) => item.id === "H7_TOP_RANKS_ARE_ACTIONABLE")?.status).toBe("supported");
    expect(health.hypotheses.find((item) => item.id === "H8_RECOMMENDATIONS_DRIVE_PRACTICE")?.status).toBe("supported");
  });

  it("does not reveal effectiveness metrics for a one-user cohort", () => {
    const health = buildModelHealth([], {
      modelVersion: "recommendation-v4",
      totalExposures: 120,
      outcomeRows: outcomeRows({ top: 60, lower: 60, topAttempts: 36, lowerAttempts: 12, users: 1 }),
    });
    expect(health.recommendation_effectiveness.attempted_7d).toBeNull();
    expect(health.recommendation_effectiveness.conversion_rate_7d).toBeNull();
    expect(health.recommendation_effectiveness.rank_bands.every((band) => band.conversion_rate_7d === null)).toBe(true);
  });

  it("supports the personal strategy hypothesis after 30 completed experiments from 10 users", () => {
    const health = buildModelHealth([], {
      modelVersion: "recommendation-v4",
      totalExposures: 0,
      strategyRows: strategyRows({ count: 30, uplift: 0.08 }),
    });
    expect(health.strategy_effectiveness.average_uplift).toBe(0.08);
    expect(health.strategy_effectiveness.improvement_rate).toBe(1);
    expect(health.strategy_effectiveness.by_mode.find((mode) => mode.mode === "foundation")?.status).toBe("supported");
    expect(health.hypotheses.find((item) => item.id === "H9_PERSONAL_STRATEGY_IMPROVES_SCORE")?.status).toBe("supported");
  });

  it("suppresses personal strategy effect sizes for a one-user cohort", () => {
    const health = buildModelHealth([], {
      modelVersion: "recommendation-v4",
      totalExposures: 0,
      strategyRows: strategyRows({ count: 30, uplift: 0.08, users: 1 }),
    });
    expect(health.strategy_effectiveness.average_uplift).toBeNull();
    expect(health.strategy_effectiveness.improvement_rate).toBeNull();
    expect(health.strategy_effectiveness.by_mode.every((mode) => mode.average_uplift === null)).toBe(true);
    expect(health.hypotheses.find((item) => item.id === "H9_PERSONAL_STRATEGY_IMPROVES_SCORE")?.status).toBe("collecting");
  });

  it("adds the schedule consolidation hypothesis after privacy thresholds are met", () => {
    const scheduleRows = Array.from({ length: 30 }, (_, index) => ({
      user_id: `schedule_user_${index % 10}`,
      adherence_uplift: 0.15,
    }));
    const health = buildModelHealth([], {
      modelVersion: "recommendation-v4",
      totalExposures: 0,
      scheduleAdaptationRows: scheduleRows,
    });
    expect(health.schedule_adaptation_effectiveness.status).toBe("supported");
    expect(health.hypotheses.find((item) => item.id === "P9_SCHEDULE_CONSOLIDATION")?.status).toBe("supported");
  });
});
