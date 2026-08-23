import { describe, expect, it } from "vitest";
import { buildPersonalAnalytics, conservativeMastery, masteryConfidence } from "../src/worker/analytics";

const now = new Date("2026-08-23T12:00:00.000Z");

describe("personal learning analytics", () => {
  it("raises confidence with repeated fresh evidence and uses a conservative lower estimate", () => {
    const weak = masteryConfidence(1, "2026-08-22T12:00:00.000Z", now);
    const strong = masteryConfidence(10, "2026-08-22T12:00:00.000Z", now);
    expect(strong).toBeGreaterThan(weak);
    expect(conservativeMastery(0.8, 1, "2026-08-22T12:00:00.000Z", now)).toBeLessThan(0.8);
    expect(conservativeMastery(0.8, 10, "2026-08-22T12:00:00.000Z", now)).toBeGreaterThan(0.7);
  });

  it("detects overconfidence and produces actionable, bounded analytics", () => {
    const analytics = buildPersonalAnalytics(
      [
        { id: "a1", score_rate: 0.2, result: "wrong", time_spent_minutes: 30, estimated_minutes: 20, self_confidence: 5, created_at: "2026-08-21T12:00:00.000Z" },
        { id: "a2", score_rate: 0.4, result: "partial", time_spent_minutes: 20, estimated_minutes: 20, self_confidence: 5, created_at: "2026-08-22T12:00:00.000Z" },
        { id: "a3", score_rate: 0.3, result: "wrong", time_spent_minutes: 40, estimated_minutes: 20, self_confidence: 4, created_at: "2026-08-23T10:00:00.000Z" },
      ],
      [{ id: "c1", name_ja: "線形代数", mastery_score: 0.4, evidence_count: 3, last_attempted_at: "2026-08-23T10:00:00.000Z", review_due_at: null }],
      now,
    );

    expect(analytics.calibration.status).toBe("overconfident");
    expect(analytics.summary.current_streak_days).toBe(3);
    expect(analytics.summary.average_score).toBeCloseTo(0.3);
    expect(analytics.concepts[0].conservative_mastery).toBeGreaterThanOrEqual(0);
    expect(analytics.concepts[0].conservative_mastery).toBeLessThanOrEqual(1);
    expect(analytics.insights.some((insight) => insight.id === "calibration")).toBe(true);
    expect(analytics.model.hypotheses).toHaveLength(14);
    expect(analytics.model.hypotheses.some((hypothesis) => hypothesis.id === "P7_GOAL_READINESS")).toBe(true);
    expect(analytics.model.hypotheses.some((hypothesis) => hypothesis.id === "P8_PLAN_ADHERENCE")).toBe(true);
    expect(analytics.model.hypotheses.some((hypothesis) => hypothesis.id === "P9_SCHEDULE_CONSOLIDATION")).toBe(true);
    expect(analytics.model.hypotheses.some((hypothesis) => hypothesis.id === "P10_BOTTLENECK_FOCUS")).toBe(true);
    expect(analytics.model.hypotheses.some((hypothesis) => hypothesis.id === "P11_DIAGNOSTIC_EXPLORATION")).toBe(true);
    expect(analytics.model.hypotheses.some((hypothesis) => hypothesis.id === "P12_DIAGNOSTIC_ITEM_VALUE")).toBe(true);
    expect(analytics.model.hypotheses.some((hypothesis) => hypothesis.id === "P13_DIAGNOSTIC_CHOICE_COVERAGE")).toBe(true);
    expect(analytics.model.hypotheses.some((hypothesis) => hypothesis.id === "P22_CONTRADICTORY_EVIDENCE")).toBe(true);
    expect(analytics.model_quality.status).toBe("insufficient");
  });

  it("compares personalized predictions against a baseline only after enough outcomes", () => {
    const predictionEvaluations = Array.from({ length: 20 }, (_, index) => ({
      model_version: "recommendation-v4",
      personalized_prediction: 0.72,
      baseline_prediction: 0.4,
      prediction_confidence: 0.8,
      observed_score: 0.75,
      exposed_at: `2026-08-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`,
      observed_at: `2026-08-${String(index + 1).padStart(2, "0")}T01:00:00.000Z`,
    }));
    const analytics = buildPersonalAnalytics([], [], now, { predictionEvaluations });

    expect(analytics.model_quality.status).toBe("improving");
    expect(analytics.model_quality.sample_count).toBe(20);
    expect(analytics.model_quality.personalized_mae).toBeCloseTo(0.03);
    expect(analytics.model_quality.baseline_mae).toBeCloseTo(0.35);
    expect(analytics.model_quality.win_rate).toBe(1);
  });

  it("returns a useful cold-start state without inventing performance", () => {
    const analytics = buildPersonalAnalytics([], [], now);
    expect(analytics.summary.average_score).toBeNull();
    expect(analytics.calibration.status).toBe("insufficient");
    expect(analytics.insights[0].id).toBe("first-evidence");
    expect(analytics.diagnostics.retention.average_score_change).toBeNull();
    expect(analytics.strategy.recommended_mode).toBe("normal");
  });

  it("diagnoses retention, support dependence, and pacing from within-user comparisons", () => {
    const attempts = [
      { id: "p1a", problem_id: "p1", score_rate: 0.2, result: "wrong", time_spent_minutes: 10, estimated_minutes: 10, self_confidence: null, used_hint: 0, looked_solution: 0, created_at: "2026-08-01T12:00:00.000Z" },
      { id: "p2a", problem_id: "p2", score_rate: 0.3, result: "wrong", time_spent_minutes: 10, estimated_minutes: 10, self_confidence: null, used_hint: 0, looked_solution: 0, created_at: "2026-08-02T12:00:00.000Z" },
      { id: "p1b", problem_id: "p1", score_rate: 0.8, result: "correct", time_spent_minutes: 20, estimated_minutes: 10, self_confidence: null, used_hint: 1, looked_solution: 0, created_at: "2026-08-03T12:00:00.000Z" },
      { id: "p3a", problem_id: "p3", score_rate: 0.4, result: "partial", time_spent_minutes: 10, estimated_minutes: 10, self_confidence: null, used_hint: 0, looked_solution: 0, created_at: "2026-08-04T12:00:00.000Z" },
      { id: "p2b", problem_id: "p2", score_rate: 0.9, result: "correct", time_spent_minutes: 20, estimated_minutes: 10, self_confidence: null, used_hint: 0, looked_solution: 1, created_at: "2026-08-05T12:00:00.000Z" },
      { id: "p3b", problem_id: "p3", score_rate: 0.7, result: "correct", time_spent_minutes: 20, estimated_minutes: 10, self_confidence: null, used_hint: 1, looked_solution: 0, created_at: "2026-08-07T12:00:00.000Z" },
    ];
    const analytics = buildPersonalAnalytics(attempts, [], now);

    expect(analytics.diagnostics.retention.status).toBe("improving");
    expect(analytics.diagnostics.retention.sample_pairs).toBe(3);
    expect(analytics.diagnostics.retention.average_score_change).toBeCloseTo(0.5);
    expect(analytics.diagnostics.independence.status).toBe("support_dependent");
    expect(analytics.diagnostics.independence.assisted_gap).toBeCloseTo(0.5);
    expect(analytics.diagnostics.pacing.status).toBe("careful_working");
    expect(analytics.strategy.recommended_mode).toBe("foundation");
    expect(analytics.strategy.rationale).toContain("補助ありと補助なしの達成度差が大きい");
  });

  it("groups active days and streaks by Japan time", () => {
    const attempts = [
      { id: "j1", score_rate: 0.6, result: "partial", time_spent_minutes: 10, estimated_minutes: 10, self_confidence: null, created_at: "2026-08-22T15:30:00.000Z" },
      { id: "j2", score_rate: 0.7, result: "correct", time_spent_minutes: 10, estimated_minutes: 10, self_confidence: null, created_at: "2026-08-23T14:30:00.000Z" },
    ];
    const analytics = buildPersonalAnalytics(attempts, [], new Date("2026-08-23T15:30:00.000Z"));
    expect(analytics.summary.active_days).toBe(1);
    expect(analytics.summary.current_streak_days).toBe(1);
  });

  it("separates contradictory evidence from a simple weakness label", () => {
    const masteryEvidenceRows = [0.1, 0.9, 0.2].map((rawEvidence, index) => ({
      id: `e${index}`,
      concept_id: "c-logic",
      concept_name: "論理",
      problem_id: `p${index}`,
      problem_label: `論理問題${index + 1}`,
      difficulty: index + 1,
      raw_evidence: rawEvidence,
      previous_mastery: index === 0 ? null : 0.5,
      current_prediction: 0.5,
      created_at: `2026-08-${String(20 + index).padStart(2, "0")}T12:00:00.000Z`,
    }));
    const analytics = buildPersonalAnalytics([], [
      { id: "c-logic", name_ja: "論理", mastery_score: 0.4, evidence_count: 3, last_attempted_at: "2026-08-22T12:00:00.000Z", review_due_at: null },
    ], now, { masteryEvidenceRows });

    expect(analytics.mastery_evidence.concepts[0]).toMatchObject({ status: "contradictory", sample_count: 3, evidence_range: 0.8 });
    expect(analytics.insights[0]).toMatchObject({ id: "contradictory-evidence", title: "論理は追加確認が必要" });
    expect(analytics.strategy.recommended_mode).toBe("foundation");
    expect(analytics.strategy.rationale).toContain("論理の答案証拠が矛盾");
  });

  it("does not judge evidence consistency below three answers", () => {
    const masteryEvidenceRows = [0.1, 0.9].map((rawEvidence, index) => ({
      id: `small-${index}`,
      concept_id: "c-small",
      concept_name: "小標本",
      problem_id: `small-problem-${index}`,
      problem_label: `小標本問題${index + 1}`,
      difficulty: 3,
      raw_evidence: rawEvidence,
      previous_mastery: null,
      current_prediction: rawEvidence,
      created_at: `2026-08-2${index}T12:00:00.000Z`,
    }));
    const analytics = buildPersonalAnalytics([], [], now, { masteryEvidenceRows });
    expect(analytics.mastery_evidence.concepts[0].status).toBe("insufficient");
    expect(analytics.insights.some((insight) => insight.id === "contradictory-evidence")).toBe(false);
  });
});
