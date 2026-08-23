const DAY_MS = 86_400_000;

const MINIMUM_FORECAST_PAIRS = 50;
const MINIMUM_FORECAST_USERS = 10;
const MINIMUM_ADHERENCE_PAIRS_PER_GROUP = 30;
const MINIMUM_ADHERENCE_USERS_PER_GROUP = 10;
const MINIMUM_BAND_PAIRS = 20;
const MINIMUM_BAND_USERS = 5;

export interface ReadinessHealthRow {
  user_id: string;
  goal_id: string;
  snapshot_date: string;
  readiness_score: number;
  knowledge_readiness: number | null;
  plan_adherence: number | null;
}

interface ReadinessPair {
  userId: string;
  readiness: number;
  baselineKnowledge: number;
  outcomeKnowledge: number;
  planAdherence: number | null;
}

export interface ReadinessHealth {
  horizon_days: 28;
  paired_snapshots: number;
  users: number;
  minimum_pairs: number;
  minimum_users: number;
  forecast_mae: number | null;
  knowledge_only_mae: number | null;
  mae_improvement: number | null;
  adherence_association: {
    high_pairs: number;
    high_users: number;
    low_pairs: number;
    low_users: number;
    high_average_gain: number | null;
    low_average_gain: number | null;
    gain_gap: number | null;
    minimum_pairs_per_group: number;
    minimum_users_per_group: number;
  };
  bands: Array<{
    id: "low" | "medium" | "high";
    label: string;
    pairs: number;
    users: number;
    predicted_readiness: number | null;
    observed_knowledge: number | null;
    calibration_gap: number | null;
  }>;
  hypotheses: Array<{
    id: "P7_GOAL_READINESS" | "P8_PLAN_ADHERENCE";
    label: string;
    status: "collecting" | "supported" | "neutral" | "rejected";
    evidence: string;
  }>;
}

function round(value: number, digits = 3): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function dayValue(value: string): number | null {
  const parsed = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(parsed) ? parsed : null;
}

function weekKey(value: string): string | null {
  const parsed = dayValue(value);
  if (parsed === null) return null;
  const date = new Date(parsed);
  const weekday = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - weekday);
  return date.toISOString().slice(0, 10);
}

export function pairReadinessSnapshots(rows: ReadinessHealthRow[], now = new Date()): ReadinessPair[] {
  const grouped = new Map<string, ReadinessHealthRow[]>();
  for (const row of rows) {
    if (dayValue(row.snapshot_date) === null) continue;
    const key = `${row.user_id}\u0000${row.goal_id}`;
    const group = grouped.get(key) ?? [];
    group.push(row);
    grouped.set(key, group);
  }

  const pairs: ReadinessPair[] = [];
  for (const group of grouped.values()) {
    group.sort((left, right) => left.snapshot_date.localeCompare(right.snapshot_date));
    const weekly = new Map<string, ReadinessHealthRow>();
    for (const row of group) {
      const key = weekKey(row.snapshot_date);
      if (key && !weekly.has(key)) weekly.set(key, row);
    }
    for (const baseline of weekly.values()) {
      const baselineDate = dayValue(baseline.snapshot_date);
      if (baselineDate === null || now.getTime() - baselineDate < 28 * DAY_MS || baseline.knowledge_readiness === null) continue;
      let outcome: ReadinessHealthRow | null = null;
      let closestDistance = Number.POSITIVE_INFINITY;
      for (const candidate of group) {
        const candidateDate = dayValue(candidate.snapshot_date);
        if (candidateDate === null || candidate.knowledge_readiness === null) continue;
        const elapsed = (candidateDate - baselineDate) / DAY_MS;
        if (elapsed < 21 || elapsed > 35) continue;
        const distance = Math.abs(elapsed - 28);
        if (distance < closestDistance || (distance === closestDistance && candidate.snapshot_date < (outcome?.snapshot_date ?? ""))) {
          outcome = candidate;
          closestDistance = distance;
        }
      }
      if (!outcome) continue;
      pairs.push({
        userId: baseline.user_id,
        readiness: baseline.readiness_score,
        baselineKnowledge: baseline.knowledge_readiness,
        outcomeKnowledge: outcome.knowledge_readiness!,
        planAdherence: baseline.plan_adherence,
      });
    }
  }
  return pairs;
}

export function buildReadinessHealth(rows: ReadinessHealthRow[], now = new Date()): ReadinessHealth {
  const pairs = pairReadinessSnapshots(rows, now);
  const users = new Set(pairs.map((pair) => pair.userId)).size;
  const forecastMae = mean(pairs.map((pair) => Math.abs(pair.readiness - pair.outcomeKnowledge)));
  const knowledgeOnlyMae = mean(pairs.map((pair) => Math.abs(pair.baselineKnowledge - pair.outcomeKnowledge)));
  const maeImprovement = forecastMae === null || knowledgeOnlyMae === null ? null : knowledgeOnlyMae - forecastMae;
  const forecastReady = pairs.length >= MINIMUM_FORECAST_PAIRS && users >= MINIMUM_FORECAST_USERS;

  const highAdherence = pairs.filter((pair) => pair.planAdherence !== null && pair.planAdherence >= 0.7);
  const lowAdherence = pairs.filter((pair) => pair.planAdherence !== null && pair.planAdherence < 0.7);
  const highUsers = new Set(highAdherence.map((pair) => pair.userId)).size;
  const lowUsers = new Set(lowAdherence.map((pair) => pair.userId)).size;
  const adherenceReady = highAdherence.length >= MINIMUM_ADHERENCE_PAIRS_PER_GROUP
    && lowAdherence.length >= MINIMUM_ADHERENCE_PAIRS_PER_GROUP
    && highUsers >= MINIMUM_ADHERENCE_USERS_PER_GROUP
    && lowUsers >= MINIMUM_ADHERENCE_USERS_PER_GROUP;
  const highGain = mean(highAdherence.map((pair) => pair.outcomeKnowledge - pair.baselineKnowledge));
  const lowGain = mean(lowAdherence.map((pair) => pair.outcomeKnowledge - pair.baselineKnowledge));
  const gainGap = highGain === null || lowGain === null ? null : highGain - lowGain;

  const bandDefinitions = [
    { id: "low" as const, label: "低準備度", matches: (value: number) => value < 0.4 },
    { id: "medium" as const, label: "中準備度", matches: (value: number) => value >= 0.4 && value < 0.7 },
    { id: "high" as const, label: "高準備度", matches: (value: number) => value >= 0.7 },
  ];
  const bands: ReadinessHealth["bands"] = bandDefinitions.map((definition) => {
    const bandPairs = pairs.filter((pair) => definition.matches(pair.readiness));
    const bandUsers = new Set(bandPairs.map((pair) => pair.userId)).size;
    const ready = bandPairs.length >= MINIMUM_BAND_PAIRS && bandUsers >= MINIMUM_BAND_USERS;
    const predicted = mean(bandPairs.map((pair) => pair.readiness));
    const observed = mean(bandPairs.map((pair) => pair.outcomeKnowledge));
    return {
      id: definition.id,
      label: definition.label,
      pairs: bandPairs.length,
      users: bandUsers,
      predicted_readiness: ready && predicted !== null ? round(predicted) : null,
      observed_knowledge: ready && observed !== null ? round(observed) : null,
      calibration_gap: ready && predicted !== null && observed !== null ? round(predicted - observed) : null,
    };
  });

  let forecastStatus: ReadinessHealth["hypotheses"][number]["status"] = "collecting";
  if (forecastReady && maeImprovement !== null) {
    forecastStatus = maeImprovement >= 0.03 ? "supported" : maeImprovement <= -0.03 ? "rejected" : "neutral";
  }
  let adherenceStatus: ReadinessHealth["hypotheses"][number]["status"] = "collecting";
  if (adherenceReady && gainGap !== null) {
    adherenceStatus = gainGap >= 0.05 ? "supported" : gainGap <= -0.05 ? "rejected" : "neutral";
  }

  return {
    horizon_days: 28,
    paired_snapshots: pairs.length,
    users,
    minimum_pairs: MINIMUM_FORECAST_PAIRS,
    minimum_users: MINIMUM_FORECAST_USERS,
    forecast_mae: forecastReady && forecastMae !== null ? round(forecastMae) : null,
    knowledge_only_mae: forecastReady && knowledgeOnlyMae !== null ? round(knowledgeOnlyMae) : null,
    mae_improvement: forecastReady && maeImprovement !== null ? round(maeImprovement) : null,
    adherence_association: {
      high_pairs: highAdherence.length,
      high_users: highUsers,
      low_pairs: lowAdherence.length,
      low_users: lowUsers,
      high_average_gain: adherenceReady && highGain !== null ? round(highGain) : null,
      low_average_gain: adherenceReady && lowGain !== null ? round(lowGain) : null,
      gain_gap: adherenceReady && gainGap !== null ? round(gainGap) : null,
      minimum_pairs_per_group: MINIMUM_ADHERENCE_PAIRS_PER_GROUP,
      minimum_users_per_group: MINIMUM_ADHERENCE_USERS_PER_GROUP,
    },
    bands,
    hypotheses: [
      {
        id: "P7_GOAL_READINESS",
        label: "準備度は現在習熟度だけより28日後の目標分野習熟度を正確に予測する",
        status: forecastStatus,
        evidence: forecastReady && maeImprovement !== null
          ? `基準比MAE改善 ${round(maeImprovement)}`
          : `${pairs.length}組 / ${users}人`,
      },
      {
        id: "P8_PLAN_ADHERENCE",
        label: "高い計画遵守率は28日後の目標分野習熟度改善と関連する",
        status: adherenceStatus,
        evidence: adherenceReady && gainGap !== null
          ? `習熟度変化差 ${round(gainGap)}`
          : `高遵守${highAdherence.length}組・${highUsers}人 / 低遵守${lowAdherence.length}組・${lowUsers}人`,
      },
    ],
  };
}
