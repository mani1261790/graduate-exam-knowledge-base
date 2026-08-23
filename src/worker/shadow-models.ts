import { clamp } from "./json";

export interface ShadowPredictionInput {
  personalizedPrediction: number;
  baselinePrediction: number;
  predictionConfidence: number;
  evidenceConflict?: boolean;
  personalCalibrationOffset?: number | null;
}

export interface ShadowPrediction {
  candidateVersion: string;
  hypothesisId: string;
  label: string;
  predictedSuccess: number;
}

type NormalizedShadowPredictionInput = {
  personalizedPrediction: number;
  baselinePrediction: number;
  predictionConfidence: number;
  evidenceConflict: boolean;
  personalCalibrationOffset: number | null;
};

type ShadowCandidate = Omit<ShadowPrediction, "predictedSuccess"> & {
  predict: (input: NormalizedShadowPredictionInput) => number | null;
};

const SHADOW_CANDIDATES: readonly ShadowCandidate[] = [
  {
    candidateVersion: "recommendation-v4-shadow-baseline-shrink-v1",
    hypothesisId: "H5_LOW_CONFIDENCE_SHRINKAGE",
    label: "低信頼度を個人ベースラインへ縮約",
    predict: ({ personalizedPrediction, baselinePrediction, predictionConfidence }) =>
      baselinePrediction + predictionConfidence * (personalizedPrediction - baselinePrediction),
  },
  {
    candidateVersion: "recommendation-v4-shadow-center-regularized-v1",
    hypothesisId: "H6_EXTREME_PROBABILITY_REGULARIZATION",
    label: "低信頼度の極端な確率を中央へ正則化",
    predict: ({ personalizedPrediction, predictionConfidence }) =>
      0.5 + (personalizedPrediction - 0.5) * (0.5 + predictionConfidence * 0.5),
  },
  {
    candidateVersion: "recommendation-v4-shadow-conflict-shrink-v1",
    hypothesisId: "H23_CONTRADICTION_AWARE_RECOMMENDATION",
    label: "矛盾した答案証拠を個人ベースラインへ縮約",
    predict: ({ personalizedPrediction, baselinePrediction, evidenceConflict }) =>
      evidenceConflict ? personalizedPrediction + (baselinePrediction - personalizedPrediction) * 0.5 : null,
  },
  {
    candidateVersion: "recommendation-v4-shadow-personal-calibration-v1",
    hypothesisId: "H24_PERSONAL_CALIBRATION",
    label: "本人内の過去誤差で成功確率を校正",
    predict: ({ personalizedPrediction, personalCalibrationOffset }) =>
      personalCalibrationOffset === null ? null : personalizedPrediction + personalCalibrationOffset,
  },
];

export const SHADOW_CANDIDATE_METADATA = SHADOW_CANDIDATES.map(({ predict: _predict, ...candidate }) => candidate);

export function personalCalibrationOffset(observations: number, meanResidual: number): number | null {
  if (!Number.isFinite(observations) || !Number.isFinite(meanResidual) || observations < 10) return null;
  const cappedResidual = clamp(meanResidual, -0.2, 0.2);
  return cappedResidual * (observations / (observations + 20));
}

export function buildShadowPredictions(input: ShadowPredictionInput): ShadowPrediction[] {
  const normalized = {
    personalizedPrediction: clamp(input.personalizedPrediction, 0, 1),
    baselinePrediction: clamp(input.baselinePrediction, 0, 1),
    predictionConfidence: clamp(input.predictionConfidence, 0, 1),
    evidenceConflict: Boolean(input.evidenceConflict),
    personalCalibrationOffset: input.personalCalibrationOffset === null || input.personalCalibrationOffset === undefined
      ? null
      : clamp(input.personalCalibrationOffset, -0.2, 0.2),
  };
  return SHADOW_CANDIDATES.flatMap(({ predict, ...candidate }) => {
    const prediction = predict(normalized);
    return prediction === null ? [] : [{ ...candidate, predictedSuccess: clamp(prediction, 0, 1) }];
  });
}
