import { clamp } from "./json";
import {
  buildDiagnosticChoiceHealth,
  buildDiagnosticItemHealth,
  type DiagnosticChoiceHealth,
  type DiagnosticItemHealth,
  type DiagnosticItemHealthRow,
} from "./diagnostic-items";
import {
  buildDiagnosticContentCoverage,
  type DiagnosticContentCoverage,
  type DiagnosticContentNodeRow,
} from "./diagnostic-content";
import { buildInformationGainHealth, type InformationGainHealth, type InformationGainHealthRow } from "./information-gain";
import { buildPlanFocusHealth, type PlanFocusHealth, type PlanFocusHealthRow } from "./plan-focus";
import { buildReadinessHealth, type ReadinessHealth, type ReadinessHealthRow } from "./readiness-health";
import { buildScheduleAdaptationHealth, type ScheduleAdaptationHealth, type ScheduleAdaptationHealthRow } from "./schedule-adaptation";
import { SHADOW_CANDIDATE_METADATA } from "./shadow-models";
import {
  buildDiagnosticProblemValidity,
  type DiagnosticProblemCalibrationRow,
  type DiagnosticProblemValidity,
  type DiagnosticProblemValidityAttemptRow,
  type DiagnosticProblemValidityItemRow,
} from "./diagnostic-problem-validity";
import { buildMasteryShadowHealth, type MasteryShadowEvaluationRow } from "./mastery-shadow";

export interface ModelHealthEvaluationRow {
  user_id: string;
  mode: "normal" | "review" | "foundation" | "challenge";
  personalized_prediction: number;
  baseline_prediction: number;
  prediction_confidence: number;
  observed_score: number;
  observed_at: string;
  user_attempt_count: number;
}

export interface ModelHealthShadowRow {
  user_id: string;
  candidate_version: string;
  hypothesis_id: string;
  candidate_label: string;
  candidate_prediction: number;
  current_prediction: number;
  observed_score: number;
}

export interface ModelHealthOutcomeRow {
  user_id: string;
  rank_position: number;
  recommendation_score: number;
  attempted_7d: number;
  latency_hours: number | null;
}

export interface ModelHealthStrategyRow {
  user_id: string;
  recommended_mode: "normal" | "review" | "foundation" | "challenge";
  score_uplift: number;
}

export interface ModelHealth {
  model_version: string;
  generated_at: string;
  decision: "collecting" | "healthy" | "watch" | "halt_candidate";
  decision_message: string;
  overview: {
    exposures: number;
    observed: number;
    analyzed_observations: number;
    truncated: boolean;
    observation_rate: number | null;
    evaluated_users: number;
    personalized_mae: number | null;
    baseline_mae: number | null;
    mae_improvement: number | null;
    win_rate: number | null;
    minimum_samples: number;
    minimum_users: number;
  };
  trends: Array<{
    week_start: string;
    samples: number;
    personalized_mae: number;
    baseline_mae: number;
  }>;
  segments: Array<{
    id: string;
    dimension: "mode" | "confidence" | "experience";
    label: string;
    samples: number;
    users: number;
    personalized_mae: number;
    baseline_mae: number;
    mae_improvement: number;
    status: "healthy" | "neutral" | "regressing";
  }>;
  suppressed_segments: number;
  shadow_candidates: Array<{
    candidate_version: string;
    hypothesis_id: string;
    label: string;
    status: "collecting" | "supported" | "neutral" | "rejected";
    samples: number;
    users: number;
    minimum_samples: number;
    minimum_users: number;
    candidate_mae: number | null;
    current_mae: number | null;
    mae_improvement: number | null;
    candidate_brier: number | null;
    current_brier: number | null;
    brier_improvement: number | null;
  }>;
  recommendation_effectiveness: {
    mature_exposures: number;
    users: number;
    attempted_7d: number | null;
    conversion_rate_7d: number | null;
    median_latency_hours: number | null;
    minimum_exposures: number;
    minimum_users: number;
    rank_bands: Array<{
      id: "top-3" | "rank-4-10" | "rank-11-20";
      label: string;
      exposures: number;
      users: number;
      attempted_7d: number | null;
      conversion_rate_7d: number | null;
    }>;
  };
  strategy_effectiveness: {
    completed_experiments: number;
    users: number;
    minimum_experiments: number;
    minimum_users: number;
    average_uplift: number | null;
    improvement_rate: number | null;
    by_mode: Array<{
      mode: "normal" | "review" | "foundation" | "challenge";
      label: string;
      experiments: number;
      users: number;
      average_uplift: number | null;
      status: "collecting" | "supported" | "neutral" | "rejected";
    }>;
  };
  readiness_effectiveness: ReadinessHealth;
  schedule_adaptation_effectiveness: ScheduleAdaptationHealth;
  plan_focus_effectiveness: PlanFocusHealth;
  information_gain_effectiveness: InformationGainHealth;
  diagnostic_item_effectiveness: DiagnosticItemHealth;
  diagnostic_choice_effectiveness: DiagnosticChoiceHealth;
  diagnostic_content_coverage: DiagnosticContentCoverage;
  diagnostic_problem_validity: DiagnosticProblemValidity;
  mastery_shadow: ReturnType<typeof buildMasteryShadowHealth>;
  hypotheses: Array<{
    id: string;
    label: string;
    status: "collecting" | "supported" | "neutral" | "rejected";
    evidence: string;
  }>;
};

const MINIMUM_GLOBAL_SAMPLES = 50;
const MINIMUM_GLOBAL_USERS = 5;
const MINIMUM_SEGMENT_SAMPLES = 20;
const MINIMUM_SEGMENT_USERS = 5;
const MINIMUM_EFFECTIVENESS_EXPOSURES = 100;
const MINIMUM_EFFECTIVENESS_USERS = 10;
const MINIMUM_RANK_BAND_EXPOSURES = 50;
const MINIMUM_STRATEGY_EXPERIMENTS = 30;
const MINIMUM_STRATEGY_USERS = 10;
const MINIMUM_STRATEGY_MODE_EXPERIMENTS = 10;
const MINIMUM_STRATEGY_MODE_USERS = 5;
const JST_OFFSET_MS = 9 * 60 * 60 * 1_000;

function round(value: number, digits = 3): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
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

function errors(rows: ModelHealthEvaluationRow[]) {
  const personalized = rows.map((row) => Math.abs(row.personalized_prediction - row.observed_score));
  const baseline = rows.map((row) => Math.abs(row.baseline_prediction - row.observed_score));
  const personalizedMae = mean(personalized);
  const baselineMae = mean(baseline);
  return {
    personalized,
    baseline,
    personalizedMae,
    baselineMae,
    improvement: personalizedMae === null || baselineMae === null ? null : baselineMae - personalizedMae,
  };
}

function weekStart(value: string): string | null {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return null;
  const date = new Date(parsed + JST_OFFSET_MS);
  const weekday = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - weekday);
  return date.toISOString().slice(0, 10);
}

function confidenceBand(value: number): { id: string; label: string } {
  if (value < 0.4) return { id: "low", label: "低信頼度" };
  if (value < 0.7) return { id: "medium", label: "中信頼度" };
  return { id: "high", label: "高信頼度" };
}

function experienceCohort(attemptCount: number): { id: string; label: string } {
  if (attemptCount < 5) return { id: "cold-start", label: "初期（0〜4問）" };
  if (attemptCount < 20) return { id: "developing", label: "形成中（5〜19問）" };
  return { id: "established", label: "蓄積済み（20問以上）" };
}

function segmentStatus(improvement: number): "healthy" | "neutral" | "regressing" {
  if (improvement >= 0.02) return "healthy";
  if (improvement <= -0.02) return "regressing";
  return "neutral";
}

export function buildModelHealth(
  rows: ModelHealthEvaluationRow[],
  options: {
    modelVersion: string;
    totalExposures: number;
    availableObserved?: number;
    shadowRows?: ModelHealthShadowRow[];
    outcomeRows?: ModelHealthOutcomeRow[];
    strategyRows?: ModelHealthStrategyRow[];
    readinessRows?: ReadinessHealthRow[];
    scheduleAdaptationRows?: ScheduleAdaptationHealthRow[];
    planFocusRows?: PlanFocusHealthRow[];
    informationGainRows?: InformationGainHealthRow[];
    diagnosticItemRows?: DiagnosticItemHealthRow[];
    diagnosticContentRows?: DiagnosticContentNodeRow[];
    diagnosticProblemValidityItems?: DiagnosticProblemValidityItemRow[];
    diagnosticProblemValidityAttempts?: DiagnosticProblemValidityAttemptRow[];
    diagnosticProblemCalibrationRows?: DiagnosticProblemCalibrationRow[];
    masteryShadowRows?: MasteryShadowEvaluationRow[];
    now?: Date;
  },
): ModelHealth {
  const now = options.now ?? new Date();
  const availableObserved = options.availableObserved ?? rows.length;
  const aggregate = errors(rows);
  const evaluatedUsers = new Set(rows.map((row) => row.user_id)).size;
  const globalReady = rows.length >= MINIMUM_GLOBAL_SAMPLES && evaluatedUsers >= MINIMUM_GLOBAL_USERS;

  const rawSegments = new Map<string, { dimension: "mode" | "confidence" | "experience"; label: string; rows: ModelHealthEvaluationRow[] }>();
  function addSegment(dimension: "mode" | "confidence" | "experience", id: string, label: string, row: ModelHealthEvaluationRow) {
    const key = `${dimension}:${id}`;
    const segment = rawSegments.get(key) ?? { dimension, label, rows: [] };
    segment.rows.push(row);
    rawSegments.set(key, segment);
  }
  const modeLabels = { normal: "バランス", review: "復習", foundation: "基礎", challenge: "発展" } as const;
  for (const row of rows) {
    addSegment("mode", row.mode, modeLabels[row.mode], row);
    const confidence = confidenceBand(row.prediction_confidence);
    addSegment("confidence", confidence.id, confidence.label, row);
    const experience = experienceCohort(row.user_attempt_count);
    addSegment("experience", experience.id, experience.label, row);
  }

  let suppressedSegments = 0;
  const segments: ModelHealth["segments"] = [];
  for (const [id, segment] of rawSegments) {
    const users = new Set(segment.rows.map((row) => row.user_id)).size;
    if (segment.rows.length < MINIMUM_SEGMENT_SAMPLES || users < MINIMUM_SEGMENT_USERS) {
      suppressedSegments += 1;
      continue;
    }
    const result = errors(segment.rows);
    if (result.personalizedMae === null || result.baselineMae === null || result.improvement === null) continue;
    segments.push({
      id,
      dimension: segment.dimension,
      label: segment.label,
      samples: segment.rows.length,
      users,
      personalized_mae: round(result.personalizedMae),
      baseline_mae: round(result.baselineMae),
      mae_improvement: round(result.improvement),
      status: segmentStatus(result.improvement),
    });
  }
  segments.sort((left, right) => left.dimension.localeCompare(right.dimension) || left.label.localeCompare(right.label, "ja"));

  const trendMap = new Map<string, ModelHealthEvaluationRow[]>();
  for (const row of rows) {
    const key = weekStart(row.observed_at);
    if (!key) continue;
    const weekRows = trendMap.get(key) ?? [];
    weekRows.push(row);
    trendMap.set(key, weekRows);
  }
  const trends = [...trendMap.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .slice(-12)
    .flatMap(([week_start, weekRows]) => {
      const result = errors(weekRows);
      return result.personalizedMae === null || result.baselineMae === null
        ? []
        : [{ week_start, samples: weekRows.length, personalized_mae: round(result.personalizedMae), baseline_mae: round(result.baselineMae) }];
    });

  let decision: ModelHealth["decision"] = "collecting";
  const remainingSamples = Math.max(0, MINIMUM_GLOBAL_SAMPLES - rows.length);
  const remainingUsers = Math.max(0, MINIMUM_GLOBAL_USERS - evaluatedUsers);
  let decisionMessage = `一次判定まであと${remainingSamples}件・${remainingUsers}人です。利用者体験を変えずにシャドー比較を継続します。`;
  if (globalReady && aggregate.improvement !== null) {
    const hasRegressingSegment = segments.some((segment) => segment.mae_improvement <= -0.05);
    if (aggregate.improvement <= -0.03) {
      decision = "halt_candidate";
      decisionMessage = "全体の予測誤差が停止基準を超えて悪化しています。v4の係数を見直してください。";
    } else if (aggregate.improvement < -0.01 || hasRegressingSegment) {
      decision = "watch";
      decisionMessage = "一部で悪化傾向があります。対象セグメントを確認し、拡大判断を保留してください。";
    } else {
      decision = "healthy";
      decisionMessage = "停止基準に抵触していません。シャドー評価を継続できます。";
    }
  }

  const lowConfidence = rows.filter((row) => row.prediction_confidence < 0.4);
  const highConfidence = rows.filter((row) => row.prediction_confidence >= 0.7);
  const lowConfidenceUsers = new Set(lowConfidence.map((row) => row.user_id)).size;
  const highConfidenceUsers = new Set(highConfidence.map((row) => row.user_id)).size;
  const lowErrors = errors(lowConfidence);
  const highErrors = errors(highConfidence);
  const confidenceReady = lowConfidence.length >= MINIMUM_SEGMENT_SAMPLES
    && highConfidence.length >= MINIMUM_SEGMENT_SAMPLES
    && lowConfidenceUsers >= MINIMUM_SEGMENT_USERS
    && highConfidenceUsers >= MINIMUM_SEGMENT_USERS;
  const modeSegments = segments.filter((segment) => segment.dimension === "mode");
  const modeSpread = modeSegments.length < 2
    ? null
    : Math.max(...modeSegments.map((segment) => segment.personalized_mae)) - Math.min(...modeSegments.map((segment) => segment.personalized_mae));

  const shadowGroups = new Map<string, {
    hypothesisId: string;
    label: string;
    rows: ModelHealthShadowRow[];
  }>();
  for (const candidate of SHADOW_CANDIDATE_METADATA) {
    shadowGroups.set(candidate.candidateVersion, { hypothesisId: candidate.hypothesisId, label: candidate.label, rows: [] });
  }
  for (const row of options.shadowRows ?? []) {
    const group = shadowGroups.get(row.candidate_version) ?? {
      hypothesisId: row.hypothesis_id,
      label: row.candidate_label,
      rows: [],
    };
    group.rows.push(row);
    shadowGroups.set(row.candidate_version, group);
  }
  const shadowCandidates: ModelHealth["shadow_candidates"] = [...shadowGroups.entries()].map(([candidateVersion, group]) => {
    const users = new Set(group.rows.map((row) => row.user_id)).size;
    const ready = group.rows.length >= MINIMUM_GLOBAL_SAMPLES && users >= MINIMUM_GLOBAL_USERS;
    const candidateMae = mean(group.rows.map((row) => Math.abs(row.candidate_prediction - row.observed_score)));
    const currentMae = mean(group.rows.map((row) => Math.abs(row.current_prediction - row.observed_score)));
    const candidateBrier = mean(group.rows.map((row) => (row.candidate_prediction - row.observed_score) ** 2));
    const currentBrier = mean(group.rows.map((row) => (row.current_prediction - row.observed_score) ** 2));
    const maeImprovement = candidateMae === null || currentMae === null ? null : currentMae - candidateMae;
    const brierImprovement = candidateBrier === null || currentBrier === null ? null : currentBrier - candidateBrier;
    let status: ModelHealth["shadow_candidates"][number]["status"] = "collecting";
    if (ready && maeImprovement !== null && brierImprovement !== null) {
      status = maeImprovement > 0.02 && brierImprovement > 0
        ? "supported"
        : maeImprovement < -0.02 || brierImprovement < -0.01
          ? "rejected"
          : "neutral";
    }
    return {
      candidate_version: candidateVersion,
      hypothesis_id: group.hypothesisId,
      label: group.label,
      status,
      samples: group.rows.length,
      users,
      minimum_samples: MINIMUM_GLOBAL_SAMPLES,
      minimum_users: MINIMUM_GLOBAL_USERS,
      candidate_mae: ready && candidateMae !== null ? round(candidateMae) : null,
      current_mae: ready && currentMae !== null ? round(currentMae) : null,
      mae_improvement: ready && maeImprovement !== null ? round(maeImprovement) : null,
      candidate_brier: ready && candidateBrier !== null ? round(candidateBrier) : null,
      current_brier: ready && currentBrier !== null ? round(currentBrier) : null,
      brier_improvement: ready && brierImprovement !== null ? round(brierImprovement) : null,
    };
  });

  const outcomeRows = options.outcomeRows ?? [];
  const outcomeUsers = new Set(outcomeRows.map((row) => row.user_id)).size;
  const outcomeReady = outcomeRows.length >= MINIMUM_EFFECTIVENESS_EXPOSURES
    && outcomeUsers >= MINIMUM_EFFECTIVENESS_USERS;
  const outcomeAttempts = outcomeRows.filter((row) => Boolean(row.attempted_7d));
  const rankBandDefinitions = [
    { id: "top-3" as const, label: "Top 3", matches: (rank: number) => rank <= 3 },
    { id: "rank-4-10" as const, label: "4〜10位", matches: (rank: number) => rank >= 4 && rank <= 10 },
    { id: "rank-11-20" as const, label: "11〜20位", matches: (rank: number) => rank >= 11 && rank <= 20 },
  ];
  const rankBands: ModelHealth["recommendation_effectiveness"]["rank_bands"] = rankBandDefinitions.map((definition) => {
    const bandRows = outcomeRows.filter((row) => definition.matches(row.rank_position));
    const users = new Set(bandRows.map((row) => row.user_id)).size;
    const ready = bandRows.length >= MINIMUM_RANK_BAND_EXPOSURES && users >= MINIMUM_SEGMENT_USERS;
    const attempts = bandRows.filter((row) => Boolean(row.attempted_7d)).length;
    return {
      id: definition.id,
      label: definition.label,
      exposures: bandRows.length,
      users,
      attempted_7d: ready ? attempts : null,
      conversion_rate_7d: ready ? round(attempts / bandRows.length) : null,
    };
  });
  const topRankBand = rankBands.find((band) => band.id === "top-3");
  const lowerRankBand = rankBands.find((band) => band.id === "rank-4-10");
  const rankConversionGap = topRankBand?.conversion_rate_7d === null
    || topRankBand?.conversion_rate_7d === undefined
    || lowerRankBand?.conversion_rate_7d === null
    || lowerRankBand?.conversion_rate_7d === undefined
    ? null
    : topRankBand.conversion_rate_7d - lowerRankBand.conversion_rate_7d;
  const effectivenessConversion = outcomeReady ? outcomeAttempts.length / outcomeRows.length : null;
  const recommendationEffectiveness: ModelHealth["recommendation_effectiveness"] = {
    mature_exposures: outcomeRows.length,
    users: outcomeUsers,
    attempted_7d: outcomeReady ? outcomeAttempts.length : null,
    conversion_rate_7d: effectivenessConversion === null ? null : round(effectivenessConversion),
    median_latency_hours: outcomeReady
      ? (() => {
          const value = median(outcomeAttempts.map((row) => row.latency_hours).filter((value): value is number => value !== null));
          return value === null ? null : round(value, 1);
        })()
      : null,
    minimum_exposures: MINIMUM_EFFECTIVENESS_EXPOSURES,
    minimum_users: MINIMUM_EFFECTIVENESS_USERS,
    rank_bands: rankBands,
  };

  const strategyRows = options.strategyRows ?? [];
  const strategyUsers = new Set(strategyRows.map((row) => row.user_id)).size;
  const strategyReady = strategyRows.length >= MINIMUM_STRATEGY_EXPERIMENTS
    && strategyUsers >= MINIMUM_STRATEGY_USERS;
  const averageStrategyUplift = mean(strategyRows.map((row) => row.score_uplift));
  const strategyModeDefinitions = (["normal", "review", "foundation", "challenge"] as const).map((mode) => ({
    mode,
    label: modeLabels[mode],
  }));
  const strategyByMode: ModelHealth["strategy_effectiveness"]["by_mode"] = strategyModeDefinitions.map(({ mode, label }) => {
    const modeRows = strategyRows.filter((row) => row.recommended_mode === mode);
    const users = new Set(modeRows.map((row) => row.user_id)).size;
    const ready = modeRows.length >= MINIMUM_STRATEGY_MODE_EXPERIMENTS && users >= MINIMUM_STRATEGY_MODE_USERS;
    const uplift = mean(modeRows.map((row) => row.score_uplift));
    let status: ModelHealth["strategy_effectiveness"]["by_mode"][number]["status"] = "collecting";
    if (ready && uplift !== null) {
      status = uplift >= 0.05 ? "supported" : uplift <= -0.05 ? "rejected" : "neutral";
    }
    return {
      mode,
      label,
      experiments: modeRows.length,
      users,
      average_uplift: ready && uplift !== null ? round(uplift) : null,
      status,
    };
  });
  const strategyEffectiveness: ModelHealth["strategy_effectiveness"] = {
    completed_experiments: strategyRows.length,
    users: strategyUsers,
    minimum_experiments: MINIMUM_STRATEGY_EXPERIMENTS,
    minimum_users: MINIMUM_STRATEGY_USERS,
    average_uplift: strategyReady && averageStrategyUplift !== null ? round(averageStrategyUplift) : null,
    improvement_rate: strategyReady
      ? round(strategyRows.filter((row) => row.score_uplift > 0).length / strategyRows.length)
      : null,
    by_mode: strategyByMode,
  };
  const readinessEffectiveness = buildReadinessHealth(options.readinessRows ?? [], now);
  const scheduleAdaptationEffectiveness = buildScheduleAdaptationHealth(options.scheduleAdaptationRows ?? []);
  const planFocusEffectiveness = buildPlanFocusHealth(options.planFocusRows ?? []);
  const informationGainEffectiveness = buildInformationGainHealth(options.informationGainRows ?? []);
  const diagnosticItemEffectiveness = buildDiagnosticItemHealth(options.diagnosticItemRows ?? []);
  const diagnosticChoiceEffectiveness = buildDiagnosticChoiceHealth(options.diagnosticItemRows ?? []);
  const diagnosticContentCoverage = buildDiagnosticContentCoverage(options.diagnosticContentRows ?? []);
  const diagnosticProblemValidity = buildDiagnosticProblemValidity(
    options.diagnosticProblemValidityItems ?? [],
    options.diagnosticProblemValidityAttempts ?? [],
    options.diagnosticProblemCalibrationRows ?? [],
  );
  const masteryShadow = buildMasteryShadowHealth(options.masteryShadowRows ?? []);

  const hypotheses: ModelHealth["hypotheses"] = [
    {
      id: "H2_BEATS_BASELINE",
      label: "個人化予測は単純ベースラインより正確",
      status: !globalReady || aggregate.improvement === null
        ? "collecting"
        : aggregate.improvement > 0.02 ? "supported" : aggregate.improvement < -0.02 ? "rejected" : "neutral",
      evidence: aggregate.improvement === null ? "観測なし" : `MAE改善 ${round(aggregate.improvement)}`,
    },
    {
      id: "H3_CONFIDENCE_IS_MEANINGFUL",
      label: "高信頼度の予測は低信頼度より誤差が小さい",
      status: !confidenceReady || lowErrors.personalizedMae === null || highErrors.personalizedMae === null
        ? "collecting"
        : highErrors.personalizedMae + 0.02 < lowErrors.personalizedMae ? "supported" : "rejected",
      evidence: confidenceReady && lowErrors.personalizedMae !== null && highErrors.personalizedMae !== null
        ? `低 ${round(lowErrors.personalizedMae)} / 高 ${round(highErrors.personalizedMae)}`
        : `低${lowConfidence.length}件 / 高${highConfidence.length}件`,
    },
    {
      id: "H4_STABLE_ACROSS_MODES",
      label: "推薦モード間で予測精度が大きく崩れない",
      status: modeSpread === null ? "collecting" : modeSpread <= 0.08 ? "supported" : "rejected",
      evidence: modeSpread === null ? "表示可能なモードが2つ未満" : `モード間MAE差 ${round(modeSpread)}`,
    },
    ...shadowCandidates.map((candidate) => ({
      id: candidate.hypothesis_id,
      label: candidate.label,
      status: candidate.status,
      evidence: candidate.mae_improvement === null
        ? `${candidate.samples}件 / ${candidate.users}人`
        : `現行比MAE改善 ${candidate.mae_improvement}`,
    })),
    {
      id: "H7_TOP_RANKS_ARE_ACTIONABLE",
      label: "Top 3の推薦は4〜10位より7日以内に演習されやすい",
      status: rankConversionGap === null
        ? "collecting"
        : rankConversionGap > 0.05 ? "supported" : rankConversionGap < -0.05 ? "rejected" : "neutral",
      evidence: rankConversionGap === null ? "順位帯ごとに50件・5人が必要" : `演習率差 ${round(rankConversionGap)}`,
    },
    {
      id: "H8_RECOMMENDATIONS_DRIVE_PRACTICE",
      label: "推薦表示の20%以上が7日以内の演習につながる",
      status: effectivenessConversion === null
        ? "collecting"
        : effectivenessConversion >= 0.2 ? "supported" : effectivenessConversion < 0.1 ? "rejected" : "neutral",
      evidence: effectivenessConversion === null
        ? `${outcomeRows.length}件 / ${outcomeUsers}人`
        : `7日演習率 ${round(effectivenessConversion)}`,
    },
    {
      id: "H9_PERSONAL_STRATEGY_IMPROVES_SCORE",
      label: "採用した個人戦略は次の3問の達成度を改善する",
      status: !strategyReady || averageStrategyUplift === null
        ? "collecting"
        : averageStrategyUplift >= 0.05 ? "supported" : averageStrategyUplift <= -0.05 ? "rejected" : "neutral",
      evidence: !strategyReady || averageStrategyUplift === null
        ? `${strategyRows.length}件 / ${strategyUsers}人`
        : `平均変化 ${round(averageStrategyUplift)}`,
    },
    ...readinessEffectiveness.hypotheses,
    scheduleAdaptationEffectiveness.hypothesis,
    planFocusEffectiveness.hypothesis,
    informationGainEffectiveness.hypothesis,
    diagnosticItemEffectiveness.hypothesis,
    diagnosticChoiceEffectiveness.hypothesis,
    diagnosticContentCoverage.hypothesis,
    diagnosticProblemValidity.hypothesis,
    masteryShadow.hypothesis,
  ];

  return {
    model_version: options.modelVersion,
    generated_at: now.toISOString(),
    decision,
    decision_message: decisionMessage,
    overview: {
      exposures: options.totalExposures,
      observed: availableObserved,
      analyzed_observations: rows.length,
      truncated: availableObserved > rows.length,
      observation_rate: options.totalExposures === 0 ? null : round(clamp(availableObserved / options.totalExposures, 0, 1)),
      evaluated_users: evaluatedUsers,
      personalized_mae: aggregate.personalizedMae === null ? null : round(aggregate.personalizedMae),
      baseline_mae: aggregate.baselineMae === null ? null : round(aggregate.baselineMae),
      mae_improvement: aggregate.improvement === null ? null : round(aggregate.improvement),
      win_rate: rows.length === 0 ? null : round(aggregate.personalized.filter((error, index) => error < aggregate.baseline[index]).length / rows.length),
      minimum_samples: MINIMUM_GLOBAL_SAMPLES,
      minimum_users: MINIMUM_GLOBAL_USERS,
    },
    trends,
    segments,
    suppressed_segments: suppressedSegments,
    shadow_candidates: shadowCandidates,
    recommendation_effectiveness: recommendationEffectiveness,
    strategy_effectiveness: strategyEffectiveness,
    readiness_effectiveness: readinessEffectiveness,
    schedule_adaptation_effectiveness: scheduleAdaptationEffectiveness,
    plan_focus_effectiveness: planFocusEffectiveness,
    information_gain_effectiveness: informationGainEffectiveness,
    diagnostic_item_effectiveness: diagnosticItemEffectiveness,
    diagnostic_choice_effectiveness: diagnosticChoiceEffectiveness,
    diagnostic_content_coverage: diagnosticContentCoverage,
    diagnostic_problem_validity: diagnosticProblemValidity,
    mastery_shadow: masteryShadow,
    hypotheses,
  };
}
