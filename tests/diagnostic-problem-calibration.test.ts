import { describe, expect, it } from "vitest";
import {
  buildDiagnosticProblemValidity,
  diagnosticProblemCalibrationInputError,
  diagnosticProblemValiditySnapshotKey,
  type DiagnosticProblemCalibrationRow,
  type DiagnosticProblemValidityAttemptRow,
} from "../src/worker/diagnostic-problem-validity";

const item = {
  content_id: "content-calibration",
  problem_id: "problem-calibration",
  problem_label: "校正対象問題",
  difficulty: 3,
  content_revision: 4,
};

function healthyRows(count = 30): DiagnosticProblemValidityAttemptRow[] {
  return Array.from({ length: count }, (_, index) => {
    const value = (index % 10) / 9;
    return { problem_id: item.problem_id, user_id: `user-${index}`, score_rate: value, anchor_score: value };
  });
}

function calibration(status: "candidate" | "approved"): DiagnosticProblemCalibrationRow {
  const current = buildDiagnosticProblemValidity([item], healthyRows()).items[0];
  return {
    id: `calibration-${status}`,
    content_id: item.content_id,
    content_revision: item.content_revision,
    validity_model_version: "diagnostic-problem-validity-v1",
    snapshot_key: current.snapshot_key,
    users: current.users,
    paired_users: current.paired_users,
    mean_score: current.mean_score,
    score_stddev: current.score_stddev,
    anchor_correlation: current.anchor_correlation,
    target_score: current.target_score,
    observed_status: "healthy",
    decision: "mastery_enabled",
    rationale: "難度・得点分散・識別相関がすべて基準内であり、習熟度の証拠として利用できます。",
    status,
    proposed_by: "reviewer-1",
    reviewed_by: status === "approved" ? "admin-1" : null,
    review_note: status === "approved" ? "別担当として標本と観測指標を再確認しました。" : null,
    created_at: "2026-08-23T00:00:00.000Z",
    reviewed_at: status === "approved" ? "2026-08-24T00:00:00.000Z" : null,
    valid_until: status === "approved" ? "2026-11-22T00:00:00.000Z" : null,
  };
}

describe("original problem calibration governance", () => {
  it("binds the snapshot key to the content revision and observed sample", () => {
    const base = buildDiagnosticProblemValidity([item], healthyRows()).items[0];
    expect(diagnosticProblemValiditySnapshotKey(base)).toBe(base.snapshot_key);
    expect(diagnosticProblemValiditySnapshotKey({ ...base, content_revision: 5 })).not.toBe(base.snapshot_key);
    expect(diagnosticProblemValiditySnapshotKey({ ...base, users: 31 })).not.toBe(base.snapshot_key);
  });

  it("rejects calibration while the empirical sample is still collecting", () => {
    const current = buildDiagnosticProblemValidity([item], healthyRows(19)).items[0];
    expect(diagnosticProblemCalibrationInputError({
      decision: "monitor_only",
      rationale: "標本条件を満たしていないため観測のみとする判断です。",
      expected_snapshot_key: current.snapshot_key,
    }, current)).toContain("標本条件");
  });

  it("allows mastery evidence only as a proposal for a healthy snapshot", () => {
    const current = buildDiagnosticProblemValidity([item], healthyRows()).items[0];
    expect(diagnosticProblemCalibrationInputError({
      decision: "mastery_enabled",
      rationale: "難度・得点分散・識別相関がすべて基準内であり、習熟度へ反映できます。",
      expected_snapshot_key: current.snapshot_key,
    }, current)).toBeNull();
    expect(diagnosticProblemCalibrationInputError({
      decision: "mastery_enabled",
      rationale: "観測上の問題が残るため、この状態では習熟度へ反映できません。",
      expected_snapshot_key: current.snapshot_key,
    }, { ...current, status: "watch" })).toContain("健全判定");
  });

  it("rejects stale client snapshots", () => {
    const current = buildDiagnosticProblemValidity([item], healthyRows()).items[0];
    expect(diagnosticProblemCalibrationInputError({
      decision: "monitor_only",
      rationale: "最新の観測結果を確認したうえで監視のみとする運用判断です。",
      expected_snapshot_key: `${current.snapshot_key}-stale`,
    }, current)).toContain("更新");
  });

  it("returns active and pending decisions separately", () => {
    const result = buildDiagnosticProblemValidity([item], healthyRows(), [calibration("approved"), calibration("candidate")]);
    expect(result.items[0].calibration.active?.status).toBe("approved");
    expect(result.items[0].calibration.pending?.status).toBe("candidate");
  });
});
