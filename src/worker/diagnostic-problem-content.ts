import type {
  DiagnosticAnswerFormat,
  DiagnosticBlueprintRecord,
  DiagnosticCognitiveDemand,
  DiagnosticRubricCriterion,
} from "./diagnostic-blueprints";

export const DIAGNOSTIC_SCORING_LEVELS = ["full_credit", "partial_credit", "no_credit"] as const;
export const DIAGNOSTIC_ADVERSARIAL_CHECKS = ["ambiguity", "answer_leakage", "misconception_discrimination", "edge_case"] as const;
export const DIAGNOSTIC_VERIFICATION_TYPES = ["independent_recalculation", "boundary_case", "misconception_trap", "format_compliance"] as const;

export type DiagnosticScoringLevel = (typeof DIAGNOSTIC_SCORING_LEVELS)[number];
export type DiagnosticAdversarialCheckType = (typeof DIAGNOSTIC_ADVERSARIAL_CHECKS)[number];
export type DiagnosticProblemContentStatus = "draft" | "candidate" | "approved" | "rejected" | "retired";
export type DiagnosticVerificationType = (typeof DIAGNOSTIC_VERIFICATION_TYPES)[number];
export type DiagnosticVerificationStatus = "unverified" | "passed" | "failed";

export interface DiagnosticVerificationCase {
  type: DiagnosticVerificationType;
  instruction: string;
  expected_result: string;
  tolerance: number | null;
}

export interface DiagnosticVerificationResult {
  type: DiagnosticVerificationType;
  observed_result: string;
  passed: boolean;
}

export interface DiagnosticProblemVerificationRun {
  id: string;
  content_id: string;
  content_revision: number;
  verifier_id: string;
  outcome: "passed" | "failed";
  contract: DiagnosticVerificationCase[];
  results: DiagnosticVerificationResult[];
  note: string | null;
  created_at: string;
}

export interface DiagnosticProblemVerificationRunRow {
  id: string;
  content_id: string;
  content_revision: number;
  verifier_id: string;
  outcome: "passed" | "failed";
  contract_json: string;
  results_json: string;
  note: string | null;
  created_at: string;
}

export interface DiagnosticCriterionScore {
  label: string;
  score: number;
}

export interface DiagnosticScoringExample {
  level: DiagnosticScoringLevel;
  response: string;
  score_rate: number;
  criterion_scores: DiagnosticCriterionScore[];
  rationale: string;
}

export interface DiagnosticAdversarialCheck {
  type: DiagnosticAdversarialCheckType;
  finding: string;
  resolution: string;
}

export interface DiagnosticProblemContentInput {
  problem_label: string;
  statement_text: string;
  answer_text: string;
  explanation_text: string;
  scoring_examples: DiagnosticScoringExample[];
  adversarial_checks: DiagnosticAdversarialCheck[];
  verification_cases: DiagnosticVerificationCase[];
  originality_note: string;
}

export interface DiagnosticProblemBlueprintContext {
  id: string;
  graph_node_id: string;
  slot: number;
  title: string;
  assessment_objective: string;
  evidence_expectation: string;
  cognitive_demand: DiagnosticCognitiveDemand;
  answer_format: DiagnosticAnswerFormat;
  difficulty: number;
  estimated_minutes: number;
  rubric: DiagnosticRubricCriterion[];
  misconception_targets: string[];
  status: "approved";
}

export interface DiagnosticProblemContentRow {
  id: string;
  blueprint_id: string;
  problem_id: string;
  problem_node_id: string;
  graph_problem_link_id: string;
  problem_label: string;
  statement_text: string;
  answer_text: string;
  explanation_text: string;
  scoring_examples_json: string;
  adversarial_checks_json: string;
  verification_cases_json: string;
  originality_note: string;
  content_fingerprint: string | null;
  status: DiagnosticProblemContentStatus;
  revision: number;
  review_note: string | null;
  created_by: string;
  submitted_by: string | null;
  reviewed_by: string | null;
  verification_status: DiagnosticVerificationStatus;
  verification_revision: number | null;
  verified_by: string | null;
  verified_at: string | null;
  submitted_at: string | null;
  reviewed_at: string | null;
  materialized_at: string | null;
}

export interface DiagnosticProblemContentRecord extends Omit<DiagnosticProblemContentRow, "scoring_examples_json" | "adversarial_checks_json" | "verification_cases_json"> {
  scoring_examples: DiagnosticScoringExample[];
  adversarial_checks: DiagnosticAdversarialCheck[];
  verification_cases: DiagnosticVerificationCase[];
  verification_runs: DiagnosticProblemVerificationRun[];
  quality_issues: string[];
}

export interface DiagnosticProblemAuthoringQueue {
  generated_at: string;
  summary: {
    approved_blueprints: number;
    not_started: number;
    drafting: number;
    pending_review: number;
    pending_verification: number;
    verified_pending_approval: number;
    failed_verification: number;
    verification_runs: number;
    verification_pass_rate: number | null;
    approved_content: number;
    materialized_problems: number;
  };
  items: Array<{
    blueprint: DiagnosticProblemBlueprintContext;
    state: "not_started" | "drafting" | "in_review" | "approved";
    content: DiagnosticProblemContentRecord | null;
  }>;
}

function cleanText(value: unknown): string {
  return typeof value === "string" ? value.trim().replace(/\r\n/g, "\n") : "";
}

function finiteRate(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function unique(values: string[]): boolean {
  return new Set(values).size === values.length;
}

export function validateDiagnosticVerificationResults(
  value: unknown,
  cases: DiagnosticVerificationCase[],
): { data: DiagnosticVerificationResult[] | null; issues: string[] } {
  const results = Array.isArray(value) ? value.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const row = item as Record<string, unknown>;
    return [{
      type: row.type as DiagnosticVerificationType,
      observed_result: cleanText(row.observed_result),
      passed: row.passed === true,
    }];
  }) : [];
  const issues: string[] = [];
  const types = results.map((item) => item.type);
  if (results.length !== cases.length || !unique(types)
    || cases.some((item) => !types.includes(item.type))) {
    issues.push("現在の検証契約すべてに独立した検証結果が必要です");
  }
  for (const result of results) {
    if (!DIAGNOSTIC_VERIFICATION_TYPES.includes(result.type)) issues.push("検証結果種別が不正です");
    if (result.observed_result.length < 10 || result.observed_result.length > 1200) {
      issues.push("検証観測結果は10〜1200文字で入力してください");
    }
  }
  return issues.length > 0 ? { data: null, issues: [...new Set(issues)] } : { data: results, issues: [] };
}

export function diagnosticProblemVerificationRunFromRow(row: DiagnosticProblemVerificationRunRow): DiagnosticProblemVerificationRun {
  let contract: DiagnosticVerificationCase[] = [];
  let results: DiagnosticVerificationResult[] = [];
  try { contract = JSON.parse(row.contract_json) as DiagnosticVerificationCase[]; } catch { contract = []; }
  try { results = JSON.parse(row.results_json) as DiagnosticVerificationResult[]; } catch { results = []; }
  return { ...row, content_revision: Number(row.content_revision), contract, results };
}

export function validateDiagnosticProblemContent(
  value: unknown,
  blueprint: Pick<DiagnosticProblemBlueprintContext, "rubric" | "answer_format">,
): { data: DiagnosticProblemContentInput | null; issues: string[] } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { data: null, issues: ["問題制作データが必要です"] };
  const input = value as Record<string, unknown>;
  const problemLabel = cleanText(input.problem_label);
  const statementText = cleanText(input.statement_text);
  const answerText = cleanText(input.answer_text);
  const explanationText = cleanText(input.explanation_text);
  const originalityNote = cleanText(input.originality_note);
  const issues: string[] = [];
  if (problemLabel.length < 8 || problemLabel.length > 140) issues.push("問題名は8〜140文字で入力してください");
  if (statementText.length < 80 || statementText.length > 5_000) issues.push("問題本文は80〜5000文字で入力してください");
  if (answerText.length < 20 || answerText.length > 3_000) issues.push("模範解答は20〜3000文字で入力してください");
  if (explanationText.length < 120 || explanationText.length > 8_000) issues.push("解説は120〜8000文字で入力してください");
  if (originalityNote.length < 30 || originalityNote.length > 500) issues.push("原創性メモは30〜500文字で入力してください");
  if (/https?:\/\//i.test(originalityNote)) issues.push("原創性メモに外部問題のURLを記載しないでください");

  const rubricLabels = blueprint.rubric.map((criterion) => criterion.label);
  const scoringExamples = Array.isArray(input.scoring_examples) ? input.scoring_examples.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const row = item as Record<string, unknown>;
    const criterionScores = Array.isArray(row.criterion_scores) ? row.criterion_scores.flatMap((criterion) => {
      if (!criterion || typeof criterion !== "object" || Array.isArray(criterion)) return [];
      const scoreRow = criterion as Record<string, unknown>;
      return [{ label: cleanText(scoreRow.label), score: finiteRate(scoreRow.score) ?? Number.NaN }];
    }) : [];
    return [{
      level: row.level as DiagnosticScoringLevel,
      response: cleanText(row.response),
      score_rate: finiteRate(row.score_rate) ?? Number.NaN,
      criterion_scores: criterionScores,
      rationale: cleanText(row.rationale),
    }];
  }) : [];
  if (scoringExamples.length < 3 || scoringExamples.length > 6) issues.push("採点例は3〜6件で指定してください");
  const levels = scoringExamples.map((example) => example.level);
  if (!DIAGNOSTIC_SCORING_LEVELS.every((level) => levels.includes(level))) issues.push("満点・部分点・誤答の採点例が各1件以上必要です");
  for (const example of scoringExamples) {
    if (!DIAGNOSTIC_SCORING_LEVELS.includes(example.level)) issues.push("採点例の水準が不正です");
    if (example.response.length < 10 || example.response.length > 2_000) issues.push("答案例は10〜2000文字で入力してください");
    if (example.rationale.length < 20 || example.rationale.length > 600) issues.push("採点理由は20〜600文字で入力してください");
    if (!Number.isFinite(example.score_rate) || example.score_rate < 0 || example.score_rate > 1) issues.push("答案例の得点率は0〜1で指定してください");
    if (example.level === "full_credit" && example.score_rate < 0.85) issues.push("満点答案例の得点率は0.85以上にしてください");
    if (example.level === "partial_credit" && (example.score_rate < 0.2 || example.score_rate > 0.8)) issues.push("部分点答案例の得点率は0.2〜0.8にしてください");
    if (example.level === "no_credit" && example.score_rate > 0.15) issues.push("誤答案例の得点率は0.15以下にしてください");
    const scoreLabels = example.criterion_scores.map((criterion) => criterion.label);
    if (scoreLabels.length !== rubricLabels.length || !unique(scoreLabels)
      || rubricLabels.some((label) => !scoreLabels.includes(label))) {
      issues.push("各答案例で全採点基準を重複なく評価してください");
    }
    if (example.criterion_scores.some((criterion) => !Number.isFinite(criterion.score) || criterion.score < 0 || criterion.score > 1)) {
      issues.push("採点基準ごとの評価は0〜1で指定してください");
    }
    const scoreByLabel = new Map(example.criterion_scores.map((criterion) => [criterion.label, criterion.score]));
    const weightedScore = blueprint.rubric.reduce((sum, criterion) => sum + criterion.weight * (scoreByLabel.get(criterion.label) ?? 0), 0);
    if (Number.isFinite(example.score_rate) && Math.abs(weightedScore - example.score_rate) > 0.011) {
      issues.push("採点例の得点率を採点基準の加重結果と一致させてください");
    }
  }

  const adversarialChecks = Array.isArray(input.adversarial_checks) ? input.adversarial_checks.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const row = item as Record<string, unknown>;
    return [{ type: row.type as DiagnosticAdversarialCheckType, finding: cleanText(row.finding), resolution: cleanText(row.resolution) }];
  }) : [];
  if (adversarialChecks.length < 3 || adversarialChecks.length > 6) issues.push("耐性チェックは3〜6件で指定してください");
  const checkTypes = adversarialChecks.map((check) => check.type);
  if (!unique(checkTypes)) issues.push("耐性チェック種別は重複できません");
  for (const required of ["ambiguity", "answer_leakage", "misconception_discrimination"] as const) {
    if (!checkTypes.includes(required)) issues.push("曖昧性・答え漏洩・誤概念識別の耐性チェックが必要です");
  }
  if (adversarialChecks.some((check) => !DIAGNOSTIC_ADVERSARIAL_CHECKS.includes(check.type))) issues.push("耐性チェック種別が不正です");
  if (adversarialChecks.some((check) => check.finding.length < 20 || check.finding.length > 500)) issues.push("耐性チェック所見は20〜500文字で入力してください");
  if (adversarialChecks.some((check) => check.resolution.length < 20 || check.resolution.length > 500)) issues.push("耐性チェック対応は20〜500文字で入力してください");

  const verificationCases = Array.isArray(input.verification_cases) ? input.verification_cases.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const row = item as Record<string, unknown>;
    const tolerance = row.tolerance === null || row.tolerance === undefined || row.tolerance === ""
      ? null : finiteRate(row.tolerance);
    return [{
      type: row.type as DiagnosticVerificationType,
      instruction: cleanText(row.instruction),
      expected_result: cleanText(row.expected_result),
      tolerance,
    }];
  }) : [];
  const verificationTypes = verificationCases.map((item) => item.type);
  if (verificationCases.length !== DIAGNOSTIC_VERIFICATION_TYPES.length || !unique(verificationTypes)) {
    issues.push("独立再計算・境界条件・誤概念トラップ・形式適合の検証契約を各1件指定してください");
  }
  if (!DIAGNOSTIC_VERIFICATION_TYPES.every((type) => verificationTypes.includes(type))) {
    issues.push("検証契約の必須種別が不足しています");
  }
  for (const item of verificationCases) {
    if (!DIAGNOSTIC_VERIFICATION_TYPES.includes(item.type)) issues.push("検証契約種別が不正です");
    if (item.instruction.length < 20 || item.instruction.length > 800) issues.push("検証手順は20〜800文字で入力してください");
    if (item.expected_result.length < 10 || item.expected_result.length > 800) issues.push("検証期待値は10〜800文字で入力してください");
    if (item.tolerance !== null && (item.tolerance === null || !Number.isFinite(item.tolerance) || item.tolerance < 0 || item.tolerance > 1_000_000)) {
      issues.push("許容誤差は0〜1000000の数値で指定してください");
    }
  }
  if (blueprint.answer_format === "numeric") {
    const numericCases = verificationCases.filter((item) => item.type === "independent_recalculation" || item.type === "boundary_case");
    if (numericCases.some((item) => item.tolerance === null)) issues.push("数値問題の再計算と境界条件には許容誤差が必要です");
  }

  if (issues.length > 0) return { data: null, issues: [...new Set(issues)] };
  return {
    data: {
      problem_label: problemLabel,
      statement_text: statementText,
      answer_text: answerText,
      explanation_text: explanationText,
      scoring_examples: scoringExamples,
      adversarial_checks: adversarialChecks,
      verification_cases: verificationCases,
      originality_note: originalityNote,
    },
    issues: [],
  };
}

export function defaultDiagnosticProblemContent(
  blueprint: Pick<DiagnosticProblemBlueprintContext, "title" | "rubric">,
): DiagnosticProblemContentInput {
  const example = (level: DiagnosticScoringLevel, score: number): DiagnosticScoringExample => ({
    level,
    response: "",
    score_rate: score,
    criterion_scores: blueprint.rubric.map((criterion) => ({ label: criterion.label, score })),
    rationale: "",
  });
  return {
    problem_label: blueprint.title.replace(/診断仕様/g, "オリジナル診断問題"),
    statement_text: "",
    answer_text: "",
    explanation_text: "",
    scoring_examples: [example("full_credit", 1), example("partial_credit", 0.5), example("no_credit", 0)],
    adversarial_checks: [
      { type: "ambiguity", finding: "", resolution: "" },
      { type: "answer_leakage", finding: "", resolution: "" },
      { type: "misconception_discrimination", finding: "", resolution: "" },
    ],
    verification_cases: DIAGNOSTIC_VERIFICATION_TYPES.map((type) => ({ type, instruction: "", expected_result: "", tolerance: null })),
    originality_note: "",
  };
}

export function diagnosticProblemContentFromRow(
  row: DiagnosticProblemContentRow,
  blueprint: Pick<DiagnosticProblemBlueprintContext, "rubric" | "answer_format">,
): DiagnosticProblemContentRecord {
  let scoringExamples: unknown = [];
  let adversarialChecks: unknown = [];
  let verificationCases: unknown = [];
  try { scoringExamples = JSON.parse(row.scoring_examples_json); } catch { scoringExamples = []; }
  try { adversarialChecks = JSON.parse(row.adversarial_checks_json); } catch { adversarialChecks = []; }
  try { verificationCases = JSON.parse(row.verification_cases_json); } catch { verificationCases = []; }
  const validation = validateDiagnosticProblemContent({
    ...row,
    scoring_examples: scoringExamples,
    adversarial_checks: adversarialChecks,
    verification_cases: verificationCases,
  }, blueprint);
  return {
    ...row,
    revision: Number(row.revision),
    scoring_examples: validation.data?.scoring_examples ?? (Array.isArray(scoringExamples) ? scoringExamples as DiagnosticScoringExample[] : []),
    adversarial_checks: validation.data?.adversarial_checks ?? (Array.isArray(adversarialChecks) ? adversarialChecks as DiagnosticAdversarialCheck[] : []),
    verification_cases: validation.data?.verification_cases ?? (Array.isArray(verificationCases) ? verificationCases as DiagnosticVerificationCase[] : []),
    verification_runs: [],
    quality_issues: validation.issues,
  };
}

export function buildDiagnosticProblemAuthoringQueue(
  blueprints: DiagnosticProblemBlueprintContext[],
  rows: DiagnosticProblemContentRow[],
  verificationRuns: DiagnosticProblemVerificationRun[] = [],
  generatedAt = new Date().toISOString(),
): DiagnosticProblemAuthoringQueue {
  const rowByBlueprint = new Map(rows.map((row) => [row.blueprint_id, row]));
  const items = blueprints.map((blueprint) => {
    const row = rowByBlueprint.get(blueprint.id);
    const content = row ? diagnosticProblemContentFromRow(row, blueprint) : null;
    if (content) content.verification_runs = verificationRuns.filter((run) => run.content_id === content.id);
    const state = !content
      ? "not_started"
      : content.status === "candidate"
        ? "in_review"
        : content.status === "approved"
          ? "approved"
          : "drafting";
    return { blueprint, state, content } satisfies DiagnosticProblemAuthoringQueue["items"][number];
  }).sort((left, right) => {
    const priority = { in_review: 0, drafting: 1, not_started: 2, approved: 3 } as const;
    return priority[left.state] - priority[right.state]
      || left.blueprint.title.localeCompare(right.blueprint.title, "ja")
      || left.blueprint.id.localeCompare(right.blueprint.id);
  });
  return {
    generated_at: generatedAt,
    summary: {
      approved_blueprints: blueprints.length,
      not_started: items.filter((item) => item.state === "not_started").length,
      drafting: items.filter((item) => item.state === "drafting").length,
      pending_review: items.filter((item) => item.state === "in_review").length,
      pending_verification: items.filter((item) => item.content?.status === "candidate" && item.content.verification_status !== "passed").length,
      verified_pending_approval: items.filter((item) => item.content?.status === "candidate" && item.content.verification_status === "passed").length,
      failed_verification: verificationRuns.filter((run) => run.outcome === "failed").length,
      verification_runs: verificationRuns.length,
      verification_pass_rate: verificationRuns.length >= 20
        ? verificationRuns.filter((run) => run.outcome === "passed").length / verificationRuns.length
        : null,
      approved_content: items.filter((item) => item.state === "approved").length,
      materialized_problems: items.filter((item) => item.content?.status === "approved" && item.content.materialized_at).length,
    },
    items,
  };
}

export async function fingerprintDiagnosticProblemContent(input: DiagnosticProblemContentInput): Promise<string> {
  const normalized = JSON.stringify([
    input.statement_text.replace(/\s+/g, " ").trim(),
    input.answer_text.replace(/\s+/g, " ").trim(),
    input.explanation_text.replace(/\s+/g, " ").trim(),
  ]);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(normalized));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function diagnosticProblemBlueprintContext(record: DiagnosticBlueprintRecord): DiagnosticProblemBlueprintContext | null {
  if (record.status !== "approved" || record.quality_issues.length > 0) return null;
  return {
    id: record.id,
    graph_node_id: record.graph_node_id,
    slot: record.slot,
    title: record.title,
    assessment_objective: record.assessment_objective,
    evidence_expectation: record.evidence_expectation,
    cognitive_demand: record.cognitive_demand,
    answer_format: record.answer_format,
    difficulty: record.difficulty,
    estimated_minutes: record.estimated_minutes,
    rubric: record.rubric,
    misconception_targets: record.misconception_targets,
    status: "approved",
  };
}
