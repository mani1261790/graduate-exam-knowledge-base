const DAY_MS = 86_400_000;
const JST_OFFSET_MS = 9 * 60 * 60 * 1_000;

export const SCHEDULE_ADAPTATION_MODEL_VERSION = "schedule-adaptation-v1";

export interface ScheduleAdaptationProposal {
  current_sessions_per_week: number;
  current_minutes_per_session: number;
  proposed_sessions_per_week: number;
  proposed_minutes_per_session: number;
  weekly_minutes_before: number;
  weekly_minutes_after: number;
  rationale: string;
}

export interface ScheduleAdaptationView extends ScheduleAdaptationProposal {
  experiment_id: string;
  status: "proposal" | "monitoring" | "improving" | "neutral" | "regressing";
  baseline_plan_adherence: number;
  baseline_weekly_pace: number;
  baseline_due_sessions: number;
  followup_plan_adherence: number | null;
  followup_weekly_pace: number | null;
  followup_due_sessions: number | null;
  adherence_uplift: number | null;
  accepted_at: string | null;
  completed_at: string | null;
  message: string;
}

export interface ScheduleAdaptationHealthRow {
  user_id: string;
  adherence_uplift: number;
}

export interface ScheduleAdaptationHealth {
  completed_experiments: number;
  users: number;
  minimum_experiments: number;
  minimum_users: number;
  average_adherence_uplift: number | null;
  improvement_rate: number | null;
  status: "collecting" | "supported" | "neutral" | "rejected";
  hypothesis: {
    id: "P9_SCHEDULE_CONSOLIDATION";
    label: string;
    status: "collecting" | "supported" | "neutral" | "rejected";
    evidence: string;
  };
}

interface ExperimentRow {
  id: string;
  goal_id: string;
  baseline_sessions_per_week: number;
  baseline_minutes_per_session: number;
  proposed_sessions_per_week: number;
  proposed_minutes_per_session: number;
  baseline_plan_adherence: number;
  baseline_weekly_pace: number;
  baseline_due_sessions: number;
  followup_plan_adherence: number | null;
  followup_weekly_pace: number | null;
  followup_due_sessions: number | null;
  adherence_uplift: number | null;
  accepted_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
}

function round(value: number, digits = 3): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function roundUpToFive(value: number): number {
  return Math.ceil(value / 5) * 5;
}

export function buildScheduleAdaptationHealth(rows: ScheduleAdaptationHealthRow[]): ScheduleAdaptationHealth {
  const valid = rows.filter((row) => Number.isFinite(row.adherence_uplift)
    && row.adherence_uplift >= -1 && row.adherence_uplift <= 1);
  const users = new Set(valid.map((row) => row.user_id)).size;
  const minimumExperiments = 30;
  const minimumUsers = 10;
  const ready = valid.length >= minimumExperiments && users >= minimumUsers;
  const average = valid.length === 0 ? null : valid.reduce((sum, row) => sum + row.adherence_uplift, 0) / valid.length;
  const improvementRate = valid.length === 0 ? null : valid.filter((row) => row.adherence_uplift > 0).length / valid.length;
  const status: ScheduleAdaptationHealth["status"] = !ready || average === null
    ? "collecting"
    : average >= 0.1
      ? "supported"
      : average <= -0.1
        ? "rejected"
        : "neutral";
  return {
    completed_experiments: valid.length,
    users,
    minimum_experiments: minimumExperiments,
    minimum_users: minimumUsers,
    average_adherence_uplift: ready && average !== null ? round(average) : null,
    improvement_rate: ready && improvementRate !== null ? round(improvementRate) : null,
    status,
    hypothesis: {
      id: "P9_SCHEDULE_CONSOLIDATION",
      label: "週の総学習時間を保った日数再配分は14日後の計画遵守を改善する",
      status,
      evidence: ready && average !== null
        ? `${valid.length}件・${users}人 / 平均遵守変化 ${average >= 0 ? "+" : ""}${Math.round(average * 100)}pt`
        : `${valid.length}件 / ${users}人`,
    },
  };
}

function proposalKey(proposal: ScheduleAdaptationProposal): string {
  return JSON.stringify([
    proposal.current_sessions_per_week,
    proposal.current_minutes_per_session,
    proposal.proposed_sessions_per_week,
    proposal.proposed_minutes_per_session,
  ]);
}

export function buildScheduleAdaptation(input: {
  sessionsPerWeek: number;
  minutesPerSession: number;
  planAdherence: number | null;
  currentWeeklyPace: number;
  dueSessions: number;
  daysRemaining: number | null;
}): ScheduleAdaptationProposal | null {
  const sessions = Math.round(input.sessionsPerWeek);
  const minutes = Math.round(input.minutesPerSession);
  if (sessions < 3 || sessions > 7 || minutes < 15 || minutes > 180) return null;
  if (input.daysRemaining !== null && input.daysRemaining < 0) return null;
  if (input.dueSessions < 4 || input.planAdherence === null || input.planAdherence >= 0.6) return null;
  if (input.currentWeeklyPace >= sessions * 0.7) return null;

  const weeklyMinutes = sessions * minutes;
  const minimumSessionsForTime = Math.ceil(weeklyMinutes / 180);
  const sustainableSessions = Math.max(2, minimumSessionsForTime, Math.ceil(input.currentWeeklyPace) + 1);
  const proposedSessions = Math.min(sessions - 1, sustainableSessions);
  if (proposedSessions >= sessions) return null;
  const proposedMinutes = Math.min(180, Math.max(15, roundUpToFive(weeklyMinutes / proposedSessions)));
  const weeklyMinutesAfter = proposedSessions * proposedMinutes;
  if (weeklyMinutesAfter < weeklyMinutes) return null;

  return {
    current_sessions_per_week: sessions,
    current_minutes_per_session: minutes,
    proposed_sessions_per_week: proposedSessions,
    proposed_minutes_per_session: proposedMinutes,
    weekly_minutes_before: weeklyMinutes,
    weekly_minutes_after: weeklyMinutesAfter,
    rationale: `週${sessions}日を週${proposedSessions}日にまとめ、週の学習時間を維持したまま予定日とのずれを減らします。`,
  };
}

function experimentView(row: ExperimentRow): ScheduleAdaptationView | null {
  if (row.cancelled_at) return null;
  const proposal: ScheduleAdaptationProposal = {
    current_sessions_per_week: Number(row.baseline_sessions_per_week),
    current_minutes_per_session: Number(row.baseline_minutes_per_session),
    proposed_sessions_per_week: Number(row.proposed_sessions_per_week),
    proposed_minutes_per_session: Number(row.proposed_minutes_per_session),
    weekly_minutes_before: Number(row.baseline_sessions_per_week) * Number(row.baseline_minutes_per_session),
    weekly_minutes_after: Number(row.proposed_sessions_per_week) * Number(row.proposed_minutes_per_session),
    rationale: `週${row.baseline_sessions_per_week}日を週${row.proposed_sessions_per_week}日にまとめ、週の学習時間を維持したまま予定日とのずれを減らします。`,
  };
  let status: ScheduleAdaptationView["status"] = row.accepted_at ? "monitoring" : "proposal";
  let message = row.accepted_at
    ? "採用後14日間の予定日完了率を、採用前の計画遵守と比較します。"
    : "総学習時間は減らさず、学習する曜日をまとめる提案です。採用するまで目標は変わりません。";
  if (row.completed_at) {
    const uplift = row.adherence_uplift ?? 0;
    status = uplift >= 0.1 ? "improving" : uplift <= -0.1 ? "regressing" : "neutral";
    message = status === "improving"
      ? "再配分後14日間の計画遵守が改善しました。"
      : status === "regressing"
        ? "再配分後も計画遵守が低下しました。日数以外の負荷条件を見直します。"
        : "再配分前後の差は小さく、現在の設定を継続して観測します。";
  }
  return {
    experiment_id: row.id,
    ...proposal,
    status,
    baseline_plan_adherence: Number(row.baseline_plan_adherence),
    baseline_weekly_pace: Number(row.baseline_weekly_pace),
    baseline_due_sessions: Number(row.baseline_due_sessions),
    followup_plan_adherence: row.followup_plan_adherence == null ? null : Number(row.followup_plan_adherence),
    followup_weekly_pace: row.followup_weekly_pace == null ? null : Number(row.followup_weekly_pace),
    followup_due_sessions: row.followup_due_sessions == null ? null : Number(row.followup_due_sessions),
    adherence_uplift: row.adherence_uplift == null ? null : Number(row.adherence_uplift),
    accepted_at: row.accepted_at,
    completed_at: row.completed_at,
    message,
  };
}

export async function recordScheduleAdaptationExposure(
  db: D1Database,
  userId: string,
  goalId: string,
  proposal: ScheduleAdaptationProposal,
  baseline: { planAdherence: number; weeklyPace: number; dueSessions: number },
  now = new Date(),
): Promise<ScheduleAdaptationView> {
  const exposedAt = now.toISOString();
  const exposureDate = new Date(now.getTime() + JST_OFFSET_MS).toISOString().slice(0, 10);
  const key = proposalKey(proposal);
  await db.batch([
    db.prepare("DELETE FROM learning_schedule_adaptation_experiments WHERE user_id = ? AND exposed_at < datetime('now', '-400 days')")
      .bind(userId),
    db.prepare(
      `INSERT OR IGNORE INTO learning_schedule_adaptation_experiments (
         id, user_id, goal_id, model_version, proposal_key, exposure_date,
         baseline_sessions_per_week, baseline_minutes_per_session,
         proposed_sessions_per_week, proposed_minutes_per_session,
         baseline_plan_adherence, baseline_weekly_pace, baseline_due_sessions, exposed_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      crypto.randomUUID(), userId, goalId, SCHEDULE_ADAPTATION_MODEL_VERSION, key, exposureDate,
      proposal.current_sessions_per_week, proposal.current_minutes_per_session,
      proposal.proposed_sessions_per_week, proposal.proposed_minutes_per_session,
      baseline.planAdherence, baseline.weeklyPace, baseline.dueSessions, exposedAt,
    ),
  ]);
  const row = await db.prepare(
    `SELECT * FROM learning_schedule_adaptation_experiments
     WHERE user_id = ? AND goal_id = ? AND model_version = ? AND proposal_key = ? AND exposure_date = ?`,
  ).bind(userId, goalId, SCHEDULE_ADAPTATION_MODEL_VERSION, key, exposureDate).first<ExperimentRow>();
  const view = row ? experimentView(row) : null;
  if (!view) throw new Error("Schedule adaptation exposure could not be recorded");
  return view;
}

export async function latestScheduleAdaptation(db: D1Database, userId: string, now = new Date()): Promise<ScheduleAdaptationView | null> {
  const recentBoundary = new Date(now.getTime() - 30 * DAY_MS).toISOString();
  const row = await db.prepare(
    `SELECT * FROM learning_schedule_adaptation_experiments
     WHERE user_id = ? AND accepted_at IS NOT NULL AND cancelled_at IS NULL
       AND (completed_at IS NULL OR completed_at >= ?)
     ORDER BY accepted_at DESC LIMIT 1`,
  ).bind(userId, recentBoundary).first<ExperimentRow>();
  return row ? experimentView(row) : null;
}

export async function acceptScheduleAdaptation(
  db: D1Database,
  userId: string,
  experimentId: string,
  now = new Date(),
): Promise<{ sessionsPerWeek: number; minutesPerSession: number } | null> {
  const row = await db.prepare(
    `SELECT e.*, ug.sessions_per_week AS current_sessions, ug.minutes_per_session AS current_minutes, ug.is_active
     FROM learning_schedule_adaptation_experiments e
     JOIN user_goals ug ON ug.id = e.goal_id AND ug.user_id = e.user_id
     WHERE e.id = ? AND e.user_id = ?`,
  ).bind(experimentId, userId).first<ExperimentRow & { current_sessions: number; current_minutes: number; is_active: number }>();
  if (!row || row.cancelled_at || row.completed_at || !Number(row.is_active)) return null;
  if (row.accepted_at) {
    return { sessionsPerWeek: Number(row.proposed_sessions_per_week), minutesPerSession: Number(row.proposed_minutes_per_session) };
  }
  if (Number(row.current_sessions) !== Number(row.baseline_sessions_per_week)
    || Number(row.current_minutes) !== Number(row.baseline_minutes_per_session)) return null;
  const acceptedAt = now.toISOString();
  await db.batch([
    db.prepare(
      `UPDATE learning_schedule_adaptation_experiments SET cancelled_at = ?
       WHERE user_id = ? AND id <> ? AND accepted_at IS NOT NULL
         AND completed_at IS NULL AND cancelled_at IS NULL`,
    ).bind(acceptedAt, userId, experimentId),
    db.prepare(
      `UPDATE learning_schedule_adaptation_experiments SET accepted_at = ?
       WHERE id = ? AND user_id = ? AND accepted_at IS NULL AND cancelled_at IS NULL`,
    ).bind(acceptedAt, experimentId, userId),
    db.prepare(
      `UPDATE user_goals SET sessions_per_week = ?, minutes_per_session = ?, updated_at = ?
       WHERE id = ? AND user_id = ? AND is_active = 1
         AND sessions_per_week = ? AND minutes_per_session = ?`,
    ).bind(
      row.proposed_sessions_per_week, row.proposed_minutes_per_session, acceptedAt,
      row.goal_id, userId,
      row.baseline_sessions_per_week, row.baseline_minutes_per_session,
    ),
  ]);
  return { sessionsPerWeek: Number(row.proposed_sessions_per_week), minutesPerSession: Number(row.proposed_minutes_per_session) };
}

export async function updateScheduleAdaptationOutcome(db: D1Database, userId: string, now = new Date()): Promise<void> {
  const row = await db.prepare(
    `SELECT * FROM learning_schedule_adaptation_experiments
     WHERE user_id = ? AND accepted_at IS NOT NULL AND completed_at IS NULL AND cancelled_at IS NULL
     ORDER BY accepted_at DESC LIMIT 1`,
  ).bind(userId).first<ExperimentRow & { goal_id: string }>();
  if (!row?.accepted_at) return;
  const acceptedMs = Date.parse(row.accepted_at);
  const elapsedDays = (now.getTime() - acceptedMs) / DAY_MS;
  if (!Number.isFinite(elapsedDays) || elapsedDays < 14) return;
  const endAt = now.toISOString();
  const sessions = await db.prepare(
    `WITH daily AS (
       SELECT spi.scheduled_date,
              MIN(CASE WHEN spi.status = 'completed' THEN 1 ELSE 0 END) AS completed
       FROM study_plan_items spi
       JOIN study_plans sp ON sp.id = spi.plan_id
       WHERE sp.user_id = ? AND sp.goal_id = ?
         AND spi.scheduled_date >= date(?, '+9 hours') AND spi.scheduled_date < date(?, '+9 hours')
       GROUP BY spi.scheduled_date
     )
     SELECT COUNT(*) AS due_sessions, COALESCE(SUM(completed), 0) AS completed_sessions FROM daily`,
  ).bind(userId, row.goal_id, row.accepted_at, endAt).first<{ due_sessions: number; completed_sessions: number }>();
  const dueSessions = Number(sessions?.due_sessions ?? 0);
  if (dueSessions < 4) return;
  const planAdherence = Number(sessions?.completed_sessions ?? 0) / dueSessions;
  const attemptDays = await db.prepare(
    `SELECT COUNT(DISTINCT date(created_at, '+9 hours')) AS active_days
     FROM attempts WHERE user_id = ? AND created_at >= ? AND created_at < ?`,
  ).bind(userId, row.accepted_at, endAt).first<{ active_days: number }>();
  const weeklyPace = Number(attemptDays?.active_days ?? 0) / Math.max(2, elapsedDays / 7);
  await db.prepare(
    `UPDATE learning_schedule_adaptation_experiments
     SET followup_plan_adherence = ?, followup_weekly_pace = ?, followup_due_sessions = ?,
         adherence_uplift = ?, completed_at = ?
     WHERE id = ? AND completed_at IS NULL AND cancelled_at IS NULL`,
  ).bind(
    round(planAdherence), round(weeklyPace, 1), dueSessions,
    round(planAdherence - Number(row.baseline_plan_adherence)), endAt, row.id,
  ).run();
}
