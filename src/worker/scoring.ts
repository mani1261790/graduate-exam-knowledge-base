import { clamp } from "./json";

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

const ACADEMIC_FIELD_KEYWORDS = [
  ["情報", "コンピュータ", "計算機", "ソフトウェア", "データ", "知能", "AI", "アルゴリズム"],
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
