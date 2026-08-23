import { describe, expect, it } from "vitest";
import { buildGoalReadiness, type ReadinessConcept, type ReadinessGoal } from "../src/worker/goal-readiness";

const now = new Date("2026-08-23T03:00:00.000Z");

function goal(overrides: Partial<ReadinessGoal> = {}): ReadinessGoal {
  return {
    id: "goal_1",
    goal_text: "情報系大学院の入試準備",
    target_university: "テスト大学",
    target_graduate_school: null,
    target_department: null,
    target_date: "2026-10-01",
    sessions_per_week: 5,
    ...overrides,
  };
}

function concepts(input: { mastery: number; evidence: number; count?: number }): ReadinessConcept[] {
  return Array.from({ length: input.count ?? 4 }, (_, index) => ({
    id: `concept_${index}`,
    name_ja: `対象分野${index}`,
    mastery_score: input.mastery,
    evidence_count: input.evidence,
    last_attempted_at: "2026-08-22T03:00:00.000Z",
    weight: 1,
  }));
}

function recentAttempts(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    created_at: new Date(now.getTime() - index * 86_400_000).toISOString(),
  }));
}

describe("goal readiness", () => {
  it("does not invent readiness before a goal is configured", () => {
    const readiness = buildGoalReadiness({ goal: null, concepts: [], planItems: [], attempts: [], now });
    expect(readiness.status).toBe("no_goal");
    expect(readiness.readiness_score).toBeNull();
    expect(readiness.goal_id).toBeNull();
  });

  it("keeps the estimate in collecting state until target concepts have enough evidence", () => {
    const readiness = buildGoalReadiness({
      goal: goal(),
      concepts: concepts({ mastery: 0.8, evidence: 1 }),
      planItems: [],
      attempts: recentAttempts(20),
      now,
    });
    expect(readiness.status).toBe("collecting");
    expect(readiness.evidence_coverage).toBe(0);
    expect(readiness.lower_bound).toBeLessThan(readiness.upper_bound ?? 0);
  });

  it("treats an unobserved target concept as uncertainty rather than zero ability", () => {
    const unobserved = concepts({ mastery: 0.5, evidence: 0, count: 3 }).map((concept) => ({ ...concept, mastery_score: null }));
    const readiness = buildGoalReadiness({ goal: goal(), concepts: unobserved, planItems: [], attempts: [], now });
    expect(readiness.status).toBe("collecting");
    expect(readiness.knowledge_readiness).toBe(0.25);
    expect(readiness.readiness_score).toBeGreaterThan(0.15);
    expect(readiness.upper_bound).toBeGreaterThan(readiness.lower_bound ?? 1);
  });

  it("marks a well-observed goal on track when pace and plan adherence are sufficient", () => {
    const readiness = buildGoalReadiness({
      goal: goal({ target_date: "2026-12-01" }),
      concepts: concepts({ mastery: 0.82, evidence: 10 }),
      planItems: [
        { scheduled_date: "2026-08-20", status: "completed", superseded_at: null },
        { scheduled_date: "2026-08-21", status: "completed", superseded_at: null },
      ],
      attempts: recentAttempts(20),
      now,
    });
    expect(readiness.status).toBe("on_track");
    expect(readiness.plan_adherence).toBe(1);
    expect(readiness.pace_attainment).toBe(1);
    expect(readiness.readiness_score).toBeGreaterThanOrEqual(0.65);
  });

  it("flags a near target when pace, adherence, and knowledge are below the stop line", () => {
    const readiness = buildGoalReadiness({
      goal: goal({ target_date: "2026-09-15" }),
      concepts: concepts({ mastery: 0.42, evidence: 5 }),
      planItems: [
        { scheduled_date: "2026-08-20", status: "pending", superseded_at: "2026-08-22T03:00:00.000Z" },
        { scheduled_date: "2026-08-21", status: "skipped", superseded_at: null },
      ],
      attempts: recentAttempts(2),
      now,
    });
    expect(readiness.status).toBe("at_risk");
    expect(readiness.overdue_sessions).toBe(2);
    expect(readiness.plan_adherence).toBe(0);
    expect(readiness.action).toContain("期限超過");
  });

  it("keeps a superseded missed day in adherence after plan regeneration", () => {
    const readiness = buildGoalReadiness({
      goal: goal({ target_date: "2026-12-01" }),
      concepts: concepts({ mastery: 0.75, evidence: 8 }),
      planItems: [
        { scheduled_date: "2026-08-20", status: "pending", superseded_at: "2026-08-21T03:00:00.000Z" },
        { scheduled_date: "2026-08-21", status: "completed", superseded_at: null },
      ],
      attempts: recentAttempts(12),
      now,
    });
    expect(readiness.due_plan_sessions).toBe(2);
    expect(readiness.completed_due_sessions).toBe(1);
    expect(readiness.plan_adherence).toBe(0.5);
  });

  it("weights a multi-problem day as one planned session", () => {
    const readiness = buildGoalReadiness({
      goal: goal({ target_date: "2026-12-01" }),
      concepts: concepts({ mastery: 0.75, evidence: 8 }),
      planItems: [
        { scheduled_date: "2026-08-20", status: "completed", superseded_at: null },
        { scheduled_date: "2026-08-20", status: "completed", superseded_at: null },
        { scheduled_date: "2026-08-21", status: "pending", superseded_at: null },
      ],
      attempts: recentAttempts(12),
      now,
    });
    expect(readiness.due_plan_sessions).toBe(2);
    expect(readiness.completed_due_sessions).toBe(1);
    expect(readiness.plan_adherence).toBe(0.5);
  });

  it("counts distinct learning days rather than attempts as weekly pace", () => {
    const sameDayAttempts = Array.from({ length: 6 }, (_, index) => ({
      created_at: `2026-08-22T0${index}:00:00.000Z`,
    }));
    const readiness = buildGoalReadiness({
      goal: goal(),
      concepts: concepts({ mastery: 0.75, evidence: 8 }),
      planItems: [],
      attempts: sameDayAttempts,
      now,
    });
    expect(readiness.current_weekly_pace).toBe(0.3);
    expect(readiness.pace_attainment).toBe(0.05);
  });

  it("treats a passed target date as a review event, not a current forecast", () => {
    const readiness = buildGoalReadiness({
      goal: goal({ target_date: "2026-08-01" }),
      concepts: concepts({ mastery: 0.8, evidence: 10 }),
      planItems: [],
      attempts: recentAttempts(20),
      now,
    });
    expect(readiness.status).toBe("target_passed");
    expect(readiness.days_remaining).toBeLessThan(0);
  });
});
