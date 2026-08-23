import { describe, expect, it } from "vitest";
import {
  buildDiagnosticProblemAuthoringQueue,
  defaultDiagnosticProblemContent,
  fingerprintDiagnosticProblemContent,
  validateDiagnosticProblemContent,
  validateDiagnosticVerificationResults,
  type DiagnosticProblemBlueprintContext,
  type DiagnosticProblemContentInput,
  type DiagnosticProblemContentRow,
} from "../src/worker/diagnostic-problem-content";

const blueprint: DiagnosticProblemBlueprintContext = {
  id: "blueprint-1",
  graph_node_id: "node-1",
  slot: 1,
  title: "線形代数 オリジナル診断仕様",
  assessment_objective: "線形写像の核と像を未知の条件へ適用し、根拠を説明できるかを測定する。",
  evidence_expectation: "定義の選択、次元定理の適用、結論の検算を独立して観測する。",
  cognitive_demand: "concept_application",
  answer_format: "derivation",
  difficulty: 2,
  estimated_minutes: 30,
  rubric: [
    { label: "定義の選択", weight: 0.3 },
    { label: "導出過程", weight: 0.4 },
    { label: "結論と検算", weight: 0.3 },
  ],
  misconception_targets: ["核と零空間を異なる概念として扱う"],
  status: "approved",
};

function validInput(): DiagnosticProblemContentInput {
  return {
    problem_label: "線形写像の核と像を用いるオリジナル診断問題",
    statement_text: "実数ベクトル空間上の線形写像Tを考える。与えられた基底に関する表現行列と像の生成条件を用いて、核の基底と像の次元を求め、次元定理で結果を検算せよ。途中で用いた定義と各変形の根拠も明記すること。",
    answer_text: "表現行列を行基本変形し、自由変数を一つ得るので核の基底は指定したベクトルとなる。階数は二であり像の次元は二、核の次元との和は定義域の次元三に一致する。",
    explanation_text: "まず線形写像の核を連立一次方程式の解空間として表す。次に行基本変形から主変数と自由変数を分け、核の基底を構成する。ピボット列から像の基底候補を選び、階数を二と確認する。最後に次元定理により核の次元一と像の次元二の和が定義域の次元三になることを確認する。",
    scoring_examples: [
      {
        level: "full_credit",
        response: "核を方程式の解空間として求め、像の基底と次元を示し、次元定理でも検算した答案。",
        score_rate: 1,
        criterion_scores: blueprint.rubric.map(({ label }) => ({ label, score: 1 })),
        rationale: "三つの採点基準をすべて満たし、途中の根拠と最終検算まで一貫しているため満点とする。",
      },
      {
        level: "partial_credit",
        response: "行基本変形と核の基底は正しいが、像の説明と次元定理による検算を省略した答案。",
        score_rate: 0.5,
        criterion_scores: [
          { label: "定義の選択", score: 1 },
          { label: "導出過程", score: 0.5 },
          { label: "結論と検算", score: 0 },
        ],
        rationale: "定義と途中計算には得点を与えるが、像の結論と検算がないため対応する基準は得点なしとする。",
      },
      {
        level: "no_credit",
        response: "行列の成分をそのまま核の基底だとみなし、根拠なく次元を三とした答案。",
        score_rate: 0,
        criterion_scores: blueprint.rubric.map(({ label }) => ({ label, score: 0 })),
        rationale: "定義、導出、検算のいずれも成立せず、想定誤答を識別できる典型例なので得点なしとする。",
      },
    ],
    adversarial_checks: [
      { type: "ambiguity", finding: "基底と行列の対応順が一意に読めるか、記号の定義漏れを含めて確認した。", resolution: "基底の順序と行列の作用方向を問題文に明記し、解釈が一意になるよう修正した。" },
      { type: "answer_leakage", finding: "問題文中の数値や誘導が核の次元を直接知らせていないことを確認した。", resolution: "次元そのものは提示せず、受験者が行基本変形から導く条件だけを残した。" },
      { type: "misconception_discrimination", finding: "核と像を取り違える誤概念が答案と採点例で区別できることを確認した。", resolution: "核の方程式化と像の基底選択を別採点項目にし、取り違えを個別に検出できるようにした。" },
    ],
    verification_cases: [
      { type: "independent_recalculation", instruction: "表現行列を模範解答とは独立に行基本変形し、核と階数を再計算する。", expected_result: "核の次元は一、像の次元は二となる。", tolerance: null },
      { type: "boundary_case", instruction: "得られた核の基底ベクトルと零ベクトルを写像へ代入し、出力を直接確認する。", expected_result: "どちらも零ベクトルへ写り、非零の基底は核に属する。", tolerance: null },
      { type: "misconception_trap", instruction: "ピボット列と自由変数を入れ替えた誤解法を適用し、どの検算で破綻するかを確認する。", expected_result: "誤った候補は写像で零にならず、核の基底ではない。", tolerance: null },
      { type: "format_compliance", instruction: "答案が定義、行基本変形、基底、階数、次元定理による検算を順に含むか確認する。", expected_result: "要求された五つの根拠がすべて明示されている。", tolerance: null },
    ],
    originality_note: "既存の大学院入試問題本文を参照・転記せず、線形代数の公開された一般定義だけから新規に条件と数値を構成した。",
  };
}

function row(input: DiagnosticProblemContentInput, overrides: Partial<DiagnosticProblemContentRow> = {}): DiagnosticProblemContentRow {
  return {
    id: "content-1",
    blueprint_id: blueprint.id,
    problem_id: "problem-1",
    problem_node_id: "problem-node-1",
    graph_problem_link_id: "graph-link-1",
    problem_label: input.problem_label,
    statement_text: input.statement_text,
    answer_text: input.answer_text,
    explanation_text: input.explanation_text,
    scoring_examples_json: JSON.stringify(input.scoring_examples),
    adversarial_checks_json: JSON.stringify(input.adversarial_checks),
    verification_cases_json: JSON.stringify(input.verification_cases),
    originality_note: input.originality_note,
    content_fingerprint: "sha256-example",
    status: "approved",
    revision: 4,
    review_note: null,
    created_by: "editor",
    submitted_by: "editor",
    reviewed_by: "reviewer",
    verification_status: "passed",
    verification_revision: 4,
    verified_by: "verifier",
    verified_at: "2026-08-23T00:05:00.000Z",
    submitted_at: "2026-08-23T00:00:00.000Z",
    reviewed_at: "2026-08-23T00:10:00.000Z",
    materialized_at: "2026-08-23T00:10:00.000Z",
    ...overrides,
  };
}

describe("original diagnostic problem content", () => {
  it("accepts calibrated full, partial, and incorrect answer examples", () => {
    expect(validateDiagnosticProblemContent(validInput(), blueprint)).toEqual({ data: validInput(), issues: [] });
  });

  it("creates an intentionally incomplete draft without inventing subject matter", () => {
    const draft = defaultDiagnosticProblemContent(blueprint);
    expect(draft.statement_text).toBe("");
    expect(draft.scoring_examples.map((example) => example.level)).toEqual(["full_credit", "partial_credit", "no_credit"]);
    expect(validateDiagnosticProblemContent(draft, blueprint).issues.length).toBeGreaterThan(0);
  });

  it("rejects a score that disagrees with the weighted rubric", () => {
    const input = validInput();
    input.scoring_examples[1].score_rate = 0.7;
    expect(validateDiagnosticProblemContent(input, blueprint).issues)
      .toContain("採点例の得点率を採点基準の加重結果と一致させてください");
  });

  it("uses the same duplicate fingerprint when only the display label changes", async () => {
    const input = validInput();
    const renamed = { ...input, problem_label: `${input.problem_label} 別名` };
    expect(await fingerprintDiagnosticProblemContent(renamed)).toBe(await fingerprintDiagnosticProblemContent(input));
  });

  it("requires ambiguity, answer leakage, and misconception discrimination checks", () => {
    const input = validInput();
    input.adversarial_checks = input.adversarial_checks.slice(0, 2);
    expect(validateDiagnosticProblemContent(input, blueprint).issues)
      .toContain("曖昧性・答え漏洩・誤概念識別の耐性チェックが必要です");
  });

  it("requires every verification contract result and preserves independent observations", () => {
    const input = validInput();
    const results = input.verification_cases.map(({ type }) => ({ type, observed_result: "独立に計算して期待値と一致することを確認した。", passed: true }));
    expect(validateDiagnosticVerificationResults(results, input.verification_cases)).toEqual({ data: results, issues: [] });
    expect(validateDiagnosticVerificationResults(results.slice(0, 3), input.verification_cases).issues)
      .toContain("現在の検証契約すべてに独立した検証結果が必要です");
  });

  it("keeps approved content and its materialized problem visible in the queue", () => {
    const input = validInput();
    const queue = buildDiagnosticProblemAuthoringQueue([blueprint], [row(input)]);
    expect(queue.items[0]).toMatchObject({ state: "approved", content: { status: "approved", quality_issues: [] } });
    expect(queue.summary).toMatchObject({ approved_content: 1, materialized_problems: 1 });
  });

  it("does not treat malformed approved content as quality-valid", () => {
    const input = validInput();
    const queue = buildDiagnosticProblemAuthoringQueue([blueprint], [row(input, { scoring_examples_json: "[]" })]);
    expect(queue.items[0].content?.quality_issues.length).toBeGreaterThan(0);
  });
});
