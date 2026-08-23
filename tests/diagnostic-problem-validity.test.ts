import { describe, expect, it } from "vitest";
import { buildDiagnosticProblemValidity, type DiagnosticProblemValidityAttemptRow } from "../src/worker/diagnostic-problem-validity";

const item = { content_id: "content-1", problem_id: "problem-1", problem_label: "識別力検証問題", difficulty: 3 };

function rows(count: number, relation: "positive" | "negative" | "flat" = "positive"): DiagnosticProblemValidityAttemptRow[] {
  return Array.from({ length: count }, (_, index) => {
    const anchor = (index % 10) / 9;
    const score = relation === "positive" ? anchor : relation === "negative" ? 1 - anchor : 0.5;
    return { problem_id: item.problem_id, user_id: `user-${index}`, score_rate: score, anchor_score: anchor };
  });
}

describe("original diagnostic problem empirical validity", () => {
  it("suppresses empirical conclusions below both sample thresholds", () => {
    const result = buildDiagnosticProblemValidity([item], rows(19));
    expect(result.items[0]).toMatchObject({ status: "collecting", users: 19, paired_users: 19, anchor_correlation: 1 });
    expect(result.hypothesis.status).toBe("collecting");
  });

  it("marks a sufficiently varied and discriminating item healthy", () => {
    const result = buildDiagnosticProblemValidity([item], rows(30));
    expect(result.items[0]).toMatchObject({ status: "healthy", users: 30, anchor_correlation: 1 });
  });

  it("uses a stricter stable threshold before suggesting a halt", () => {
    expect(buildDiagnosticProblemValidity([item], rows(30, "negative")).items[0].status).toBe("watch");
    expect(buildDiagnosticProblemValidity([item], rows(100, "negative")).items[0].status).toBe("halt_candidate");
  });

  it("flags a zero-variance item without inventing a correlation", () => {
    const result = buildDiagnosticProblemValidity([item], rows(30, "flat"));
    expect(result.items[0]).toMatchObject({ status: "watch", anchor_correlation: null, score_stddev: 0 });
  });

  it("requires five mature items before deciding the portfolio hypothesis", () => {
    const items = Array.from({ length: 5 }, (_, index) => ({ ...item, content_id: `content-${index}`, problem_id: `problem-${index}` }));
    const attempts = items.flatMap((current) => rows(30).map((row) => ({ ...row, problem_id: current.problem_id, user_id: `${current.problem_id}-${row.user_id}` })));
    expect(buildDiagnosticProblemValidity(items, attempts).hypothesis.status).toBe("supported");
  });
});
