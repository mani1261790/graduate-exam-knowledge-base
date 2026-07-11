import { describe, expect, it } from "vitest";
import { academicFieldMatch, conceptJaccard, effectiveScore, nextMastery, recommendationModeEligible, recommendationModeScore, recommendationScore, similarProblemScore } from "../src/worker/scoring";

describe("scoring", () => {
  it("matches information engineering users with computing departments", () => {
    expect(academicFieldMatch("情報工学科", ["情報理工学系研究科", "コンピュータ科学"])).toBe(0.9);
    expect(academicFieldMatch("情報工学科", ["生命科学研究科", "生物学"])).toBe(0.15);
    expect(academicFieldMatch("情報工学科", ["生命医科学専攻", "外国語（英語）"])).toBe(0.15);
    expect(academicFieldMatch(null, ["情報科学研究科"])).toBe(0.5);
  });
  it("updates mastery with the configured exponential moving average", () => {
    expect(nextMastery(null, 0.8)).toBe(0.8);
    expect(nextMastery(0.4, 0.8)).toBeCloseTo(0.5);
  });

  it("penalizes hints, solution views, overtime, and mistakes", () => {
    expect(
      effectiveScore({
        result: "correct",
        usedHint: true,
        lookedSolution: true,
        timeSpentMinutes: 50,
        estimatedMinutes: 20,
        mistakePenaltyCount: 1,
      }),
    ).toBeCloseTo(0.55);
  });

  it("computes similar-problem score from the MVP weights", () => {
    expect(
      similarProblemScore({
        conceptScore: 1,
        vectorScore: 0.5,
        solutionPatternScore: 0.5,
        difficultyA: 3,
        difficultyB: 4,
      }),
    ).toBeCloseTo(0.75);
  });

  it("computes recommendation score from the MVP weights", () => {
    expect(
      recommendationScore({
        weakness: 1,
        targetMatch: 0.5,
        prerequisiteReadiness: 0.75,
        reviewDue: 1,
        similarConnection: 0.2,
      }),
    ).toBeCloseTo(0.745);
  });

  it("separates recommendation modes by learning purpose", () => {
    const base = {
      difficulty: 2,
      weakness: 0.6,
      targetMatch: 0.9,
      prerequisiteReadiness: 0.7,
      reviewDue: 0,
      hasAttempt: false,
      recentlyMastered: false,
    };
    expect(recommendationModeEligible("foundation", base)).toBe(true);
    expect(recommendationModeEligible("challenge", base)).toBe(false);
    expect(recommendationModeEligible("review", base)).toBe(false);
    expect(recommendationModeEligible("challenge", { ...base, difficulty: 5 })).toBe(true);
    expect(recommendationModeEligible("review", { ...base, hasAttempt: true })).toBe(true);
    expect(recommendationModeScore("foundation", base)).not.toBe(recommendationModeScore("challenge", { ...base, difficulty: 5 }));
  });

  it("computes concept Jaccard", () => {
    expect(conceptJaccard(["a", "b"], ["b", "c"])).toBeCloseTo(1 / 3);
  });
});
