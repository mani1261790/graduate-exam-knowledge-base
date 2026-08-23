import { clamp } from "./json";
import { nextMastery, relevanceAdjustedEvidence } from "./scoring";

export const MASTERY_CURRENT_MODEL_VERSION = "mastery-v1";
export const MASTERY_DIFFICULTY_SHADOW_VERSION = "mastery-v1-shadow-difficulty-v1";

const TARGET_SCORE_BY_DIFFICULTY: Record<number, number> = { 1: 0.8, 2: 0.68, 3: 0.55, 4: 0.42, 5: 0.3 };

export interface MasteryShadowEvaluationRow {
  user_id: string;
  current_prediction: number;
  candidate_prediction: number;
  observed_score: number;
}

export function targetScoreForDifficulty(difficulty: number): number {
  return TARGET_SCORE_BY_DIFFICULTY[difficulty] ?? 0.55;
}

export function difficultyAdjustedEvidence(score: number, difficulty: number): number {
  const bounded = clamp(score, 0.01, 0.99);
  const target = targetScoreForDifficulty(difficulty);
  const logit = (value: number) => Math.log(value / (1 - value));
  return clamp(1 / (1 + Math.exp(-(logit(bounded) - logit(target)))), 0, 1);
}

export function masteryShadowPredictions(input: {
  previousMastery: number | null | undefined;
  evidenceCount: number;
  rawEvidence: number;
  relevanceWeight: number;
  difficulty: number;
}): { current: number; candidate: number; targetScore: number } {
  const currentEvidence = relevanceAdjustedEvidence(input.rawEvidence, input.previousMastery, input.relevanceWeight);
  const candidateEvidence = relevanceAdjustedEvidence(
    difficultyAdjustedEvidence(input.rawEvidence, input.difficulty),
    input.previousMastery,
    input.relevanceWeight,
  );
  return {
    current: nextMastery(input.previousMastery, currentEvidence, input.evidenceCount),
    candidate: nextMastery(input.previousMastery, candidateEvidence, input.evidenceCount),
    targetScore: targetScoreForDifficulty(input.difficulty),
  };
}

export function buildMasteryShadowHealth(rows: MasteryShadowEvaluationRow[]) {
  const users = new Set(rows.map((row) => row.user_id)).size;
  const ready = rows.length >= 50 && users >= 5;
  const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
  const currentMae = ready ? mean(rows.map((row) => Math.abs(row.current_prediction - row.observed_score))) : null;
  const candidateMae = ready ? mean(rows.map((row) => Math.abs(row.candidate_prediction - row.observed_score))) : null;
  const improvement = currentMae === null || candidateMae === null ? null : currentMae - candidateMae;
  const round = (value: number | null) => value === null ? null : Math.round(value * 1000) / 1000;
  const status = !ready ? "collecting" : improvement! >= 0.02 ? "supported" : improvement! <= -0.02 ? "rejected" : "neutral";
  return {
    model_version: MASTERY_DIFFICULTY_SHADOW_VERSION,
    pairs: rows.length,
    users,
    minimum_pairs: 50,
    minimum_users: 5,
    current_mae: round(currentMae),
    candidate_mae: round(candidateMae),
    mae_improvement: round(improvement),
    status: status as "collecting" | "supported" | "neutral" | "rejected",
    hypothesis: {
      id: "H21_DIFFICULTY_ADJUSTMENT_IMPROVES_MASTERY" as const,
      label: "問題難度で補正した習熟度は次の別問題の達成度をより正確に予測する",
      status: status as "collecting" | "supported" | "neutral" | "rejected",
      evidence: ready ? `MAE改善 ${round(improvement)}` : `${rows.length}組 / ${users}人`,
    },
  };
}
