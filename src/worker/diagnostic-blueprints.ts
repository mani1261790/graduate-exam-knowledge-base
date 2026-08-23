import type { DiagnosticContentNodeRow } from "./diagnostic-content";

export const DIAGNOSTIC_COGNITIVE_DEMANDS = ["concept_application", "multi_step_reasoning", "transfer"] as const;
export const DIAGNOSTIC_ANSWER_FORMATS = ["multiple_choice", "numeric", "short_text", "proof", "derivation", "programming", "essay", "mixed"] as const;

export type DiagnosticCognitiveDemand = (typeof DIAGNOSTIC_COGNITIVE_DEMANDS)[number];
export type DiagnosticAnswerFormat = (typeof DIAGNOSTIC_ANSWER_FORMATS)[number];
export type DiagnosticBlueprintStatus = "draft" | "candidate" | "approved" | "rejected" | "retired";

export interface DiagnosticRubricCriterion {
  label: string;
  weight: number;
}

export interface DiagnosticBlueprintInput {
  title: string;
  assessment_objective: string;
  evidence_expectation: string;
  cognitive_demand: DiagnosticCognitiveDemand;
  answer_format: DiagnosticAnswerFormat;
  difficulty: number;
  estimated_minutes: number;
  rubric: DiagnosticRubricCriterion[];
  misconception_targets: string[];
  originality_policy: "original_only";
}

export interface DiagnosticBlueprintRow {
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
  rubric_json: string;
  misconception_targets_json: string;
  originality_policy: "original_only";
  status: DiagnosticBlueprintStatus;
  revision: number;
  review_note: string | null;
  created_by: string;
  submitted_by: string | null;
  reviewed_by: string | null;
  submitted_at: string | null;
  reviewed_at: string | null;
}

export interface DiagnosticBlueprintRecord extends Omit<DiagnosticBlueprintRow, "rubric_json" | "misconception_targets_json"> {
  rubric: DiagnosticRubricCriterion[];
  misconception_targets: string[];
  quality_issues: string[];
}

export interface DiagnosticBlueprintQueue {
  generated_at: string;
  summary: {
    nodes_needing_problems: number;
    not_started_nodes: number;
    drafting_nodes: number;
    review_nodes: number;
    specification_ready_nodes: number;
    pending_blueprints: number;
    approved_blueprints: number;
  };
  items: Array<{
    graph_node_id: string;
    subject_key: string;
    topic: string;
    node_label: string;
    node_type: DiagnosticContentNodeRow["node_type"];
    mapped_concept_count: number;
    current_direct_count: number;
    problem_deficit: number;
    state: "not_started" | "drafting" | "in_review" | "specification_ready";
    specification_ready: boolean;
    pending_review_count: number;
    approved_cognitive_demands: DiagnosticCognitiveDemand[];
    blueprints: DiagnosticBlueprintRecord[];
  }>;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function finiteInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

export function validateDiagnosticBlueprintInput(value: unknown): { data: DiagnosticBlueprintInput | null; issues: string[] } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { data: null, issues: ["仕様データが必要です"] };
  const input = value as Record<string, unknown>;
  const title = text(input.title);
  const objective = text(input.assessment_objective);
  const evidence = text(input.evidence_expectation);
  const cognitiveDemand = input.cognitive_demand;
  const answerFormat = input.answer_format;
  const difficulty = finiteInteger(input.difficulty);
  const estimatedMinutes = finiteInteger(input.estimated_minutes);
  const originalityPolicy = input.originality_policy;
  const issues: string[] = [];
  if (title.length < 8 || title.length > 120) issues.push("仕様名は8〜120文字で入力してください");
  if (objective.length < 20 || objective.length > 500) issues.push("測定目的は20〜500文字で入力してください");
  if (evidence.length < 20 || evidence.length > 500) issues.push("観測する証拠は20〜500文字で入力してください");
  if (!DIAGNOSTIC_COGNITIVE_DEMANDS.includes(cognitiveDemand as DiagnosticCognitiveDemand)) issues.push("認知負荷が不正です");
  if (!DIAGNOSTIC_ANSWER_FORMATS.includes(answerFormat as DiagnosticAnswerFormat)) issues.push("解答形式が不正です");
  if (difficulty === null || difficulty < 1 || difficulty > 5) issues.push("難度は1〜5で指定してください");
  if (estimatedMinutes === null || estimatedMinutes < 5 || estimatedMinutes > 120) issues.push("所要時間は5〜120分で指定してください");
  if (originalityPolicy !== "original_only") issues.push("第三者問題の複製を避けるためoriginal_onlyが必要です");

  const rubric = Array.isArray(input.rubric) ? input.rubric.flatMap((criterion) => {
    if (!criterion || typeof criterion !== "object" || Array.isArray(criterion)) return [];
    const row = criterion as Record<string, unknown>;
    return [{ label: text(row.label), weight: typeof row.weight === "number" ? row.weight : Number.NaN }];
  }) : [];
  if (rubric.length < 2 || rubric.length > 6) issues.push("採点基準は2〜6項目で指定してください");
  if (rubric.some((criterion) => criterion.label.length < 2 || criterion.label.length > 120)) issues.push("採点基準名は2〜120文字で入力してください");
  if (rubric.some((criterion) => !Number.isFinite(criterion.weight) || criterion.weight < 0.05 || criterion.weight > 0.95)) issues.push("各採点重みは0.05〜0.95で指定してください");
  if (new Set(rubric.map((criterion) => criterion.label)).size !== rubric.length) issues.push("採点基準名は重複できません");
  const rubricWeight = rubric.reduce((sum, criterion) => sum + criterion.weight, 0);
  if (Math.abs(rubricWeight - 1) > 0.001) issues.push("採点重みの合計は1.0にしてください");

  const misconceptionTargets = Array.isArray(input.misconception_targets)
    ? input.misconception_targets.map(text).filter(Boolean)
    : [];
  if (misconceptionTargets.length < 1 || misconceptionTargets.length > 6) issues.push("想定誤答は1〜6件で指定してください");
  if (misconceptionTargets.some((target) => target.length < 4 || target.length > 160)) issues.push("想定誤答は4〜160文字で入力してください");
  if (new Set(misconceptionTargets).size !== misconceptionTargets.length) issues.push("想定誤答は重複できません");

  if (issues.length > 0 || difficulty === null || estimatedMinutes === null) return { data: null, issues: [...new Set(issues)] };
  return {
    data: {
      title,
      assessment_objective: objective,
      evidence_expectation: evidence,
      cognitive_demand: cognitiveDemand as DiagnosticCognitiveDemand,
      answer_format: answerFormat as DiagnosticAnswerFormat,
      difficulty,
      estimated_minutes: estimatedMinutes,
      rubric,
      misconception_targets: misconceptionTargets,
      originality_policy: "original_only",
    },
    issues: [],
  };
}

export function defaultDiagnosticBlueprint(node: Pick<DiagnosticContentNodeRow, "node_label" | "node_type" | "topic" | "layer">, slot: 1 | 2 | 3): DiagnosticBlueprintInput {
  const cognitiveDemand = DIAGNOSTIC_COGNITIVE_DEMANDS[slot - 1];
  const implementationNode = /プログラミング|アルゴリズム|データ構造|動的計画|ソフトウェア|データベース|オペレーティング/.test(node.node_label);
  const mathematicalNode = /数学|微分|積分|線形|確率|統計|固有値|最適化|方程式|計算量|論理|集合/.test(node.node_label);
  const socialNode = /社会|倫理|教育|福祉|経済|経営|人文|心理/.test(node.node_label);
  const formats: DiagnosticAnswerFormat[] = implementationNode
    ? ["short_text", "programming", "mixed"]
    : mathematicalNode
      ? ["derivation", "proof", "mixed"]
      : socialNode
        ? ["essay", "short_text", "mixed"]
        : ["short_text", "mixed", "essay"];
  return {
    title: `${node.node_label} 診断仕様 ${slot}`,
    assessment_objective: `${node.node_label}の主要概念を未知の条件へ適用し、選択した手順と結論の根拠を説明できるかを直接測定する。`,
    evidence_expectation: "定義と前提の選択、途中の推論過程、最終結果の整合性を独立した採点項目として観測する。",
    cognitive_demand: cognitiveDemand,
    answer_format: formats[slot - 1],
    difficulty: Math.min(5, Math.max(1, Number(node.layer) + 2)),
    estimated_minutes: slot === 1 ? 30 : slot === 2 ? 45 : 60,
    rubric: [
      { label: "概念と前提の選択", weight: 0.3 },
      { label: "推論過程の妥当性", weight: 0.4 },
      { label: "結論と検算", weight: 0.3 },
    ],
    misconception_targets: [
      `${node.node_label}の適用条件を確認せずに手順を選ぶ`,
      "途中の根拠を示さず結論だけを記述する",
    ],
    originality_policy: "original_only",
  };
}

export function diagnosticBlueprintFromRow(row: DiagnosticBlueprintRow): DiagnosticBlueprintRecord {
  let rubric: unknown = [];
  let misconceptions: unknown = [];
  try { rubric = JSON.parse(row.rubric_json); } catch { rubric = []; }
  try { misconceptions = JSON.parse(row.misconception_targets_json); } catch { misconceptions = []; }
  const validation = validateDiagnosticBlueprintInput({
    ...row,
    rubric,
    misconception_targets: misconceptions,
  });
  return {
    ...row,
    slot: Number(row.slot),
    difficulty: Number(row.difficulty),
    estimated_minutes: Number(row.estimated_minutes),
    revision: Number(row.revision),
    rubric: validation.data?.rubric ?? (Array.isArray(rubric) ? rubric as DiagnosticRubricCriterion[] : []),
    misconception_targets: validation.data?.misconception_targets ?? (Array.isArray(misconceptions) ? misconceptions as string[] : []),
    quality_issues: validation.issues,
  };
}

export function buildDiagnosticBlueprintQueue(
  nodes: DiagnosticContentNodeRow[],
  rows: DiagnosticBlueprintRow[],
  generatedAt = new Date().toISOString(),
): DiagnosticBlueprintQueue {
  const parsedRows = rows.map(diagnosticBlueprintFromRow).filter((row) => row.id && row.graph_node_id && Number.isInteger(row.slot) && row.slot >= 1 && row.slot <= 3);
  const rowsByNode = new Map<string, DiagnosticBlueprintRecord[]>();
  for (const row of parsedRows) {
    const current = rowsByNode.get(row.graph_node_id) ?? [];
    current.push(row);
    rowsByNode.set(row.graph_node_id, current);
  }
  const items = nodes.filter((node) => node.direct_problem_count < 2).map((node) => {
    const blueprints = [...(rowsByNode.get(node.graph_node_id) ?? [])].sort((left, right) => left.slot - right.slot);
    const approved = blueprints.filter((blueprint) => blueprint.status === "approved" && blueprint.quality_issues.length === 0);
    const approvedCognitiveDemands = [...new Set(approved.map((blueprint) => blueprint.cognitive_demand))];
    const specificationReady = approved.length >= 2 && approvedCognitiveDemands.length >= 2;
    const pendingReviewCount = blueprints.filter((blueprint) => blueprint.status === "candidate").length;
    const state = pendingReviewCount > 0
      ? "in_review"
      : specificationReady
        ? "specification_ready"
        : blueprints.length > 0
          ? "drafting"
          : "not_started";
    return {
      graph_node_id: node.graph_node_id,
      subject_key: node.subject_key,
      topic: node.topic,
      node_label: node.node_label,
      node_type: node.node_type,
      mapped_concept_count: node.mapped_concept_count,
      current_direct_count: node.direct_problem_count,
      problem_deficit: 2 - node.direct_problem_count,
      state,
      specification_ready: specificationReady,
      pending_review_count: pendingReviewCount,
      approved_cognitive_demands: approvedCognitiveDemands,
      blueprints,
    } satisfies DiagnosticBlueprintQueue["items"][number];
  }).sort((left, right) => {
    const priority = { in_review: 0, drafting: 1, not_started: 2, specification_ready: 3 } as const;
    return priority[left.state] - priority[right.state]
      || right.problem_deficit - left.problem_deficit
      || left.topic.localeCompare(right.topic, "ja")
      || left.node_label.localeCompare(right.node_label, "ja");
  });
  return {
    generated_at: generatedAt,
    summary: {
      nodes_needing_problems: items.length,
      not_started_nodes: items.filter((item) => item.state === "not_started").length,
      drafting_nodes: items.filter((item) => item.state === "drafting").length,
      review_nodes: items.filter((item) => item.state === "in_review").length,
      specification_ready_nodes: items.filter((item) => item.specification_ready).length,
      pending_blueprints: parsedRows.filter((row) => row.status === "candidate").length,
      approved_blueprints: parsedRows.filter((row) => row.status === "approved" && row.quality_issues.length === 0).length,
    },
    items,
  };
}
