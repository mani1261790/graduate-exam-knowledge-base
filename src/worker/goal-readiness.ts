import { conservativeMastery, masteryConfidence } from "./analytics";
import { clamp } from "./json";

const DAY_MS = 86_400_000;
const JST_OFFSET_MS = 9 * 60 * 60 * 1_000;

export const GOAL_READINESS_MODEL_VERSION = "goal-readiness-v2";

export interface ReadinessGoal {
  id: string;
  goal_text: string;
  target_university: string | null;
  target_graduate_school: string | null;
  target_department: string | null;
  target_date: string | null;
  sessions_per_week: number;
}

export interface ReadinessConcept {
  id: string;
  name_ja: string;
  mastery_score: number | null;
  evidence_count: number;
  last_attempted_at: string | null;
  weight: number;
}

export interface ReadinessPlanItem {
  scheduled_date: string;
  status: "pending" | "completed" | "skipped";
  superseded_at: string | null;
}

export interface ReadinessAttempt {
  created_at: string;
}

export interface GoalReadinessHistoryPoint {
  snapshot_date: string;
  readiness_score: number;
  lower_bound: number;
  upper_bound: number;
  status: GoalReadiness["status"];
}

export interface GoalReadiness {
  model_version: typeof GOAL_READINESS_MODEL_VERSION;
  goal_id: string | null;
  goal_label: string | null;
  target_date: string | null;
  days_remaining: number | null;
  status: "no_goal" | "collecting" | "progressing" | "on_track" | "at_risk" | "target_passed";
  readiness_score: number | null;
  lower_bound: number | null;
  upper_bound: number | null;
  knowledge_readiness: number | null;
  evidence_coverage: number | null;
  target_concepts: number;
  sufficiently_observed_concepts: number;
  plan_adherence: number | null;
  due_plan_sessions: number;
  completed_due_sessions: number;
  overdue_sessions: number;
  upcoming_sessions_7d: number;
  current_weekly_pace: number;
  required_weekly_pace: number;
  pace_attainment: number;
  message: string;
  action: string;
  history: GoalReadinessHistoryPoint[];
}

function round(value: number, digits = 3): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function jstDay(date: Date): string {
  return new Date(date.getTime() + JST_OFFSET_MS).toISOString().slice(0, 10);
}

function goalLabel(goal: ReadinessGoal): string {
  return goal.target_department
    ?? goal.target_graduate_school
    ?? goal.target_university
    ?? goal.goal_text;
}

function weightedMean(rows: Array<{ value: number; weight: number }>): number | null {
  const valid = rows.filter((row) => Number.isFinite(row.value) && Number.isFinite(row.weight) && row.weight > 0);
  if (valid.length === 0) return null;
  const weight = valid.reduce((sum, row) => sum + row.weight, 0);
  return valid.reduce((sum, row) => sum + row.value * row.weight, 0) / weight;
}

export function buildGoalReadiness(input: {
  goal: ReadinessGoal | null;
  concepts: ReadinessConcept[];
  planItems: ReadinessPlanItem[];
  attempts: ReadinessAttempt[];
  now?: Date;
}): GoalReadiness {
  const now = input.now ?? new Date();
  if (!input.goal) {
    return {
      model_version: GOAL_READINESS_MODEL_VERSION,
      goal_id: null,
      goal_label: null,
      target_date: null,
      days_remaining: null,
      status: "no_goal",
      readiness_score: null,
      lower_bound: null,
      upper_bound: null,
      knowledge_readiness: null,
      evidence_coverage: null,
      target_concepts: 0,
      sufficiently_observed_concepts: 0,
      plan_adherence: null,
      due_plan_sessions: 0,
      completed_due_sessions: 0,
      overdue_sessions: 0,
      upcoming_sessions_7d: 0,
      current_weekly_pace: 0,
      required_weekly_pace: 0,
      pace_attainment: 0,
      message: "目標を設定すると、残り期間と学習証拠から準備度を推定できます。",
      action: "学習計画で志望先と目標日を設定する",
      history: [],
    };
  }

  const today = jstDay(now);
  const targetMs = input.goal.target_date ? Date.parse(`${input.goal.target_date}T00:00:00+09:00`) : Number.NaN;
  const todayMs = Date.parse(`${today}T00:00:00+09:00`);
  const daysRemaining = Number.isFinite(targetMs) ? Math.ceil((targetMs - todayMs) / DAY_MS) : null;

  const concepts = input.concepts.map((concept) => {
    // Missing evidence is uncertainty, not proof of zero mastery. Start from a
    // neutral prior and let the conservative bound express the uncertainty.
    const raw = clamp(concept.mastery_score ?? 0.5, 0, 1);
    const confidence = masteryConfidence(concept.evidence_count, concept.last_attempted_at, now);
    return {
      ...concept,
      raw,
      confidence,
      conservative: conservativeMastery(raw, concept.evidence_count, concept.last_attempted_at, now),
    };
  });
  const knowledge = weightedMean(concepts.map((concept) => ({ value: concept.conservative, weight: concept.weight })));
  const rawKnowledge = weightedMean(concepts.map((concept) => ({ value: concept.raw, weight: concept.weight })));
  const totalWeight = concepts.reduce((sum, concept) => sum + Math.max(0, concept.weight), 0);
  const observedWeight = concepts.filter((concept) => concept.evidence_count >= 3)
    .reduce((sum, concept) => sum + Math.max(0, concept.weight), 0);
  const evidenceCoverage = totalWeight === 0 ? null : observedWeight / totalWeight;
  const sufficientlyObserved = concepts.filter((concept) => concept.evidence_count >= 3).length;

  // A user chooses study *days* per week, while a generated session can contain
  // several problems. Give each scheduled day equal weight so a three-problem
  // session does not count as three times the commitment of a concept session.
  const sessions = new Map<string, ReadinessPlanItem[]>();
  for (const item of input.planItems) {
    const rows = sessions.get(item.scheduled_date) ?? [];
    rows.push(item);
    sessions.set(item.scheduled_date, rows);
  }
  const maturedSessions = [...sessions.entries()].filter(([day, items]) =>
    day < today || (day === today && items.some((item) => item.status === "completed")),
  );
  const completedDueSessions = maturedSessions.filter(([, items]) =>
    items.length > 0 && items.every((item) => item.status === "completed"),
  ).length;
  const overdueSessions = maturedSessions.length - completedDueSessions;
  const planAdherence = maturedSessions.length === 0 ? null : completedDueSessions / maturedSessions.length;
  const nextWeek = jstDay(new Date(now.getTime() + 7 * DAY_MS));
  const upcomingSessions = new Set(input.planItems
    .filter((item) => item.status === "pending" && item.superseded_at === null
      && item.scheduled_date >= today && item.scheduled_date <= nextWeek)
    .map((item) => item.scheduled_date));

  const recentStart = now.getTime() - 28 * DAY_MS;
  const recentAttemptDays = new Set(input.attempts.filter((attempt) => {
    const value = Date.parse(attempt.created_at);
    return Number.isFinite(value) && value >= recentStart && value <= now.getTime();
  }).map((attempt) => jstDay(new Date(attempt.created_at))));
  const currentWeeklyPace = recentAttemptDays.size / 4;
  const requiredWeeklyPace = Math.max(1, input.goal.sessions_per_week);
  const paceAttainment = clamp(currentWeeklyPace / requiredWeeklyPace, 0, 1);

  const supportingFactors = [
    { value: paceAttainment, weight: 0.2 },
    ...(planAdherence === null ? [] : [{ value: planAdherence, weight: 0.15 }]),
  ];
  const readiness = knowledge === null
    ? null
    : weightedMean([{ value: knowledge, weight: 0.65 }, ...supportingFactors]);
  const upperReadiness = rawKnowledge === null
    ? null
    : weightedMean([{ value: rawKnowledge, weight: 0.65 }, ...supportingFactors]);

  let status: GoalReadiness["status"] = "progressing";
  let message = "目標に向けた証拠は増えています。現在のペースと未観測分野を継続して確認します。";
  let action = overdueSessions > 0 ? `期限を過ぎた${overdueSessions}日分から着手する` : "次の計画項目を予定日に進める";
  const collecting = concepts.length < 3 || evidenceCoverage === null || evidenceCoverage < 0.3;
  if (daysRemaining !== null && daysRemaining < 0) {
    status = "target_passed";
    message = "設定した目標日を過ぎています。結果を振り返り、次の目標日を設定してください。";
    action = "学習計画で目標日を更新する";
  } else if (collecting) {
    status = "collecting";
    message = `対象${concepts.length}分野のうち、十分な証拠があるのは${sufficientlyObserved}分野です。`;
    action = "証拠の少ない対象分野を1問ずつ確認する";
  } else if (
    readiness !== null
    && daysRemaining !== null
    && daysRemaining <= 60
    && (readiness < 0.5 || paceAttainment < 0.7 || (planAdherence !== null && planAdherence < 0.6))
  ) {
    status = "at_risk";
    message = "残り期間に対して、準備度または学習ペースが目標を下回っています。";
    action = overdueSessions > 0 ? `期限超過${overdueSessions}日分を今週の計画へ戻す` : "今週の学習日を1日増やす";
  } else if (readiness !== null && readiness >= 0.65 && paceAttainment >= 0.8 && (planAdherence === null || planAdherence >= 0.7)) {
    status = "on_track";
    message = "現在の証拠と学習ペースは目標に対して安定しています。";
    action = "弱い分野を維持しながら発展問題で転移を確認する";
  }

  return {
    model_version: GOAL_READINESS_MODEL_VERSION,
    goal_id: input.goal.id,
    goal_label: goalLabel(input.goal),
    target_date: input.goal.target_date,
    days_remaining: daysRemaining,
    status,
    readiness_score: readiness === null ? null : round(readiness),
    lower_bound: readiness === null ? null : round(readiness),
    upper_bound: upperReadiness === null ? null : round(Math.max(readiness ?? 0, upperReadiness)),
    knowledge_readiness: knowledge === null ? null : round(knowledge),
    evidence_coverage: evidenceCoverage === null ? null : round(evidenceCoverage),
    target_concepts: concepts.length,
    sufficiently_observed_concepts: sufficientlyObserved,
    plan_adherence: planAdherence === null ? null : round(planAdherence),
    due_plan_sessions: maturedSessions.length,
    completed_due_sessions: completedDueSessions,
    overdue_sessions: overdueSessions,
    upcoming_sessions_7d: upcomingSessions.size,
    current_weekly_pace: round(currentWeeklyPace, 1),
    required_weekly_pace: requiredWeeklyPace,
    pace_attainment: round(paceAttainment),
    message,
    action,
    history: [],
  };
}

export async function recordGoalReadinessSnapshot(db: D1Database, userId: string, readiness: GoalReadiness, now = new Date()): Promise<void> {
  if (!readiness.goal_id || readiness.readiness_score === null || readiness.lower_bound === null || readiness.upper_bound === null) return;
  const snapshotDate = jstDay(now);
  await db.prepare("DELETE FROM learning_readiness_snapshots WHERE user_id = ? AND recorded_at < datetime('now', '-400 days')")
    .bind(userId)
    .run();
  await db.prepare(
    `INSERT INTO learning_readiness_snapshots (
       id, user_id, goal_id, model_version, snapshot_date, target_date, status,
       readiness_score, lower_bound, upper_bound, knowledge_readiness,
       evidence_coverage, plan_adherence, weekly_pace, required_weekly_pace, recorded_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, goal_id, model_version, snapshot_date) DO UPDATE SET
       target_date = excluded.target_date,
       status = excluded.status,
       readiness_score = excluded.readiness_score,
       lower_bound = excluded.lower_bound,
       upper_bound = excluded.upper_bound,
       knowledge_readiness = excluded.knowledge_readiness,
       evidence_coverage = excluded.evidence_coverage,
       plan_adherence = excluded.plan_adherence,
       weekly_pace = excluded.weekly_pace,
       required_weekly_pace = excluded.required_weekly_pace,
       recorded_at = excluded.recorded_at`,
  ).bind(
    crypto.randomUUID(),
    userId,
    readiness.goal_id,
    readiness.model_version,
    snapshotDate,
    readiness.target_date,
    readiness.status,
    readiness.readiness_score,
    readiness.lower_bound,
    readiness.upper_bound,
    readiness.knowledge_readiness,
    readiness.evidence_coverage,
    readiness.plan_adherence,
    readiness.current_weekly_pace,
    readiness.required_weekly_pace,
    now.toISOString(),
  ).run();
}

export async function loadGoalReadinessHistory(db: D1Database, userId: string, goalId: string): Promise<GoalReadinessHistoryPoint[]> {
  const { results } = await db.prepare(
    `SELECT snapshot_date, readiness_score, lower_bound, upper_bound, status
     FROM learning_readiness_snapshots
     WHERE user_id = ? AND goal_id = ? AND model_version = ?
       AND recorded_at >= datetime('now', '-180 days')
     ORDER BY snapshot_date ASC
     LIMIT 180`,
  ).bind(userId, goalId, GOAL_READINESS_MODEL_VERSION).all<GoalReadinessHistoryPoint>();
  return results;
}
