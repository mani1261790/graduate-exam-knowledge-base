import { describe, expect, it } from "vitest";
import { buildScheduledDays, conceptSessionMinutes, conservativeNodeMastery, evaluateNodeReadiness, excludePreviouslyScheduledProblems, studyPlanProblemMatchesNode, targetInstitutionMatch } from "../src/worker/study-plan";

describe("study plan algorithm", () => {
  it("blocks a node when a required prerequisite is below the mastery threshold", () => {
    expect(evaluateNodeReadiness(0.2, [{ weight: 0.9, mastery: 0.59 }]).status).toBe("blocked");
    expect(evaluateNodeReadiness(0.2, [{ weight: 0.9, mastery: 0.6 }]).status).toBe("ready");
  });

  it("does not hard-block optional prerequisite edges", () => {
    const result = evaluateNodeReadiness(0.2, [{ weight: 0.7, mastery: 0 }]);
    expect(result).toEqual({ readiness: 1, status: "ready" });
  });

  it("marks mastered nodes complete regardless of remaining prerequisites", () => {
    expect(evaluateNodeReadiness(0.8, [{ weight: 1, mastery: 0.1 }]).status).toBe("completed");
  });

  it("uses a neutral prior for unknown nodes and shrinks sparse observations", () => {
    expect(conservativeNodeMastery(null, 0)).toBe(0.5);
    expect(conservativeNodeMastery(0, 1)).toBe(0.375);
    expect(conservativeNodeMastery(0.2, 20)).toBeCloseTo(0.239, 3);
  });

  it("creates exactly two weeks of the selected weekly cadence", () => {
    const days = buildScheduledDays(new Date("2026-08-02T15:00:00.000Z"), 5);
    expect(days).toHaveLength(10);
    expect(new Set(days).size).toBe(10);
    expect(days[0]).toBe("2026-08-03");
  });

  it("keeps configured session duration available for a consolidated concept session", () => {
    expect(conceptSessionMinutes(115)).toBe(115);
    expect(conceptSessionMinutes(200)).toBe(180);
  });

  it("uses the Japanese calendar day around UTC midnight", () => {
    expect(buildScheduledDays(new Date("2026-08-02T16:00:00.000Z"), 1)[0]).toBe("2026-08-03");
  });

  it("keeps application-domain network questions out of a graph-theory session when focused questions exist", () => {
    expect(studyPlanProblemMatchesNode("グラフ理論", "2023 グラフ理論 2. グラフ探索と到達可能性")).toBe(true);
    expect(studyPlanProblemMatchesNode("グラフ理論", "専門科目 T2. PageRankとグラフ")).toBe(true);
    expect(studyPlanProblemMatchesNode("グラフ理論", "専門科目 B2. 生物群集と生態ネットワーク")).toBe(false);
    expect(studyPlanProblemMatchesNode("グラフ理論", "専門科目 Question B-3. ネットワークと疫学データ")).toBe(false);
  });

  it("matches the focused titles used by the mathematics and systems roadmaps", () => {
    expect(studyPlanProblemMatchesNode("固有値と対角化", "線形代数 2. 固有値と固有ベクトル")).toBe(true);
    expect(studyPlanProblemMatchesNode("オペレーティングシステム", "問3 プロセススケジューリングと仮想記憶")).toBe(true);
    expect(studyPlanProblemMatchesNode("データベース", "関係データベースとSQL")).toBe(true);
    expect(studyPlanProblemMatchesNode("データベース", "生物群集と生態ネットワーク")).toBe(false);
  });

  it("prioritizes the target institution without excluding otherwise relevant problems", () => {
    const target = { target_university: "京都大学", target_graduate_school: "情報学研究科", target_department: null };
    expect(targetInstitutionMatch(target, { university: "京都大学", graduate_school: "情報学研究科", department: null })).toBe(0.85);
    expect(targetInstitutionMatch(target, { university: "京都大学", graduate_school: "工学研究科", department: null })).toBe(0.7);
    expect(targetInstitutionMatch(target, { university: "東京大学", graduate_school: "情報理工学系研究科", department: null })).toBe(0);
  });

  it("does not repeat a problem within the same generated plan", () => {
    expect(excludePreviouslyScheduledProblems([{ id: "first" }, { id: "second" }], new Set(["first"]))).toEqual([{ id: "second" }]);
  });
});
