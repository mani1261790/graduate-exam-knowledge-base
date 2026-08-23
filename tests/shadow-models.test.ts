import { describe, expect, it } from "vitest";
import { buildShadowPredictions, personalCalibrationOffset } from "../src/worker/shadow-models";

describe("shadow prediction candidates", () => {
  it("evaluates two versioned candidates without changing the served prediction", () => {
    const candidates = buildShadowPredictions({
      personalizedPrediction: 0.9,
      baselinePrediction: 0.4,
      predictionConfidence: 0.2,
    });
    expect(candidates).toHaveLength(2);
    expect(new Set(candidates.map((candidate) => candidate.candidateVersion)).size).toBe(2);
    expect(candidates.every((candidate) => candidate.predictedSuccess >= 0 && candidate.predictedSuccess <= 1)).toBe(true);
    expect(candidates.find((candidate) => candidate.hypothesisId === "H5_LOW_CONFIDENCE_SHRINKAGE")?.predictedSuccess).toBeCloseTo(0.5);
    expect(candidates.find((candidate) => candidate.hypothesisId === "H6_EXTREME_PROBABILITY_REGULARIZATION")?.predictedSuccess).toBeCloseTo(0.74);
  });

  it("converges to the current prediction when confidence is complete", () => {
    const candidates = buildShadowPredictions({
      personalizedPrediction: 0.82,
      baselinePrediction: 0.3,
      predictionConfidence: 1,
    });
    for (const candidate of candidates) expect(candidate.predictedSuccess).toBeCloseTo(0.82);
  });

  it("adds the contradiction-aware candidate only for qualified evidence conflict", () => {
    const withoutConflict = buildShadowPredictions({
      personalizedPrediction: 0.9,
      baselinePrediction: 0.4,
      predictionConfidence: 0.8,
    });
    const withConflict = buildShadowPredictions({
      personalizedPrediction: 0.9,
      baselinePrediction: 0.4,
      predictionConfidence: 0.8,
      evidenceConflict: true,
    });
    expect(withoutConflict).toHaveLength(2);
    expect(withConflict).toHaveLength(3);
    expect(withConflict.find((candidate) => candidate.hypothesisId === "H23_CONTRADICTION_AWARE_RECOMMENDATION")?.predictedSuccess).toBeCloseTo(0.65);
  });

  it("withholds personal calibration below 10 outcomes and shrinks a capped residual", () => {
    expect(personalCalibrationOffset(9, 0.18)).toBeNull();
    expect(personalCalibrationOffset(10, 0.3)).toBeCloseTo(0.2 * (10 / 30));
    expect(personalCalibrationOffset(20, -0.4)).toBeCloseTo(-0.1);
  });

  it("adds personal calibration without changing any served prediction", () => {
    const candidates = buildShadowPredictions({
      personalizedPrediction: 0.6,
      baselinePrediction: 0.5,
      predictionConfidence: 0.8,
      personalCalibrationOffset: 0.08,
    });
    expect(candidates).toHaveLength(3);
    expect(candidates.find((candidate) => candidate.hypothesisId === "H24_PERSONAL_CALIBRATION")?.predictedSuccess).toBeCloseTo(0.68);
  });

  it("clamps malformed numeric inputs to probability bounds", () => {
    const candidates = buildShadowPredictions({
      personalizedPrediction: 4,
      baselinePrediction: -2,
      predictionConfidence: -1,
    });
    expect(candidates.every((candidate) => candidate.predictedSuccess >= 0 && candidate.predictedSuccess <= 1)).toBe(true);
  });
});
