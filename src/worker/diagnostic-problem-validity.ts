export const DIAGNOSTIC_PROBLEM_VALIDITY_MODEL_VERSION = "diagnostic-problem-validity-v1";

export interface DiagnosticProblemValidityItemRow {
  content_id: string;
  problem_id: string;
  problem_label: string;
  difficulty: number;
  content_revision?: number;
}

export interface DiagnosticProblemValidityAttemptRow {
  problem_id: string;
  user_id: string;
  score_rate: number;
  anchor_score: number | null;
}

export type DiagnosticProblemCalibrationDecision = "mastery_enabled" | "monitor_only";
export type DiagnosticProblemCalibrationStatus = "candidate" | "approved" | "rejected" | "superseded";

export interface DiagnosticProblemCalibrationRow {
  id: string;
  content_id: string;
  content_revision: number;
  validity_model_version: string;
  snapshot_key: string;
  users: number;
  paired_users: number;
  mean_score: number | null;
  score_stddev: number | null;
  anchor_correlation: number | null;
  target_score: number;
  observed_status: "healthy" | "watch" | "halt_candidate";
  decision: DiagnosticProblemCalibrationDecision;
  rationale: string;
  status: DiagnosticProblemCalibrationStatus;
  proposed_by: string;
  reviewed_by: string | null;
  review_note: string | null;
  created_at: string;
  reviewed_at: string | null;
  valid_until: string | null;
}

export interface DiagnosticProblemCalibrationInput {
  decision: DiagnosticProblemCalibrationDecision;
  rationale: string;
  expected_snapshot_key: string;
}

export interface DiagnosticProblemValidity {
  model_version: string;
  summary: {
    approved_items: number;
    collecting_items: number;
    healthy_items: number;
    watch_items: number;
    halt_candidate_items: number;
    minimum_users: number;
    minimum_paired_users: number;
    stable_halt_users: number;
    stable_halt_paired_users: number;
  };
  items: Array<{
    content_id: string;
    problem_id: string;
    problem_label: string;
    difficulty: number;
    content_revision: number;
    users: number;
    paired_users: number;
    mean_score: number | null;
    score_stddev: number | null;
    anchor_correlation: number | null;
    target_score: number;
    difficulty_deviation: number | null;
    status: "collecting" | "healthy" | "watch" | "halt_candidate";
    reasons: string[];
    snapshot_key: string;
    calibration: {
      active: DiagnosticProblemCalibrationRow | null;
      pending: DiagnosticProblemCalibrationRow | null;
    };
  }>;
  hypothesis: {
    id: "H19_ORIGINAL_ITEMS_ARE_EMPIRICALLY_VALID";
    label: string;
    status: "collecting" | "supported" | "neutral" | "rejected";
    evidence: string;
  };
}

const MINIMUM_USERS = 30;
const MINIMUM_PAIRED_USERS = 20;
const STABLE_HALT_USERS = 100;
const STABLE_HALT_PAIRED_USERS = 60;
const TARGET_SCORE_BY_DIFFICULTY: Record<number, number> = { 1: 0.8, 2: 0.68, 3: 0.55, 4: 0.42, 5: 0.3 };

function round(value: number, digits = 3): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function mean(values: number[]): number | null {
  return values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function standardDeviation(values: number[]): number | null {
  const average = mean(values);
  if (average === null || values.length < 2) return null;
  return Math.sqrt(values.reduce((sum, value) => sum + (value - average) ** 2, 0) / values.length);
}

function pearson(pairs: Array<[number, number]>): number | null {
  if (pairs.length < 2) return null;
  const xs = pairs.map(([x]) => x);
  const ys = pairs.map(([, y]) => y);
  const xMean = mean(xs)!;
  const yMean = mean(ys)!;
  const numerator = pairs.reduce((sum, [x, y]) => sum + (x - xMean) * (y - yMean), 0);
  const denominator = Math.sqrt(
    xs.reduce((sum, x) => sum + (x - xMean) ** 2, 0)
    * ys.reduce((sum, y) => sum + (y - yMean) ** 2, 0),
  );
  return denominator <= Number.EPSILON ? null : numerator / denominator;
}

export function diagnosticProblemValiditySnapshotKey(input: {
  content_id: string;
  content_revision: number;
  users: number;
  paired_users: number;
  mean_score: number | null;
  score_stddev: number | null;
  anchor_correlation: number | null;
  status: "collecting" | "healthy" | "watch" | "halt_candidate";
}): string {
  return [
    DIAGNOSTIC_PROBLEM_VALIDITY_MODEL_VERSION,
    input.content_id,
    `r${input.content_revision}`,
    `u${input.users}`,
    `p${input.paired_users}`,
    `m${input.mean_score ?? "null"}`,
    `s${input.score_stddev ?? "null"}`,
    `c${input.anchor_correlation ?? "null"}`,
    input.status,
  ].join(":");
}

export function diagnosticProblemCalibrationInputError(
  input: unknown,
  current: DiagnosticProblemValidity["items"][number],
): string | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return "校正判断の形式が正しくありません。";
  const candidate = input as Partial<DiagnosticProblemCalibrationInput>;
  if (candidate.decision !== "mastery_enabled" && candidate.decision !== "monitor_only") return "校正判断を選んでください。";
  if (typeof candidate.rationale !== "string" || candidate.rationale.trim().length < 20 || candidate.rationale.trim().length > 1000) {
    return "判断理由は20〜1000文字で入力してください。";
  }
  if (typeof candidate.expected_snapshot_key !== "string" || candidate.expected_snapshot_key !== current.snapshot_key) {
    return "観測結果が更新されています。最新値を読み直してください。";
  }
  if (current.status === "collecting") return "一次判定の標本条件を満たすまで校正判断を作成できません。";
  if (candidate.decision === "mastery_enabled" && current.status !== "healthy") {
    return "習熟度への反映は健全判定の問題だけ有効化できます。";
  }
  return null;
}

export function buildDiagnosticProblemValidity(
  items: DiagnosticProblemValidityItemRow[],
  attempts: DiagnosticProblemValidityAttemptRow[],
  calibrationRows: DiagnosticProblemCalibrationRow[] = [],
): DiagnosticProblemValidity {
  const results: DiagnosticProblemValidity["items"] = items.map((item) => {
    const itemRows = attempts.filter((row) => row.problem_id === item.problem_id && Number.isFinite(row.score_rate));
    const scores = itemRows.map((row) => Number(row.score_rate));
    const pairs = itemRows.flatMap((row): Array<[number, number]> => Number.isFinite(row.anchor_score)
      ? [[Number(row.score_rate), Number(row.anchor_score)]] : []);
    const average = mean(scores);
    const deviation = average === null ? null : average - (TARGET_SCORE_BY_DIFFICULTY[item.difficulty] ?? 0.55);
    const stddev = standardDeviation(scores);
    const correlation = pearson(pairs);
    const enough = itemRows.length >= MINIMUM_USERS && pairs.length >= MINIMUM_PAIRED_USERS;
    const reasons: string[] = [];
    if (!enough) {
      if (itemRows.length < MINIMUM_USERS) reasons.push(`受験者が${MINIMUM_USERS}人未満です`);
      if (pairs.length < MINIMUM_PAIRED_USERS) reasons.push(`同一概念の事前成績を持つ受験者が${MINIMUM_PAIRED_USERS}人未満です`);
    } else {
      if (correlation === null) reasons.push("得点分散がなく識別相関を算出できません");
      else if (correlation < 0.15) reasons.push("同一概念の事前成績との識別相関が0.15未満です");
      if (deviation !== null && Math.abs(deviation) > 0.2) reasons.push("設計難度から平均得点が20ポイント超ずれています");
      if (stddev !== null && stddev < 0.15) reasons.push("得点分散が小さく受験者を識別しにくい状態です");
    }
    const stable = itemRows.length >= STABLE_HALT_USERS && pairs.length >= STABLE_HALT_PAIRED_USERS;
    const severe = stable && (correlation === null || correlation < 0 || (deviation !== null && Math.abs(deviation) > 0.35) || (stddev !== null && stddev < 0.08));
    const status: DiagnosticProblemValidity["items"][number]["status"] = !enough
      ? "collecting" : severe ? "halt_candidate" : reasons.length > 0 ? "watch" : "healthy";
    const contentRevision = Number(item.content_revision ?? 1);
    const snapshotBase = {
      ...item,
      difficulty: Number(item.difficulty),
      content_revision: contentRevision,
      users: itemRows.length,
      paired_users: pairs.length,
      mean_score: average === null ? null : round(average),
      score_stddev: stddev === null ? null : round(stddev),
      anchor_correlation: correlation === null ? null : round(correlation),
      target_score: TARGET_SCORE_BY_DIFFICULTY[item.difficulty] ?? 0.55,
      difficulty_deviation: deviation === null ? null : round(deviation),
      status,
      reasons,
    };
    return {
      ...snapshotBase,
      snapshot_key: diagnosticProblemValiditySnapshotKey(snapshotBase),
      calibration: {
        active: calibrationRows.find((row) => row.content_id === item.content_id && row.status === "approved") ?? null,
        pending: calibrationRows.find((row) => row.content_id === item.content_id && row.status === "candidate") ?? null,
      },
    };
  }).sort((left, right) => {
    const priority = { halt_candidate: 0, watch: 1, collecting: 2, healthy: 3 } as const;
    return priority[left.status] - priority[right.status] || left.problem_label.localeCompare(right.problem_label, "ja");
  });
  const mature = results.filter((item) => item.status !== "collecting");
  const healthy = mature.filter((item) => item.status === "healthy").length;
  const healthyRate = mature.length === 0 ? null : healthy / mature.length;
  const hypothesisStatus = mature.length < 5 || healthyRate === null
    ? "collecting" : healthyRate >= 0.8 ? "supported" : healthyRate < 0.5 ? "rejected" : "neutral";
  return {
    model_version: DIAGNOSTIC_PROBLEM_VALIDITY_MODEL_VERSION,
    summary: {
      approved_items: results.length,
      collecting_items: results.filter((item) => item.status === "collecting").length,
      healthy_items: healthy,
      watch_items: results.filter((item) => item.status === "watch").length,
      halt_candidate_items: results.filter((item) => item.status === "halt_candidate").length,
      minimum_users: MINIMUM_USERS,
      minimum_paired_users: MINIMUM_PAIRED_USERS,
      stable_halt_users: STABLE_HALT_USERS,
      stable_halt_paired_users: STABLE_HALT_PAIRED_USERS,
    },
    items: results,
    hypothesis: {
      id: "H19_ORIGINAL_ITEMS_ARE_EMPIRICALLY_VALID",
      label: "承認済みオリジナル問題は設計難度どおりに受験者を識別する",
      status: hypothesisStatus,
      evidence: mature.length < 5 || healthyRate === null
        ? `判定可能 ${mature.length}/5問（承認済み ${results.length}問）`
        : `健全 ${healthy}/${mature.length}問（${Math.round(healthyRate * 100)}%）`,
    },
  };
}
