import { describe, expect, it } from "vitest";
import { buildMasteryShadowHealth, difficultyAdjustedEvidence, masteryShadowPredictions } from "../src/worker/mastery-shadow";

describe("difficulty-adjusted mastery shadow", () => {
  it("treats the same score as stronger evidence on a harder item", () => {
    expect(difficultyAdjustedEvidence(0.7, 5)).toBeGreaterThan(difficultyAdjustedEvidence(0.7, 1));
  });

  it("keeps the production prediction separate from the candidate", () => {
    const result = masteryShadowPredictions({ previousMastery: 0.5, evidenceCount: 3, rawEvidence: 0.8, relevanceWeight: 1, difficulty: 5 });
    expect(result.current).toBeCloseTo(0.575);
    expect(result.candidate).toBeGreaterThan(result.current);
    expect(result.targetScore).toBe(0.3);
  });

  it("suppresses conclusions below 50 pairs and five users", () => {
    const rows = Array.from({ length: 49 }, (_, index) => ({ user_id: `u${index % 5}`, current_prediction: 0.5, candidate_prediction: 0.7, observed_score: 0.7 }));
    expect(buildMasteryShadowHealth(rows)).toMatchObject({ status: "collecting", current_mae: null, candidate_mae: null });
  });

  it("supports the candidate only after a paired improvement", () => {
    const rows = Array.from({ length: 50 }, (_, index) => ({ user_id: `u${index % 5}`, current_prediction: 0.5, candidate_prediction: 0.68, observed_score: 0.7 }));
    expect(buildMasteryShadowHealth(rows)).toMatchObject({ status: "supported", current_mae: 0.2, candidate_mae: 0.02, mae_improvement: 0.18 });
  });
});
