import { describe, expect, it } from "vitest";
import { buildScheduleAdaptation, buildScheduleAdaptationHealth } from "../src/worker/schedule-adaptation";

describe("schedule adaptation", () => {
  it("consolidates low-adherence schedules without reducing weekly minutes", () => {
    const proposal = buildScheduleAdaptation({
      sessionsPerWeek: 5,
      minutesPerSession: 45,
      planAdherence: 0.4,
      currentWeeklyPace: 1.5,
      dueSessions: 8,
      daysRemaining: 60,
    });
    expect(proposal).toMatchObject({
      proposed_sessions_per_week: 3,
      proposed_minutes_per_session: 75,
      weekly_minutes_before: 225,
      weekly_minutes_after: 225,
    });
  });

  it("does not propose a change before four scheduled days mature", () => {
    expect(buildScheduleAdaptation({
      sessionsPerWeek: 5, minutesPerSession: 45, planAdherence: 0,
      currentWeeklyPace: 1, dueSessions: 3, daysRemaining: 60,
    })).toBeNull();
  });

  it("does not intervene when adherence or pace is already adequate", () => {
    expect(buildScheduleAdaptation({
      sessionsPerWeek: 5, minutesPerSession: 45, planAdherence: 0.8,
      currentWeeklyPace: 2, dueSessions: 8, daysRemaining: 60,
    })).toBeNull();
    expect(buildScheduleAdaptation({
      sessionsPerWeek: 5, minutesPerSession: 45, planAdherence: 0.4,
      currentWeeklyPace: 3.5, dueSessions: 8, daysRemaining: 60,
    })).toBeNull();
  });

  it("does not reduce a schedule whose weekly minutes require all current days", () => {
    expect(buildScheduleAdaptation({
      sessionsPerWeek: 7, minutesPerSession: 180, planAdherence: 0.2,
      currentWeeklyPace: 1, dueSessions: 10, daysRemaining: 60,
    })).toBeNull();
  });

  it("does not adapt expired goals or already minimal schedules", () => {
    expect(buildScheduleAdaptation({
      sessionsPerWeek: 2, minutesPerSession: 60, planAdherence: 0.2,
      currentWeeklyPace: 0.5, dueSessions: 8, daysRemaining: 60,
    })).toBeNull();
    expect(buildScheduleAdaptation({
      sessionsPerWeek: 5, minutesPerSession: 45, planAdherence: 0.2,
      currentWeeklyPace: 1, dueSessions: 8, daysRemaining: -1,
    })).toBeNull();
  });
});

describe("schedule adaptation health", () => {
  it("suppresses aggregate effects until both privacy thresholds are met", () => {
    const health = buildScheduleAdaptationHealth(Array.from({ length: 30 }, () => ({ user_id: "one", adherence_uplift: 0.2 })));
    expect(health.status).toBe("collecting");
    expect(health.average_adherence_uplift).toBeNull();
  });

  it("supports consolidation after 30 completed comparisons across 10 users", () => {
    const rows = Array.from({ length: 30 }, (_, index) => ({ user_id: `user_${index % 10}`, adherence_uplift: 0.15 }));
    const health = buildScheduleAdaptationHealth(rows);
    expect(health.status).toBe("supported");
    expect(health.average_adherence_uplift).toBe(0.15);
    expect(health.improvement_rate).toBe(1);
  });

  it("rejects a materially harmful schedule change", () => {
    const rows = Array.from({ length: 30 }, (_, index) => ({ user_id: `user_${index % 10}`, adherence_uplift: -0.2 }));
    expect(buildScheduleAdaptationHealth(rows).status).toBe("rejected");
  });
});
