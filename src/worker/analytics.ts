import { clamp } from "./json";
import type { DiagnosticItemView } from "./diagnostic-items";
import type { GoalReadiness } from "./goal-readiness";
import type { InformationGainView } from "./information-gain";
import type { PlanFocusView } from "./plan-focus";
import type { ScheduleAdaptationView } from "./schedule-adaptation";

export const ANALYTICS_MODEL_VERSION = "personal-learning-v3";

export interface AnalyticsAttempt {
  id: string;
  problem_id?: string;
  score_rate: number | null;
  result: string;
  time_spent_minutes: number | null;
  estimated_minutes: number;
  self_confidence: number | null;
  used_hint?: number;
  looked_solution?: number;
  created_at: string;
}

export interface AnalyticsConceptState {
  id: string;
  name_ja: string;
  mastery_score: number;
  evidence_count: number;
  last_attempted_at: string | null;
  review_due_at: string | null;
}

export interface ModelEvaluationRow {
  model_version: string;
  personalized_prediction: number;
  baseline_prediction: number;
  prediction_confidence: number;
  observed_score: number;
  exposed_at: string;
  observed_at: string;
}

export interface AnalyticsMasteryEvidenceRow {
  id: string;
  concept_id: string;
  concept_name: string;
  problem_id: string;
  problem_label: string;
  difficulty: number;
  raw_evidence: number;
  previous_mastery: number | null;
  current_prediction: number;
  created_at: string;
}

export interface PersonalAnalytics {
  model: {
    version: typeof ANALYTICS_MODEL_VERSION;
    generated_at: string;
    window_days: number;
    analyzed_attempts: number;
    available_attempts: number;
    truncated: boolean;
    hypotheses: Array<{ id: string; label: string; metric: string }>;
  };
  summary: {
    total_attempts: number;
    active_days: number;
    total_minutes: number;
    average_score: number | null;
    success_rate: number | null;
    pace_score: number | null;
    calibration_score: number | null;
    current_streak_days: number;
    evidence_strength: number;
  };
  calibration: {
    status: "insufficient" | "well_calibrated" | "overconfident" | "underconfident";
    sample_count: number;
    mean_confidence: number | null;
    mean_score: number | null;
    gap: number | null;
    message: string;
  };
  model_quality: {
    status: "insufficient" | "improving" | "neutral" | "regressing";
    sample_count: number;
    minimum_sample_size: number;
    personalized_mae: number | null;
    baseline_mae: number | null;
    mae_improvement: number | null;
    personalized_brier: number | null;
    baseline_brier: number | null;
    win_rate: number | null;
    message: string;
  };
  diagnostics: {
    retention: {
      status: "insufficient" | "improving" | "stable" | "declining";
      sample_pairs: number;
      minimum_pairs: number;
      average_score_change: number | null;
      median_interval_days: number | null;
      message: string;
    };
    independence: {
      status: "insufficient" | "balanced" | "support_dependent" | "independent_strong";
      independent_count: number;
      assisted_count: number;
      minimum_per_group: number;
      independent_score: number | null;
      assisted_score: number | null;
      assisted_gap: number | null;
      message: string;
    };
    pacing: {
      status: "insufficient" | "stable" | "overtime_cost" | "careful_working";
      on_time_count: number;
      overtime_count: number;
      minimum_per_group: number;
      on_time_score: number | null;
      overtime_score: number | null;
      on_time_advantage: number | null;
      message: string;
    };
  };
  strategy: {
    experiment_id: string | null;
    recommended_mode: "normal" | "review" | "foundation" | "challenge";
    confidence: "low" | "medium" | "high";
    title: string;
    rationale: string[];
    action: string;
  };
  strategy_evaluation: {
    experiment_id: string;
    recommended_mode: "normal" | "review" | "foundation" | "challenge";
    status: "in_progress" | "improving" | "neutral" | "regressing";
    matched_attempt_count: number;
    required_attempts: number;
    baseline_score: number | null;
    followup_score: number | null;
    score_uplift: number | null;
    accepted_at: string;
    completed_at: string | null;
    message: string;
  } | null;
  schedule_adaptation: ScheduleAdaptationView | null;
  plan_focus: PlanFocusView | null;
  information_gain: InformationGainView | null;
  diagnostic_item: DiagnosticItemView | null;
  goal_readiness: GoalReadiness | null;
  trends: Array<{
    week_start: string;
    attempts: number;
    minutes: number;
    average_score: number | null;
  }>;
  concepts: Array<AnalyticsConceptState & {
    confidence: number;
    conservative_mastery: number;
    needs_evidence: boolean;
  }>;
  mastery_evidence: {
    model_version: "mastery-evidence-explain-v1";
    recent: AnalyticsMasteryEvidenceRow[];
    concepts: Array<{
      concept_id: string;
      concept_name: string;
      sample_count: number;
      mean_evidence: number;
      evidence_stddev: number | null;
      evidence_range: number | null;
      status: "insufficient" | "stable" | "mixed" | "contradictory";
      message: string;
    }>;
  };
  insights: Array<{
    id: string;
    tone: "positive" | "attention" | "neutral";
    title: string;
    body: string;
    action: string;
  }>;
}

const DAY_MS = 86_400_000;
const JST_OFFSET_MS = 9 * 60 * 60 * 1_000;

function dateValue(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function round(value: number, digits = 3): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function masteryConfidence(evidenceCount: number, lastAttemptedAt: string | null, now = new Date()): number {
  if (evidenceCount <= 0) return 0;
  const evidence = 1 - Math.exp(-Math.max(0, evidenceCount) / 4);
  const lastAttempt = dateValue(lastAttemptedAt);
  const ageDays = lastAttempt === null ? 365 : Math.max(0, (now.getTime() - lastAttempt) / DAY_MS);
  const freshness = 0.65 + 0.35 * Math.exp(-ageDays / 120);
  return round(clamp(evidence * freshness, 0, 1));
}

export function conservativeMastery(
  mastery: number,
  evidenceCount: number,
  lastAttemptedAt: string | null,
  now = new Date(),
): number {
  const confidence = masteryConfidence(evidenceCount, lastAttemptedAt, now);
  return round(clamp(mastery - (1 - confidence) * 0.25, 0, 1));
}

function isoDate(value: string): string | null {
  const parsed = dateValue(value);
  return parsed === null ? null : new Date(parsed + JST_OFFSET_MS).toISOString().slice(0, 10);
}

function weekStart(value: string): string | null {
  const parsed = dateValue(value);
  if (parsed === null) return null;
  const date = new Date(parsed + JST_OFFSET_MS);
  const weekday = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - weekday);
  return date.toISOString().slice(0, 10);
}

function currentStreak(activeDates: Set<string>, now: Date): number {
  let streak = 0;
  const jstNow = new Date(now.getTime() + JST_OFFSET_MS);
  const cursor = new Date(Date.UTC(jstNow.getUTCFullYear(), jstNow.getUTCMonth(), jstNow.getUTCDate()));
  const today = cursor.toISOString().slice(0, 10);
  if (!activeDates.has(today)) cursor.setUTCDate(cursor.getUTCDate() - 1);
  while (activeDates.has(cursor.toISOString().slice(0, 10))) {
    streak += 1;
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return streak;
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

export function buildPersonalAnalytics(
  attempts: AnalyticsAttempt[],
  conceptStates: AnalyticsConceptState[],
  now = new Date(),
  options: { windowDays?: number; availableAttempts?: number; predictionEvaluations?: ModelEvaluationRow[]; masteryEvidenceRows?: AnalyticsMasteryEvidenceRow[] } = {},
): PersonalAnalytics {
  const windowDays = options.windowDays ?? 365;
  const availableAttempts = options.availableAttempts ?? attempts.length;
  const predictionEvaluations = options.predictionEvaluations ?? [];
  const masteryEvidenceRows = options.masteryEvidenceRows ?? [];
  const validScores = attempts.map((attempt) => attempt.score_rate).filter((score): score is number => typeof score === "number");
  const completed = attempts.filter((attempt) => attempt.result !== "skipped" && attempt.result !== "not_checked");
  const successful = completed.filter((attempt) => (attempt.score_rate ?? 0) >= 0.7);
  const totalMinutes = attempts.reduce((sum, attempt) => sum + Math.max(0, attempt.time_spent_minutes ?? 0), 0);
  const activeDates = new Set(attempts.map((attempt) => isoDate(attempt.created_at)).filter((value): value is string => Boolean(value)));
  const paceValues = attempts
    .filter((attempt) => attempt.time_spent_minutes !== null && attempt.time_spent_minutes > 0 && attempt.estimated_minutes > 0)
    .map((attempt) => clamp(attempt.estimated_minutes / Math.max(attempt.time_spent_minutes ?? 1, 1), 0, 1));

  const orderedAttempts = [...attempts].sort((left, right) => (dateValue(left.created_at) ?? 0) - (dateValue(right.created_at) ?? 0));
  const attemptsByProblem = new Map<string, AnalyticsAttempt[]>();
  for (const attempt of orderedAttempts) {
    if (!attempt.problem_id) continue;
    const problemAttempts = attemptsByProblem.get(attempt.problem_id) ?? [];
    problemAttempts.push(attempt);
    attemptsByProblem.set(attempt.problem_id, problemAttempts);
  }
  const retentionPairs: Array<{ change: number; intervalDays: number }> = [];
  for (const problemAttempts of attemptsByProblem.values()) {
    for (let index = 1; index < problemAttempts.length; index += 1) {
      const previous = problemAttempts[index - 1];
      const current = problemAttempts[index];
      if (previous.score_rate === null || current.score_rate === null) continue;
      const previousAt = dateValue(previous.created_at);
      const currentAt = dateValue(current.created_at);
      if (previousAt === null || currentAt === null) continue;
      const intervalDays = (currentAt - previousAt) / DAY_MS;
      if (intervalDays < 1 || intervalDays > 30) continue;
      retentionPairs.push({ change: current.score_rate - previous.score_rate, intervalDays });
    }
  }
  const minimumDiagnosticSamples = 3;
  const retentionChange = mean(retentionPairs.map((pair) => pair.change));
  let retentionStatus: PersonalAnalytics["diagnostics"]["retention"]["status"] = "insufficient";
  let retentionMessage = `同じ問題を1〜30日空けて${minimumDiagnosticSamples}組解くと、定着の変化を比較できます。`;
  if (retentionPairs.length >= minimumDiagnosticSamples && retentionChange !== null) {
    if (retentionChange >= 0.1) {
      retentionStatus = "improving";
      retentionMessage = "再挑戦時の達成度が上がっています。間隔を空けた復習が定着につながっています。";
    } else if (retentionChange <= -0.1) {
      retentionStatus = "declining";
      retentionMessage = "再挑戦時の達成度が下がっています。解法を見ずに再現する復習を優先してください。";
    } else {
      retentionStatus = "stable";
      retentionMessage = "再挑戦時の達成度は概ね維持されています。別形式の問題でも再現性を確認しましょう。";
    }
  }

  const scoredAttempts = attempts.filter((attempt): attempt is AnalyticsAttempt & { score_rate: number } => attempt.score_rate !== null);
  const assistedAttempts = scoredAttempts.filter((attempt) => Boolean(attempt.used_hint) || Boolean(attempt.looked_solution));
  const independentAttempts = scoredAttempts.filter((attempt) => !attempt.used_hint && !attempt.looked_solution);
  const assistedScore = mean(assistedAttempts.map((attempt) => attempt.score_rate));
  const independentScore = mean(independentAttempts.map((attempt) => attempt.score_rate));
  const assistedGap = assistedScore === null || independentScore === null ? null : assistedScore - independentScore;
  let independenceStatus: PersonalAnalytics["diagnostics"]["independence"]["status"] = "insufficient";
  let independenceMessage = "補助あり・補助なしの記録が各3件そろうと、ヒント依存の傾向を比較できます。";
  if (assistedAttempts.length >= minimumDiagnosticSamples && independentAttempts.length >= minimumDiagnosticSamples && assistedGap !== null) {
    if (assistedGap >= 0.15) {
      independenceStatus = "support_dependent";
      independenceMessage = "補助ありの達成度が高めです。最初の5分はヒントを開かず、想起できる範囲を確認しましょう。";
    } else if (assistedGap <= -0.1) {
      independenceStatus = "independent_strong";
      independenceMessage = "補助なしでも達成度を保てています。発展問題で自力再現の範囲を広げられます。";
    } else {
      independenceStatus = "balanced";
      independenceMessage = "補助の有無による達成度差は小さく、必要な場面で補助を使えています。";
    }
  }

  const timedAttempts = scoredAttempts.filter(
    (attempt): attempt is AnalyticsAttempt & { score_rate: number; time_spent_minutes: number } =>
      attempt.time_spent_minutes !== null && attempt.time_spent_minutes > 0 && attempt.estimated_minutes > 0,
  );
  const onTimeAttempts = timedAttempts.filter((attempt) => attempt.time_spent_minutes <= attempt.estimated_minutes * 1.25);
  const overtimeAttempts = timedAttempts.filter((attempt) => attempt.time_spent_minutes > attempt.estimated_minutes * 1.25);
  const onTimeScore = mean(onTimeAttempts.map((attempt) => attempt.score_rate));
  const overtimeScore = mean(overtimeAttempts.map((attempt) => attempt.score_rate));
  const onTimeAdvantage = onTimeScore === null || overtimeScore === null ? null : onTimeScore - overtimeScore;
  let pacingStatus: PersonalAnalytics["diagnostics"]["pacing"]["status"] = "insufficient";
  let pacingMessage = "目安時間内・時間超過の記録が各3件そろうと、時間配分と達成度を比較できます。";
  if (onTimeAttempts.length >= minimumDiagnosticSamples && overtimeAttempts.length >= minimumDiagnosticSamples && onTimeAdvantage !== null) {
    if (onTimeAdvantage >= 0.15) {
      pacingStatus = "overtime_cost";
      pacingMessage = "時間超過時に達成度が下がっています。途中式の停止線を決め、時間内の判断を練習しましょう。";
    } else if (onTimeAdvantage <= -0.1) {
      pacingStatus = "careful_working";
      pacingMessage = "時間をかけた問題の達成度が高めです。正確さを保ったまま手順を短縮できるか確認しましょう。";
    } else {
      pacingStatus = "stable";
      pacingMessage = "時間超過による達成度差は小さく、現在の配分は概ね安定しています。";
    }
  }

  const calibratedAttempts = attempts.filter(
    (attempt): attempt is AnalyticsAttempt & { self_confidence: number; score_rate: number } =>
      attempt.self_confidence !== null && attempt.score_rate !== null,
  );
  const confidenceValues = calibratedAttempts.map((attempt) => (attempt.self_confidence - 1) / 4);
  const calibrationErrors = calibratedAttempts.map((attempt, index) => Math.abs(confidenceValues[index] - attempt.score_rate));
  const meanConfidence = mean(confidenceValues);
  const meanCalibratedScore = mean(calibratedAttempts.map((attempt) => attempt.score_rate));
  const calibrationGap = meanConfidence === null || meanCalibratedScore === null ? null : meanConfidence - meanCalibratedScore;
  let calibrationStatus: PersonalAnalytics["calibration"]["status"] = "insufficient";
  let calibrationMessage = "自信度つきの学習記録を3件以上保存すると、自己評価の傾向を分析できます。";
  if (calibratedAttempts.length >= 3 && calibrationGap !== null) {
    if (calibrationGap > 0.15) {
      calibrationStatus = "overconfident";
      calibrationMessage = "自己評価が実際の達成度より高めです。解答前に根拠を言葉にすると見落としを減らせます。";
    } else if (calibrationGap < -0.15) {
      calibrationStatus = "underconfident";
      calibrationMessage = "実際の達成度に対して自己評価が控えめです。解けた手順を再現できるか確認しましょう。";
    } else {
      calibrationStatus = "well_calibrated";
      calibrationMessage = "自己評価と実際の達成度が近く、学習判断の精度が安定しています。";
    }
  }

  const trendMap = new Map<string, { attempts: number; minutes: number; scores: number[] }>();
  for (const attempt of attempts) {
    const key = weekStart(attempt.created_at);
    if (!key) continue;
    const aggregate = trendMap.get(key) ?? { attempts: 0, minutes: 0, scores: [] };
    aggregate.attempts += 1;
    aggregate.minutes += Math.max(0, attempt.time_spent_minutes ?? 0);
    if (attempt.score_rate !== null) aggregate.scores.push(attempt.score_rate);
    trendMap.set(key, aggregate);
  }
  const trends = [...trendMap.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .slice(-8)
    .map(([week_start, aggregate]) => ({
      week_start,
      attempts: aggregate.attempts,
      minutes: aggregate.minutes,
      average_score: mean(aggregate.scores) === null ? null : round(mean(aggregate.scores)!),
    }));

  const concepts = conceptStates
    .map((concept) => {
      const confidence = masteryConfidence(concept.evidence_count, concept.last_attempted_at, now);
      return {
        ...concept,
        confidence,
        conservative_mastery: conservativeMastery(concept.mastery_score, concept.evidence_count, concept.last_attempted_at, now),
        needs_evidence: confidence < 0.6,
      };
    })
    .sort((left, right) => left.conservative_mastery - right.conservative_mastery || left.name_ja.localeCompare(right.name_ja));

  const evidenceByConcept = new Map<string, AnalyticsMasteryEvidenceRow[]>();
  for (const row of masteryEvidenceRows) {
    const conceptRows = evidenceByConcept.get(row.concept_id) ?? [];
    conceptRows.push(row);
    evidenceByConcept.set(row.concept_id, conceptRows);
  }
  const masteryEvidenceConcepts: PersonalAnalytics["mastery_evidence"]["concepts"] = [...evidenceByConcept.entries()].map(([conceptId, rows]) => {
    const values = rows.map((row) => Number(row.raw_evidence));
    const average = mean(values) ?? 0;
    const stddev = values.length < 2 ? null : Math.sqrt(values.reduce((sum, value) => sum + (value - average) ** 2, 0) / values.length);
    const range = values.length < 2 ? null : Math.max(...values) - Math.min(...values);
    const status: PersonalAnalytics["mastery_evidence"]["concepts"][number]["status"] = values.length < 3 ? "insufficient"
      : (range ?? 0) >= 0.6 || (stddev ?? 0) >= 0.3 ? "contradictory"
        : (stddev ?? 0) >= 0.2 ? "mixed" : "stable";
    const message = status === "insufficient" ? "3件そろうまで一貫性を判定しません。"
      : status === "contradictory" ? "直近の答案が大きく食い違っています。弱点と断定せず、別形式の確認問題を優先します。"
        : status === "mixed" ? "答案に揺れがあります。時間・補助条件をそろえて再確認してください。"
          : "直近の証拠は概ね一貫しています。";
    return {
      concept_id: conceptId,
      concept_name: rows[0].concept_name,
      sample_count: values.length,
      mean_evidence: round(average),
      evidence_stddev: stddev === null ? null : round(stddev),
      evidence_range: range === null ? null : round(range),
      status,
      message,
    };
  }).sort((left, right) => {
    const priority = { contradictory: 0, mixed: 1, insufficient: 2, stable: 3 } as const;
    return priority[left.status] - priority[right.status] || right.sample_count - left.sample_count || left.concept_name.localeCompare(right.concept_name, "ja");
  });

  const personalizedErrors = predictionEvaluations.map((row) => Math.abs(row.personalized_prediction - row.observed_score));
  const baselineErrors = predictionEvaluations.map((row) => Math.abs(row.baseline_prediction - row.observed_score));
  const personalizedBrierValues = predictionEvaluations.map((row) => (row.personalized_prediction - row.observed_score) ** 2);
  const baselineBrierValues = predictionEvaluations.map((row) => (row.baseline_prediction - row.observed_score) ** 2);
  const personalizedMae = mean(personalizedErrors);
  const baselineMae = mean(baselineErrors);
  const maeImprovement = personalizedMae === null || baselineMae === null ? null : baselineMae - personalizedMae;
  const minimumEvaluationSamples = 20;
  let modelQualityStatus: PersonalAnalytics["model_quality"]["status"] = "insufficient";
  let modelQualityMessage = `あと${Math.max(0, minimumEvaluationSamples - predictionEvaluations.length)}件の推薦後演習で、個人化モデルをベースラインと比較できます。`;
  if (predictionEvaluations.length >= minimumEvaluationSamples && maeImprovement !== null) {
    if (maeImprovement > 0.02) {
      modelQualityStatus = "improving";
      modelQualityMessage = "個人化モデルは単純ベースラインより予測誤差が小さく、改善傾向です。";
    } else if (maeImprovement < -0.02) {
      modelQualityStatus = "regressing";
      modelQualityMessage = "個人化モデルがベースラインを下回っています。係数の見直しが必要です。";
    } else {
      modelQualityStatus = "neutral";
      modelQualityMessage = "個人化モデルとベースラインの差はまだ実質的ではありません。";
    }
  }

  const averageConfidence = mean(concepts.map((concept) => concept.confidence)) ?? 0;
  const insights: PersonalAnalytics["insights"] = [];
  const contradictoryEvidence = masteryEvidenceConcepts.find((concept) => concept.status === "contradictory");
  if (contradictoryEvidence) {
    insights.push({
      id: "contradictory-evidence",
      tone: "attention",
      title: `${contradictoryEvidence.concept_name}は追加確認が必要`,
      body: `${contradictoryEvidence.sample_count}件の答案レンジが${Math.round((contradictoryEvidence.evidence_range ?? 0) * 100)}ポイントあります。現在値を弱点とは断定しません。`,
      action: "別形式の問題を1問、補助なしで解く",
    });
  }
  const weakest = concepts[0];
  if (weakest) {
    insights.push({
      id: "weakest-concept",
      tone: "attention",
      title: `${weakest.name_ja}を優先`,
      body: `保守的な習熟推定は${Math.round(weakest.conservative_mastery * 100)}%です。推定信頼度は${Math.round(weakest.confidence * 100)}%です。`,
      action: weakest.needs_evidence ? "基礎問題を1問解いて推定を確かめる" : "復習モードで定着を確認する",
    });
  }
  if (calibrationStatus === "overconfident" || calibrationStatus === "underconfident") {
    insights.push({ id: "calibration", tone: "attention", title: "自己評価を調整", body: calibrationMessage, action: "次の3問で自信度を必ず記録する" });
  } else if (calibrationStatus === "well_calibrated") {
    insights.push({ id: "calibration", tone: "positive", title: "学習判断が安定", body: calibrationMessage, action: "挑戦モードで難度を一段上げる" });
  }
  if (attempts.length === 0) {
    insights.push({ id: "first-evidence", tone: "neutral", title: "最初の基準を作る", body: "まだ個人分析に使える学習記録がありません。", action: "異なる分野の基礎問題を3問解く" });
  } else if (currentStreak(activeDates, now) >= 3) {
    insights.push({ id: "streak", tone: "positive", title: "学習リズムを維持", body: `${currentStreak(activeDates, now)}日連続で学習記録があります。`, action: "同じ時間帯に次の演習を予定する" });
  }
  if (availableAttempts > attempts.length) {
    insights.unshift({
      id: "analysis-window-limit",
      tone: "neutral",
      title: "直近の記録を重点分析",
      body: `${availableAttempts}件中、最新${attempts.length}件を分析しました。`,
      action: "長期傾向は週次集計で確認する",
    });
  }

  const readyDiagnostics = [retentionStatus, independenceStatus, pacingStatus].filter((status) => status !== "insufficient").length;
  let recommendedMode: PersonalAnalytics["strategy"]["recommended_mode"] = "normal";
  let strategyTitle = "バランス演習で証拠を増やす";
  let strategyAction = "バランスモードから3問選ぶ";
  const strategyRationale: string[] = [];
  if (retentionStatus === "declining") {
    recommendedMode = "review";
    strategyTitle = "復習モードで自力再現を確認";
    strategyAction = "復習モードから、以前解いた問題を1問選ぶ";
    strategyRationale.push("再挑戦時の達成度が低下傾向");
  } else if (contradictoryEvidence || independenceStatus === "support_dependent" || pacingStatus === "overtime_cost" || weakest?.needs_evidence) {
    recommendedMode = "foundation";
    strategyTitle = "基礎モードで解法を分解";
    strategyAction = "基礎モードから、目安時間内で解ける問題を1問選ぶ";
    if (independenceStatus === "support_dependent") strategyRationale.push("補助ありと補助なしの達成度差が大きい");
    if (pacingStatus === "overtime_cost") strategyRationale.push("時間超過時の達成度が低い");
    if (contradictoryEvidence) strategyRationale.push(`${contradictoryEvidence.concept_name}の答案証拠が矛盾`);
    if (weakest?.needs_evidence) strategyRationale.push(`${weakest.name_ja}の推定証拠が不足`);
  } else if ((mean(validScores) ?? 0) >= 0.75 && averageConfidence >= 0.65 && calibrationStatus !== "overconfident") {
    recommendedMode = "challenge";
    strategyTitle = "発展モードで転移を確認";
    strategyAction = "発展モードから、未経験形式を1問選ぶ";
    strategyRationale.push("達成度と習熟推定の確かさが十分");
    if (independenceStatus === "independent_strong") strategyRationale.push("補助なしでも達成度を維持");
  } else if (retentionStatus === "improving") {
    recommendedMode = "review";
    strategyTitle = "復習モードで定着を継続";
    strategyAction = "復習モードから、間隔の空いた問題を1問選ぶ";
    strategyRationale.push("間隔を空けた再挑戦で達成度が改善");
  }
  if (strategyRationale.length === 0) strategyRationale.push("比較可能な記録を増やして学習法を絞り込む段階");
  const strategyConfidence: PersonalAnalytics["strategy"]["confidence"] = readyDiagnostics >= 2 && averageConfidence >= 0.6
    ? "high"
    : readyDiagnostics >= 1 || attempts.length >= 5 ? "medium" : "low";

  return {
    model: {
      version: ANALYTICS_MODEL_VERSION,
      generated_at: now.toISOString(),
      window_days: windowDays,
      analyzed_attempts: attempts.length,
      available_attempts: availableAttempts,
      truncated: availableAttempts > attempts.length,
      hypotheses: [
        { id: "H1_ADAPTIVE_MASTERY", label: "証拠量と概念エッジの関連度で更新幅を変えると、習熟推定が安定する", metric: "次回達成度の平均絶対誤差" },
        { id: "H2_CONFIDENCE_AWARE", label: "証拠量と鮮度を推薦に反映すると未知の弱点を見逃しにくい", metric: "推薦後3問の平均達成度改善" },
        { id: "H3_CALIBRATION", label: "自己評価のずれを可視化すると振り返りの質が上がる", metric: "自信度と達成度の平均絶対誤差" },
        { id: "H4_SPACED_RETENTION", label: "1〜30日空けた再挑戦で定着の変化を測れる", metric: "同一問題の再挑戦時達成度差" },
        { id: "H5_INDEPENDENT_RETRIEVAL", label: "補助なし演習の達成度差から自力再現の課題を見つけられる", metric: "補助あり・なしの平均達成度差" },
        { id: "H6_TIME_BOXING", label: "目安時間超過と達成度の関係から時間配分を調整できる", metric: "時間内・時間超過の平均達成度差" },
        { id: "P7_GOAL_READINESS", label: "目標分野の証拠量・計画遵守・学習ペースを合わせると準備不足を早く検知できる", metric: "日次準備度と4週間後の保守的習熟度変化" },
        { id: "P8_PLAN_ADHERENCE", label: "計画遵守率が高い期間は目標分野の準備度が改善しやすい", metric: "計画遵守率と準備度変化の本人内相関" },
        { id: "P9_SCHEDULE_CONSOLIDATION", label: "週の総学習時間を保った日数再配分は計画遵守を改善する", metric: "採用前と採用後14日間の予定日完了率差" },
        { id: "P10_BOTTLENECK_FOCUS", label: "実測ボトルネックへの最大50%集中は学習範囲を保ちながら習熟を改善する", metric: "採用前と14日後の重点習熟度差・計画遵守差・範囲カバー率" },
        { id: "P11_DIAGNOSTIC_EXPLORATION", label: "未観測分野の最大20%確認枠は計画を崩さず実測証拠を増やす", metric: "14日以内の情報獲得率・取得時間・計画遵守・範囲カバー率" },
        { id: "P12_DIAGNOSTIC_ITEM_VALUE", label: "情報量の高い1問を選ぶと短時間で直接証拠を増やせる", metric: "30分当たり直接証拠・14日完了率・時間超過率" },
        { id: "P13_DIAGNOSTIC_CHOICE_COVERAGE", label: "比較可能な候補があるときだけランキングを適用すると選定根拠が安定する", metric: "比較機会率・選定変更率・代理効用差" },
        { id: "P22_CONTRADICTORY_EVIDENCE", label: "答案証拠の矛盾を弱点と分離すると、誤った重点化を減らせる", metric: "矛盾判定後の別問題達成度と推定誤差" },
      ],
    },
    summary: {
      total_attempts: attempts.length,
      active_days: activeDates.size,
      total_minutes: totalMinutes,
      average_score: mean(validScores) === null ? null : round(mean(validScores)!),
      success_rate: completed.length === 0 ? null : round(successful.length / completed.length),
      pace_score: mean(paceValues) === null ? null : round(mean(paceValues)!),
      calibration_score: mean(calibrationErrors) === null ? null : round(1 - mean(calibrationErrors)!),
      current_streak_days: currentStreak(activeDates, now),
      evidence_strength: round(averageConfidence),
    },
    calibration: {
      status: calibrationStatus,
      sample_count: calibratedAttempts.length,
      mean_confidence: meanConfidence === null ? null : round(meanConfidence),
      mean_score: meanCalibratedScore === null ? null : round(meanCalibratedScore),
      gap: calibrationGap === null ? null : round(calibrationGap),
      message: calibrationMessage,
    },
    model_quality: {
      status: modelQualityStatus,
      sample_count: predictionEvaluations.length,
      minimum_sample_size: minimumEvaluationSamples,
      personalized_mae: personalizedMae === null ? null : round(personalizedMae),
      baseline_mae: baselineMae === null ? null : round(baselineMae),
      mae_improvement: maeImprovement === null ? null : round(maeImprovement),
      personalized_brier: mean(personalizedBrierValues) === null ? null : round(mean(personalizedBrierValues)!),
      baseline_brier: mean(baselineBrierValues) === null ? null : round(mean(baselineBrierValues)!),
      win_rate: predictionEvaluations.length === 0
        ? null
        : round(personalizedErrors.filter((error, index) => error < baselineErrors[index]).length / predictionEvaluations.length),
      message: modelQualityMessage,
    },
    diagnostics: {
      retention: {
        status: retentionStatus,
        sample_pairs: retentionPairs.length,
        minimum_pairs: minimumDiagnosticSamples,
        average_score_change: retentionPairs.length >= minimumDiagnosticSamples && retentionChange !== null ? round(retentionChange) : null,
        median_interval_days: retentionPairs.length >= minimumDiagnosticSamples
          ? (() => {
              const value = median(retentionPairs.map((pair) => pair.intervalDays));
              return value === null ? null : round(value, 1);
            })()
          : null,
        message: retentionMessage,
      },
      independence: {
        status: independenceStatus,
        independent_count: independentAttempts.length,
        assisted_count: assistedAttempts.length,
        minimum_per_group: minimumDiagnosticSamples,
        independent_score: independenceStatus === "insufficient" ? null : round(independentScore!),
        assisted_score: independenceStatus === "insufficient" ? null : round(assistedScore!),
        assisted_gap: independenceStatus === "insufficient" || assistedGap === null ? null : round(assistedGap),
        message: independenceMessage,
      },
      pacing: {
        status: pacingStatus,
        on_time_count: onTimeAttempts.length,
        overtime_count: overtimeAttempts.length,
        minimum_per_group: minimumDiagnosticSamples,
        on_time_score: pacingStatus === "insufficient" ? null : round(onTimeScore!),
        overtime_score: pacingStatus === "insufficient" ? null : round(overtimeScore!),
        on_time_advantage: pacingStatus === "insufficient" || onTimeAdvantage === null ? null : round(onTimeAdvantage),
        message: pacingMessage,
      },
    },
    strategy: {
      experiment_id: null,
      recommended_mode: recommendedMode,
      confidence: strategyConfidence,
      title: strategyTitle,
      rationale: strategyRationale,
      action: strategyAction,
    },
    strategy_evaluation: null,
    schedule_adaptation: null,
    plan_focus: null,
    information_gain: null,
    diagnostic_item: null,
    goal_readiness: null,
    trends,
    concepts,
    mastery_evidence: {
      model_version: "mastery-evidence-explain-v1",
      recent: [...masteryEvidenceRows].sort((left, right) => right.created_at.localeCompare(left.created_at)).slice(0, 20),
      concepts: masteryEvidenceConcepts,
    },
    insights: insights.slice(0, 3),
  };
}
