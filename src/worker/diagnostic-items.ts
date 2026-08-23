const MAX_OUTCOME_HOURS = 14 * 24;
const MINIMUM_MEANINGFUL_UTILITY_SPREAD = 0.02;

export const DIAGNOSTIC_ITEM_MODEL_VERSION = "diagnostic-item-v1";

export interface DiagnosticProblemSignal {
  problem_id: string;
  problem_label: string;
  difficulty: number;
  estimated_minutes: number;
  target_concept_count: number;
  direct_concept_count: number;
  weighted_evidence_potential: number;
  baseline_node_evidence_count: number;
}

export interface RankedDiagnosticProblem extends DiagnosticProblemSignal {
  utility: number;
  expected_evidence_fraction: number;
  direct_coverage: number;
  difficulty_information: number;
  time_efficiency: number;
}

export interface DiagnosticChoicePolicy {
  selected: RankedDiagnosticProblem;
  baseline: RankedDiagnosticProblem;
  candidate_problem_count: number;
  comparable_candidate_count: number;
  utility_spread: number;
  ranking_opportunity: boolean;
  selection_changed: boolean;
}

export interface DiagnosticItemView {
  model_version: typeof DIAGNOSTIC_ITEM_MODEL_VERSION;
  selected_problem_id: string;
  selected_problem_label: string;
  baseline_problem_id: string;
  selected_utility: number;
  baseline_utility: number;
  target_concept_count: number;
  direct_concept_count: number;
  estimated_minutes: number;
  candidate_problem_count: number;
  comparable_candidate_count: number;
  utility_spread: number;
  ranking_opportunity: boolean;
  selection_changed: boolean;
  observed_direct_evidence_count: number | null;
  observed_total_evidence_gain: number | null;
  observed_time_minutes: number | null;
  completion_latency_hours: number | null;
  observed_at: string | null;
  message: string;
}

export interface DiagnosticItemHealthRow {
  user_id: string;
  selected_utility: number;
  baseline_utility: number;
  estimated_minutes: number;
  observed_result: "not_checked" | "correct" | "partial" | "wrong" | "skipped" | null;
  observed_direct_evidence_count: number | null;
  observed_time_minutes: number | null;
  completion_latency_hours: number | null;
  candidate_problem_count: number;
  comparable_candidate_count: number;
  utility_spread: number;
  ranking_opportunity: number;
  selection_changed: number;
}

export interface DiagnosticItemHealth {
  mature_exposures: number;
  users: number;
  minimum_exposures: number;
  minimum_users: number;
  completion_rate_14d: number | null;
  evidence_per_30_minutes: number | null;
  time_overrun_rate: number | null;
  average_proxy_advantage: number | null;
  status: "collecting" | "supported" | "neutral" | "rejected";
  hypothesis: {
    id: "P12_DIAGNOSTIC_ITEM_VALUE";
    label: string;
    status: "collecting" | "supported" | "neutral" | "rejected";
    evidence: string;
  };
}

export interface DiagnosticChoiceHealth {
  mature_exposures: number;
  users: number;
  minimum_exposures: number;
  minimum_users: number;
  comparison_opportunities: number;
  opportunity_users: number;
  opportunity_rate: number | null;
  average_comparable_candidates: number | null;
  rerank_rate: number | null;
  average_proxy_advantage: number | null;
  status: "collecting" | "supported" | "neutral" | "rejected";
  hypothesis: {
    id: "P13_DIAGNOSTIC_CHOICE_COVERAGE";
    label: string;
    status: "collecting" | "supported" | "neutral" | "rejected";
    evidence: string;
  };
}

interface ExposureRow {
  selected_problem_id: string;
  selected_problem_label: string;
  baseline_problem_id: string;
  selected_utility: number;
  baseline_utility: number;
  target_concept_count: number;
  direct_concept_count: number;
  estimated_minutes: number;
  observed_direct_evidence_count: number | null;
  observed_total_evidence_gain: number | null;
  observed_time_minutes: number | null;
  completion_latency_hours: number | null;
  observed_at: string | null;
  candidate_problem_count: number;
  comparable_candidate_count: number;
  utility_spread: number;
  ranking_opportunity: number;
  selection_changed: number;
}

function clamp(value: number, minimum = 0, maximum = 1): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function round(value: number, digits = 3): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function diagnosticProblemUtility(signal: DiagnosticProblemSignal): RankedDiagnosticProblem {
  const targetCount = Math.max(1, Math.round(signal.target_concept_count));
  const directCoverage = clamp(signal.direct_concept_count / targetCount);
  const expectedEvidence = clamp(signal.weighted_evidence_potential / targetCount);
  const difficultyInformation = clamp(1 - Math.abs(signal.difficulty - 3) / 2);
  const timeEfficiency = clamp(30 / Math.max(1, signal.estimated_minutes), 0.5, 1.5) / 1.5;
  const utility = clamp(
    expectedEvidence * 0.5
      + directCoverage * 0.25
      + difficultyInformation * 0.15
      + timeEfficiency * 0.1,
  );
  return {
    ...signal,
    utility: round(utility),
    expected_evidence_fraction: round(expectedEvidence),
    direct_coverage: round(directCoverage),
    difficulty_information: round(difficultyInformation),
    time_efficiency: round(timeEfficiency),
  };
}

export function rankDiagnosticProblems(signals: DiagnosticProblemSignal[]): RankedDiagnosticProblem[] {
  return signals
    .map(diagnosticProblemUtility)
    .sort((left, right) => right.utility - left.utility
      || right.direct_concept_count - left.direct_concept_count
      || left.estimated_minutes - right.estimated_minutes
      || left.problem_id.localeCompare(right.problem_id));
}

export function buildDiagnosticChoicePolicy(
  baselineProblemIds: string[],
  rankedProblems: RankedDiagnosticProblem[],
): DiagnosticChoicePolicy | null {
  if (baselineProblemIds.length === 0) return null;
  const rankedById = new Map(rankedProblems.map((problem) => [problem.problem_id, problem]));
  const baseline = rankedById.get(baselineProblemIds[0]);
  if (!baseline) return null;
  const comparable = baselineProblemIds.flatMap((problemId) => {
    const problem = rankedById.get(problemId);
    return problem ? [problem] : [];
  });
  if (comparable.length === 0) return null;
  const best = [...comparable].sort((left, right) => right.utility - left.utility
    || right.direct_concept_count - left.direct_concept_count
    || left.estimated_minutes - right.estimated_minutes
    || left.problem_id.localeCompare(right.problem_id))[0];
  const minimumUtility = Math.min(...comparable.map((problem) => problem.utility));
  const utilitySpread = round(best.utility - minimumUtility);
  const rankingOpportunity = comparable.length >= 2 && utilitySpread >= MINIMUM_MEANINGFUL_UTILITY_SPREAD;
  const selectionChanged = rankingOpportunity
    && best.problem_id !== baseline.problem_id
    && best.utility - baseline.utility >= MINIMUM_MEANINGFUL_UTILITY_SPREAD;
  return {
    selected: selectionChanged ? best : baseline,
    baseline,
    candidate_problem_count: baselineProblemIds.length,
    comparable_candidate_count: comparable.length,
    utility_spread: utilitySpread,
    ranking_opportunity: rankingOpportunity,
    selection_changed: selectionChanged,
  };
}

export async function loadDiagnosticProblemSignals(
  db: D1Database,
  userId: string,
  graphNodeId: string,
): Promise<DiagnosticProblemSignal[]> {
  const { results } = await db.prepare(
    `WITH target_concepts AS (
       SELECT DISTINCT l.concept_id
       FROM learning_graph_concept_links l
       JOIN concepts c ON c.id = l.concept_id AND c.status = 'active'
       WHERE l.graph_node_id = ? AND l.status = 'approved'
     ), node_summary AS (
       SELECT COUNT(*) AS target_concept_count,
              COALESCE(SUM(ucs.evidence_count), 0) AS baseline_node_evidence_count
       FROM target_concepts tc
       LEFT JOIN user_concept_states ucs ON ucs.concept_id = tc.concept_id AND ucs.user_id = ?
     )
     SELECT p.id AS problem_id, p.problem_label, p.difficulty, p.estimated_minutes,
            ns.target_concept_count,
            COUNT(DISTINCT CASE WHEN ke.edge_type = 'tests' THEN tc.concept_id END) AS direct_concept_count,
            COALESCE(SUM(
              (1.0 / (1.0 + COALESCE(ucs.evidence_count, 0)))
              * ke.weight * ke.confidence
              * CASE WHEN ke.edge_type = 'tests' THEN 1.0 ELSE 0.55 END
            ), 0.0) AS weighted_evidence_potential,
            ns.baseline_node_evidence_count
     FROM target_concepts tc
     JOIN node_registry nr_concept
       ON nr_concept.entity_type = 'concept' AND nr_concept.entity_id = tc.concept_id
     JOIN knowledge_edges ke
       ON ke.to_node_id = nr_concept.node_id AND ke.status = 'approved'
      AND ke.edge_type IN ('tests', 'requires')
     JOIN node_registry nr_problem
       ON nr_problem.node_id = ke.from_node_id AND nr_problem.entity_type = 'problem'
     JOIN problems p ON p.id = nr_problem.entity_id AND p.status = 'reviewed'
     JOIN source_documents sd ON sd.id = p.source_document_id
     CROSS JOIN node_summary ns
     LEFT JOIN user_concept_states ucs ON ucs.concept_id = tc.concept_id AND ucs.user_id = ?
     WHERE sd.source_status = 'active'
       AND sd.source_url IS NOT NULL AND sd.source_url <> '' AND LOWER(sd.source_url) LIKE 'https://%'
       AND sd.access_scope IN ('source_link_only', 'public_ready')
     GROUP BY p.id, p.problem_label, p.difficulty, p.estimated_minutes,
              ns.target_concept_count, ns.baseline_node_evidence_count`,
  ).bind(graphNodeId, userId, userId).all<DiagnosticProblemSignal>();
  return results.map((row) => ({
    ...row,
    difficulty: Number(row.difficulty),
    estimated_minutes: Number(row.estimated_minutes),
    target_concept_count: Number(row.target_concept_count),
    direct_concept_count: Number(row.direct_concept_count),
    weighted_evidence_potential: Number(row.weighted_evidence_potential),
    baseline_node_evidence_count: Number(row.baseline_node_evidence_count),
  }));
}

export async function recordDiagnosticItemExposure(
  db: D1Database,
  input: {
    userId: string;
    goalId: string;
    planId: string;
    informationGainExperimentId: string;
    graphNodeId: string;
    policy: DiagnosticChoicePolicy;
  },
  now = new Date(),
): Promise<void> {
  await db.batch([
    db.prepare(
      `DELETE FROM learning_diagnostic_item_exposures
       WHERE user_id = ? AND exposed_at < datetime('now', '-400 days')`,
    ).bind(input.userId),
    db.prepare(
      `INSERT OR IGNORE INTO learning_diagnostic_item_exposures (
         id, user_id, goal_id, plan_id, information_gain_experiment_id, graph_node_id,
         model_version, selected_problem_id, baseline_problem_id,
         selected_utility, baseline_utility, target_concept_count, direct_concept_count,
         weighted_evidence_potential, baseline_node_evidence_count, estimated_minutes, exposed_at,
         candidate_problem_count, comparable_candidate_count, utility_spread,
         ranking_opportunity, selection_changed
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      crypto.randomUUID(), input.userId, input.goalId, input.planId,
      input.informationGainExperimentId, input.graphNodeId, DIAGNOSTIC_ITEM_MODEL_VERSION,
      input.policy.selected.problem_id, input.policy.baseline.problem_id,
      input.policy.selected.utility, input.policy.baseline.utility, input.policy.selected.target_concept_count,
      input.policy.selected.direct_concept_count, input.policy.selected.weighted_evidence_potential,
      input.policy.selected.baseline_node_evidence_count, input.policy.selected.estimated_minutes, now.toISOString(),
      input.policy.candidate_problem_count, input.policy.comparable_candidate_count,
      input.policy.utility_spread, input.policy.ranking_opportunity ? 1 : 0,
      input.policy.selection_changed ? 1 : 0,
    ),
  ]);
}

export async function completeDiagnosticItemExposure(
  db: D1Database,
  input: {
    userId: string;
    problemId: string;
    attemptId: string;
    result: "not_checked" | "correct" | "partial" | "wrong" | "skipped";
    timeSpentMinutes: number | null;
  },
  now = new Date(),
): Promise<boolean> {
  const row = await db.prepare(
    `SELECT * FROM learning_diagnostic_item_exposures
     WHERE user_id = ? AND selected_problem_id = ? AND observed_at IS NULL AND cancelled_at IS NULL
     ORDER BY exposed_at DESC LIMIT 1`,
  ).bind(input.userId, input.problemId).first<{
    id: string;
    graph_node_id: string;
    baseline_node_evidence_count: number;
    exposed_at: string;
  }>();
  if (!row) return false;
  const outcome = await db.prepare(
    `WITH target_concepts AS (
       SELECT DISTINCT l.concept_id FROM learning_graph_concept_links l
       JOIN concepts c ON c.id = l.concept_id AND c.status = 'active'
       WHERE l.graph_node_id = ? AND l.status = 'approved'
     ), direct_concepts AS (
       SELECT DISTINCT nr_concept.entity_id AS concept_id
       FROM node_registry nr_problem
       JOIN knowledge_edges ke ON ke.from_node_id = nr_problem.node_id
         AND ke.edge_type = 'tests' AND ke.status = 'approved'
       JOIN node_registry nr_concept ON nr_concept.node_id = ke.to_node_id
         AND nr_concept.entity_type = 'concept'
       WHERE nr_problem.entity_type = 'problem' AND nr_problem.entity_id = ?
     )
     SELECT COALESCE(SUM(ucs.evidence_count), 0) AS node_evidence_count,
            COUNT(DISTINCT CASE WHEN dc.concept_id IS NOT NULL THEN tc.concept_id END) AS direct_evidence_count
     FROM target_concepts tc
     LEFT JOIN direct_concepts dc ON dc.concept_id = tc.concept_id
     LEFT JOIN user_concept_states ucs ON ucs.concept_id = tc.concept_id AND ucs.user_id = ?`,
  ).bind(row.graph_node_id, input.problemId, input.userId).first<{
    node_evidence_count: number;
    direct_evidence_count: number;
  }>();
  const latency = Math.max(0, (now.getTime() - Date.parse(row.exposed_at)) / 3_600_000);
  const result = await db.prepare(
    `UPDATE learning_diagnostic_item_exposures
     SET observed_attempt_id = ?, observed_result = ?, observed_direct_evidence_count = ?,
         observed_total_evidence_gain = ?, observed_time_minutes = ?,
         completion_latency_hours = ?, observed_at = ?
     WHERE id = ? AND observed_at IS NULL AND cancelled_at IS NULL`,
  ).bind(
    input.attemptId, input.result, Number(outcome?.direct_evidence_count ?? 0),
    Math.max(0, Number(outcome?.node_evidence_count ?? 0) - Number(row.baseline_node_evidence_count)),
    input.timeSpentMinutes, round(latency, 1), now.toISOString(), row.id,
  ).run();
  return Number(result.meta.changes ?? 0) > 0;
}

export async function latestDiagnosticItem(db: D1Database, userId: string): Promise<DiagnosticItemView | null> {
  const row = await db.prepare(
    `SELECT e.*, p.problem_label AS selected_problem_label
     FROM learning_diagnostic_item_exposures e
     JOIN problems p ON p.id = e.selected_problem_id
     WHERE e.user_id = ? AND e.cancelled_at IS NULL
       AND e.exposed_at >= datetime('now', '-30 days')
     ORDER BY e.exposed_at DESC LIMIT 1`,
  ).bind(userId).first<ExposureRow>();
  if (!row) return null;
  return {
    model_version: DIAGNOSTIC_ITEM_MODEL_VERSION,
    selected_problem_id: row.selected_problem_id,
    selected_problem_label: row.selected_problem_label,
    baseline_problem_id: row.baseline_problem_id,
    selected_utility: Number(row.selected_utility),
    baseline_utility: Number(row.baseline_utility),
    target_concept_count: Number(row.target_concept_count),
    direct_concept_count: Number(row.direct_concept_count),
    estimated_minutes: Number(row.estimated_minutes),
    candidate_problem_count: Number(row.candidate_problem_count),
    comparable_candidate_count: Number(row.comparable_candidate_count),
    utility_spread: Number(row.utility_spread),
    ranking_opportunity: Boolean(row.ranking_opportunity),
    selection_changed: Boolean(row.selection_changed),
    observed_direct_evidence_count: row.observed_direct_evidence_count == null ? null : Number(row.observed_direct_evidence_count),
    observed_total_evidence_gain: row.observed_total_evidence_gain == null ? null : Number(row.observed_total_evidence_gain),
    observed_time_minutes: row.observed_time_minutes == null ? null : Number(row.observed_time_minutes),
    completion_latency_hours: row.completion_latency_hours == null ? null : Number(row.completion_latency_hours),
    observed_at: row.observed_at,
    message: row.observed_at
      ? "確認問題の解答から、直接測れた分野証拠と所要時間を記録しました。"
      : "未観測概念の直接測定量、難度、所要時間から、この1問を確認問題として選びました。",
  };
}

export function buildDiagnosticChoiceHealth(rows: DiagnosticItemHealthRow[]): DiagnosticChoiceHealth {
  const valid = rows.filter((row) => Number.isInteger(row.candidate_problem_count) && row.candidate_problem_count >= 1
    && Number.isInteger(row.comparable_candidate_count) && row.comparable_candidate_count >= 1
    && row.comparable_candidate_count <= row.candidate_problem_count
    && Number.isFinite(row.utility_spread) && row.utility_spread >= 0 && row.utility_spread <= 1
    && (row.ranking_opportunity === 0 || row.ranking_opportunity === 1)
    && (row.selection_changed === 0 || row.selection_changed === 1));
  const users = new Set(valid.map((row) => row.user_id)).size;
  const minimumExposures = 30;
  const minimumUsers = 10;
  const ready = valid.length >= minimumExposures && users >= minimumUsers;
  const opportunities = valid.filter((row) => row.ranking_opportunity === 1);
  const opportunityUsers = new Set(opportunities.map((row) => row.user_id)).size;
  const opportunityRate = valid.length === 0 ? null : opportunities.length / valid.length;
  const rerankRate = opportunities.length === 0
    ? null
    : opportunities.filter((row) => row.selection_changed === 1).length / opportunities.length;
  const mean = (values: number[]) => values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length;
  const averageCandidates = mean(valid.map((row) => row.comparable_candidate_count));
  const proxyAdvantage = mean(opportunities.map((row) => row.selected_utility - row.baseline_utility));
  const status: DiagnosticChoiceHealth["status"] = !ready || opportunityRate === null
    ? "collecting"
    : opportunityRate >= 0.5
      ? "supported"
      : opportunityRate < 0.25
        ? "rejected"
        : "neutral";
  const evidence = !ready || opportunityRate === null
    ? `${valid.length}件 / ${users}人（判定には${minimumExposures}件・${minimumUsers}人）`
    : `比較機会率 ${round(opportunityRate)} / 選定変更率 ${rerankRate === null ? "なし" : round(rerankRate)}`;
  return {
    mature_exposures: valid.length,
    users,
    minimum_exposures: minimumExposures,
    minimum_users: minimumUsers,
    comparison_opportunities: opportunities.length,
    opportunity_users: opportunityUsers,
    opportunity_rate: ready && opportunityRate !== null ? round(opportunityRate) : null,
    average_comparable_candidates: ready && averageCandidates !== null ? round(averageCandidates) : null,
    rerank_rate: ready && rerankRate !== null ? round(rerankRate) : null,
    average_proxy_advantage: ready && proxyAdvantage !== null ? round(proxyAdvantage) : null,
    status,
    hypothesis: {
      id: "P13_DIAGNOSTIC_CHOICE_COVERAGE",
      label: "確認枠の半数以上で、効用差のある比較候補を2問以上確保できる",
      status,
      evidence,
    },
  };
}

export function buildDiagnosticItemHealth(rows: DiagnosticItemHealthRow[]): DiagnosticItemHealth {
  const valid = rows.filter((row) => [row.selected_utility, row.baseline_utility]
    .every((value) => Number.isFinite(value) && value >= 0 && value <= 1)
    && Number.isFinite(row.estimated_minutes) && row.estimated_minutes > 0);
  const users = new Set(valid.map((row) => row.user_id)).size;
  const minimumExposures = 30;
  const minimumUsers = 10;
  const ready = valid.length >= minimumExposures && users >= minimumUsers;
  const completed = valid.filter((row) => row.observed_result !== null
    && row.observed_result !== "skipped" && row.observed_result !== "not_checked"
    && row.completion_latency_hours !== null && row.completion_latency_hours <= MAX_OUTCOME_HOURS
    && row.observed_direct_evidence_count !== null);
  const completionRate = valid.length === 0 ? null : completed.length / valid.length;
  const efficiencies = completed.map((row) => Number(row.observed_direct_evidence_count)
    / Math.max(0.5, Number(row.observed_time_minutes ?? row.estimated_minutes) / 30));
  const mean = (values: number[]) => values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length;
  const efficiency = mean(efficiencies);
  const overrun = completed.length === 0 ? null : completed.filter((row) =>
    Number(row.observed_time_minutes ?? row.estimated_minutes) / row.estimated_minutes > 1.25,
  ).length / completed.length;
  const proxyAdvantage = mean(valid.map((row) => row.selected_utility - row.baseline_utility));
  const status: DiagnosticItemHealth["status"] = !ready || completionRate === null || efficiency === null || overrun === null
    ? "collecting"
    : efficiency >= 1 && completionRate >= 0.6 && overrun <= 0.35
      ? "supported"
      : efficiency < 0.5 || completionRate < 0.4 || overrun > 0.5
        ? "rejected"
        : "neutral";
  const evidence = !ready || completionRate === null || efficiency === null || overrun === null
    ? `${valid.length}件 / ${users}人（判定には${minimumExposures}件・${minimumUsers}人）`
    : `30分当たり直接証拠 ${round(efficiency)} / 14日完了率 ${round(completionRate)} / 時間超過率 ${round(overrun)}`;
  return {
    mature_exposures: valid.length,
    users,
    minimum_exposures: minimumExposures,
    minimum_users: minimumUsers,
    completion_rate_14d: ready && completionRate !== null ? round(completionRate) : null,
    evidence_per_30_minutes: ready && efficiency !== null ? round(efficiency) : null,
    time_overrun_rate: ready && overrun !== null ? round(overrun) : null,
    average_proxy_advantage: ready && proxyAdvantage !== null ? round(proxyAdvantage) : null,
    status,
    hypothesis: {
      id: "P12_DIAGNOSTIC_ITEM_VALUE",
      label: "情報量で選んだ確認問題は、時間超過を抑えながら1回の演習で直接証拠を増やす",
      status,
      evidence,
    },
  };
}
