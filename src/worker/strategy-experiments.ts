import type { PersonalAnalytics } from "./analytics";

const JST_OFFSET_MS = 9 * 60 * 60 * 1_000;
const DAY_MS = 86_400_000;

export interface StrategyExperimentRow {
  id: string;
  recommended_mode: PersonalAnalytics["strategy"]["recommended_mode"];
  strategy_confidence: PersonalAnalytics["strategy"]["confidence"];
  baseline_score: number | null;
  accepted_at: string | null;
  matched_attempt_count: number;
  followup_score: number | null;
  score_uplift: number | null;
  completed_at: string | null;
  cancelled_at: string | null;
}

export interface StrategyEvaluation {
  experiment_id: string;
  recommended_mode: PersonalAnalytics["strategy"]["recommended_mode"];
  status: "in_progress" | "improving" | "neutral" | "regressing";
  matched_attempt_count: number;
  required_attempts: number;
  baseline_score: number | null;
  followup_score: number | null;
  score_uplift: number | null;
  accepted_at: string;
  completed_at: string | null;
  message: string;
}

export function evaluateStrategyOutcome(baselineScore: number | null, followupScores: number[]) {
  const boundedScores = followupScores.slice(0, 3).filter((score) => Number.isFinite(score) && score >= 0 && score <= 1);
  const followupScore = boundedScores.length === 0
    ? null
    : boundedScores.reduce((sum, score) => sum + score, 0) / boundedScores.length;
  const scoreUplift = baselineScore === null || followupScore === null ? null : followupScore - baselineScore;
  return { matchedAttemptCount: boundedScores.length, followupScore, scoreUplift };
}

export function strategyEvaluation(row: StrategyExperimentRow | null): StrategyEvaluation | null {
  if (!row?.accepted_at || row.cancelled_at) return null;
  let status: StrategyEvaluation["status"] = "in_progress";
  let message = `提案モードであと${Math.max(0, 3 - row.matched_attempt_count)}問解くと、直前3問と比較できます。`;
  if (row.completed_at) {
    if ((row.score_uplift ?? 0) >= 0.05) {
      status = "improving";
      message = "提案後3問の達成度が直前3問より改善しました。";
    } else if ((row.score_uplift ?? 0) <= -0.05) {
      status = "regressing";
      message = "提案後3問の達成度が低下しました。次の戦略では条件を見直します。";
    } else {
      status = "neutral";
      message = "提案前後の達成度差は小さく、別の条件でも検証が必要です。";
    }
    if (row.score_uplift === null) {
      status = "neutral";
      message = "比較前の記録が不足していたため、今回の3問を次回の基準にします。";
    }
  }
  return {
    experiment_id: row.id,
    recommended_mode: row.recommended_mode,
    status,
    matched_attempt_count: row.matched_attempt_count,
    required_attempts: 3,
    baseline_score: row.baseline_score,
    followup_score: row.followup_score,
    score_uplift: row.score_uplift,
    accepted_at: row.accepted_at,
    completed_at: row.completed_at,
    message,
  };
}

export async function recordStrategyExposure(
  db: D1Database,
  userId: string,
  analytics: PersonalAnalytics,
  baselineScore: number | null,
  now = new Date(),
): Promise<string> {
  const exposedAt = now.toISOString();
  const exposureDate = new Date(now.getTime() + JST_OFFSET_MS).toISOString().slice(0, 10);
  const strategyKey = JSON.stringify([
    analytics.strategy.recommended_mode,
    analytics.strategy.confidence,
    analytics.strategy.rationale,
  ]);
  await db.prepare("DELETE FROM learning_strategy_experiments WHERE user_id = ? AND exposed_at < datetime('now', '-400 days')")
    .bind(userId)
    .run();
  await db.prepare(
    `INSERT OR IGNORE INTO learning_strategy_experiments (
       id, user_id, analytics_model_version, strategy_key, recommended_mode,
       strategy_confidence, baseline_score, exposure_date, exposed_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    crypto.randomUUID(),
    userId,
    analytics.model.version,
    strategyKey,
    analytics.strategy.recommended_mode,
    analytics.strategy.confidence,
    baselineScore,
    exposureDate,
    exposedAt,
  ).run();
  const row = await db.prepare(
    `SELECT id FROM learning_strategy_experiments
     WHERE user_id = ? AND analytics_model_version = ? AND strategy_key = ? AND exposure_date = ?`,
  ).bind(userId, analytics.model.version, strategyKey, exposureDate).first<{ id: string }>();
  if (!row) throw new Error("Strategy exposure could not be recorded");
  return row.id;
}

export async function acceptStrategyExperiment(db: D1Database, userId: string, experimentId: string, now = new Date()): Promise<boolean> {
  const experiment = await db.prepare(
    `SELECT id, accepted_at, completed_at, cancelled_at FROM learning_strategy_experiments
     WHERE id = ? AND user_id = ?`,
  ).bind(experimentId, userId).first<{ id: string; accepted_at: string | null; completed_at: string | null; cancelled_at: string | null }>();
  if (!experiment || experiment.completed_at || experiment.cancelled_at) return false;
  if (experiment.accepted_at) return true;
  const acceptedAt = now.toISOString();
  await db.batch([
    db.prepare(
      `UPDATE learning_strategy_experiments SET cancelled_at = ?
       WHERE user_id = ? AND id <> ? AND accepted_at IS NOT NULL
         AND completed_at IS NULL AND cancelled_at IS NULL`,
    ).bind(acceptedAt, userId, experimentId),
    db.prepare(
      `UPDATE learning_strategy_experiments SET accepted_at = ?
       WHERE id = ? AND user_id = ? AND accepted_at IS NULL
         AND completed_at IS NULL AND cancelled_at IS NULL`,
    ).bind(acceptedAt, experimentId, userId),
  ]);
  return true;
}

export async function updateActiveStrategyOutcome(db: D1Database, userId: string, now = new Date()): Promise<void> {
  const experiment = await db.prepare(
    `SELECT id, recommended_mode, baseline_score, accepted_at
     FROM learning_strategy_experiments
     WHERE user_id = ? AND accepted_at IS NOT NULL
       AND completed_at IS NULL AND cancelled_at IS NULL
     ORDER BY accepted_at DESC LIMIT 1`,
  ).bind(userId).first<{ id: string; recommended_mode: string; baseline_score: number | null; accepted_at: string }>();
  if (!experiment) return;
  const attributionStart = new Date(Date.parse(experiment.accepted_at) - DAY_MS).toISOString();
  const { results } = await db.prepare(
    `SELECT a.id, a.score_rate
     FROM attempts a
     WHERE a.user_id = ? AND julianday(a.submitted_at) >= julianday(?)
       AND EXISTS (
         SELECT 1 FROM learning_model_predictions p
         WHERE p.user_id = a.user_id AND p.problem_id = a.problem_id AND p.mode = ?
           AND julianday(p.exposed_at) >= julianday(?) AND julianday(p.exposed_at) <= julianday(a.submitted_at)
       )
     ORDER BY a.submitted_at ASC, a.id ASC
     LIMIT 3`,
  ).bind(userId, experiment.accepted_at, experiment.recommended_mode, attributionStart).all<{ id: string; score_rate: number }>();
  const outcome = evaluateStrategyOutcome(experiment.baseline_score, results.map((row) => row.score_rate));
  const completed = outcome.matchedAttemptCount >= 3;
  await db.prepare(
    `UPDATE learning_strategy_experiments
     SET matched_attempt_count = ?, followup_score = ?, score_uplift = ?, completed_at = ?
     WHERE id = ? AND completed_at IS NULL AND cancelled_at IS NULL`,
  ).bind(
    outcome.matchedAttemptCount,
    completed ? outcome.followupScore : null,
    completed ? outcome.scoreUplift : null,
    completed ? now.toISOString() : null,
    experiment.id,
  ).run();
}

export async function latestStrategyEvaluation(db: D1Database, userId: string): Promise<StrategyEvaluation | null> {
  const row = await db.prepare(
    `SELECT id, recommended_mode, strategy_confidence, baseline_score, accepted_at,
            matched_attempt_count, followup_score, score_uplift, completed_at, cancelled_at
     FROM learning_strategy_experiments
     WHERE user_id = ? AND accepted_at IS NOT NULL AND cancelled_at IS NULL
     ORDER BY accepted_at DESC LIMIT 1`,
  ).bind(userId).first<StrategyExperimentRow>();
  return strategyEvaluation(row ?? null);
}
