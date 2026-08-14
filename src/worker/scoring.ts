import { clamp } from "./json";
import type { AttemptInput, RecommendationMode } from "./domain";

const ATTEMPT_RESULTS = ["not_checked", "correct", "partial", "wrong", "skipped"] as const;
const MISTAKE_TYPES = ["concept_missing", "formula_missing", "calculation_error", "proof_gap", "misread_problem", "time_over", "implementation_error", "unknown"] as const;

export function attemptInputError(input: unknown): string | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return "学習記録の形式が正しくありません。";
  const candidate = input as Partial<AttemptInput>;
  if (typeof candidate.problem_id !== "string" || !candidate.problem_id.trim() || candidate.problem_id.length > 200) return "問題IDが正しくありません。";
  if (!candidate.result || !ATTEMPT_RESULTS.includes(candidate.result)) return "結果を選んでください。";
  if (candidate.result === "not_checked") return "結果を選んでから保存してください。";
  if (candidate.started_at !== undefined && (typeof candidate.started_at !== "string" || !Number.isFinite(Date.parse(candidate.started_at)))) return "開始時刻が正しくありません。";
  if (candidate.time_spent_minutes !== undefined && (!Number.isInteger(candidate.time_spent_minutes) || candidate.time_spent_minutes < 0 || candidate.time_spent_minutes > 1_440)) return "所要時間は0〜1440分で入力してください。";
  if (candidate.score_rate !== undefined && (!Number.isFinite(candidate.score_rate) || candidate.score_rate < 0 || candidate.score_rate > 1)) return "達成度は0〜1で入力してください。";
  if (candidate.self_confidence !== undefined && (!Number.isInteger(candidate.self_confidence) || candidate.self_confidence < 1 || candidate.self_confidence > 5)) return "自信度は1〜5で入力してください。";
  if (candidate.note !== undefined && (typeof candidate.note !== "string" || candidate.note.length > 2_000)) return "復習メモは2000文字以内で入力してください。";
  if (candidate.mistakes !== undefined) {
    if (!Array.isArray(candidate.mistakes) || candidate.mistakes.length > 20) return "つまずきは20件以内で入力してください。";
    for (const mistake of candidate.mistakes) {
      if (!mistake || typeof mistake !== "object" || !MISTAKE_TYPES.includes(mistake.mistake_type)) return "つまずきの種類が正しくありません。";
      if (mistake.concept_id !== undefined && (typeof mistake.concept_id !== "string" || !mistake.concept_id || mistake.concept_id.length > 200)) return "つまずいた分野が正しくありません。";
      if (mistake.note !== undefined && (typeof mistake.note !== "string" || mistake.note.length > 500)) return "つまずきメモは500文字以内で入力してください。";
    }
  }
  return null;
}

export interface MasteryUpdateInput {
  result: "not_checked" | "correct" | "partial" | "wrong" | "skipped";
  scoreRate?: number | null;
  usedHint: boolean;
  lookedSolution: boolean;
  timeSpentMinutes?: number | null;
  estimatedMinutes: number;
  previousMastery?: number | null;
  mistakePenaltyCount: number;
}

export function effectiveScore(input: MasteryUpdateInput): number {
  const baseByResult = {
    not_checked: 0.5,
    correct: 1.0,
    partial: 0.6,
    wrong: 0.2,
    skipped: 0.0,
  };
  let score = input.scoreRate ?? baseByResult[input.result];
  if (input.usedHint) score -= 0.1;
  if (input.lookedSolution) score -= 0.2;
  if (input.timeSpentMinutes && input.timeSpentMinutes > input.estimatedMinutes * 2) score -= 0.1;
  score -= input.mistakePenaltyCount * 0.05;
  return clamp(score, 0, 1);
}

export function nextMastery(previous: number | null | undefined, evidence: number): number {
  if (previous === null || previous === undefined) return evidence;
  return clamp(previous * 0.75 + evidence * 0.25, 0, 1);
}

export function reviewDueIso(score: number, now = new Date()): string {
  const due = new Date(now);
  if (score >= 0.8) {
    due.setDate(due.getDate() + 7);
  } else if (score >= 0.5) {
    due.setDate(due.getDate() + 3);
  } else {
    due.setDate(due.getDate() + 1);
  }
  return due.toISOString();
}

export function conceptJaccard(left: string[], right: string[]): number {
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  if (leftSet.size === 0 && rightSet.size === 0) return 0;
  let intersection = 0;
  for (const item of leftSet) {
    if (rightSet.has(item)) intersection += 1;
  }
  return intersection / new Set([...leftSet, ...rightSet]).size;
}

export function similarProblemScore(input: {
  conceptScore: number;
  vectorScore: number;
  solutionPatternScore: number;
  difficultyA: number;
  difficultyB: number;
}): number {
  const difficultyNearness = 1 - Math.abs(input.difficultyA - input.difficultyB) / 4;
  return clamp(
    input.conceptScore * 0.45 +
      input.vectorScore * 0.3 +
      input.solutionPatternScore * 0.15 +
      difficultyNearness * 0.1,
    0,
    1,
  );
}

export function recommendationScore(input: {
  weakness: number;
  targetMatch: number;
  prerequisiteReadiness: number;
  reviewDue: number;
  similarConnection: number;
}): number {
  return clamp(
    input.weakness * 0.35 +
      input.targetMatch * 0.25 +
      input.prerequisiteReadiness * 0.2 +
      input.reviewDue * 0.1 +
      input.similarConnection * 0.1,
    0,
    1,
  );
}

export interface RecommendationModeInput {
  difficulty: number;
  weakness: number;
  targetMatch: number;
  prerequisiteReadiness: number;
  reviewDue: number;
  hasAttempt: boolean;
  recentlyMastered: boolean;
}

export function recommendationModeEligible(mode: RecommendationMode, input: RecommendationModeInput): boolean {
  if (mode === "review") return input.reviewDue > 0 || input.hasAttempt;
  if (input.recentlyMastered) return false;
  if (mode === "foundation") return input.difficulty <= 2 || input.prerequisiteReadiness < 0.5;
  if (mode === "challenge") return input.difficulty >= 4 && input.prerequisiteReadiness >= 0.5;
  return input.difficulty >= 2 && input.difficulty <= 3 && input.prerequisiteReadiness >= 0.35 && input.reviewDue === 0;
}

export function recommendationModeScore(mode: RecommendationMode, input: RecommendationModeInput): number {
  const normalizedDifficulty = clamp((input.difficulty - 1) / 4, 0, 1);
  if (mode === "review") {
    return clamp(input.reviewDue * 0.5 + (input.hasAttempt ? 0.2 : 0) + input.weakness * 0.3, 0, 1);
  }
  if (mode === "foundation") {
    return clamp((1 - input.prerequisiteReadiness) * 0.4 + (1 - normalizedDifficulty) * 0.25 + input.weakness * 0.2 + input.targetMatch * 0.15, 0, 1);
  }
  if (mode === "challenge") {
    return clamp(normalizedDifficulty * 0.4 + input.prerequisiteReadiness * 0.3 + input.targetMatch * 0.2 + input.weakness * 0.1, 0, 1);
  }
  return recommendationScore({
    weakness: input.weakness,
    targetMatch: input.targetMatch,
    prerequisiteReadiness: input.prerequisiteReadiness,
    reviewDue: input.reviewDue,
    similarConnection: 0.3,
  });
}

const ACADEMIC_FIELD_KEYWORDS = [
  ["情報工学", "情報科学", "情報理工", "コンピュータ", "計算機", "ソフトウェア", "データ", "知能", "AI", "アルゴリズム", "グラフ", "プログラミング", "論理"],
  ["電気", "電子", "通信", "制御", "信号"],
  ["機械", "ロボット", "航空"],
  ["数学", "数理", "統計"],
  ["物理", "応用物理"],
  ["化学", "材料", "物質"],
  ["生命", "生物", "医学"],
] as const;

export function academicFieldMatch(userDepartment: string | null | undefined, fields: Array<string | null | undefined>): number {
  const user = userDepartment?.trim().toLowerCase();
  if (!user) return 0.5;
  const target = fields.filter(Boolean).join(" ").toLowerCase();
  if (!target) return 0.5;
  if (target.includes(user) || user.includes(target)) return 1;

  for (const group of ACADEMIC_FIELD_KEYWORDS) {
    const userMatches = group.some((keyword) => user.includes(keyword.toLowerCase()));
    const targetMatches = group.some((keyword) => target.includes(keyword.toLowerCase()));
    if (userMatches && targetMatches) return 0.9;
  }
  return 0.15;
}
