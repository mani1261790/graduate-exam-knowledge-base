const DAY_MS = 86_400_000;
const JST_OFFSET_MS = 9 * 60 * 60 * 1_000;

export const PLAN_FOCUS_MODEL_VERSION = "plan-focus-v1";

export interface PlanFocusNodeSignal {
  id: string;
  label: string;
  status: "completed" | "ready" | "blocked";
  mastery: number;
  evidence_count: number;
  review_due: boolean;
  downstream_weight: number;
  layer: number;
}

export interface PlanFocusDistributionItem {
  node_id: string;
  label: string;
  sessions: number;
}

export interface PlanFocusProposal {
  focus_node_ids: string[];
  focus_node_labels: string[];
  baseline_distribution: PlanFocusDistributionItem[];
  proposed_distribution: PlanFocusDistributionItem[];
  baseline_focus_mastery: number;
  baseline_distinct_nodes: number;
  proposed_distinct_nodes: number;
  rationale: string;
}

export interface PlanFocusView extends PlanFocusProposal {
  experiment_id: string;
  status: "proposal" | "monitoring" | "improving" | "neutral" | "regressing";
  baseline_plan_adherence: number;
  baseline_due_sessions: number;
  followup_focus_mastery: number | null;
  focus_mastery_uplift: number | null;
  followup_plan_adherence: number | null;
  adherence_uplift: number | null;
  followup_due_sessions: number | null;
  coverage_rate: number | null;
  accepted_at: string | null;
  completed_at: string | null;
  message: string;
}

export interface PlanFocusHealthRow {
  user_id: string;
  focus_mastery_uplift: number;
  adherence_uplift: number;
  coverage_rate: number;
}

export interface PlanFocusHealth {
  completed_experiments: number;
  users: number;
  minimum_experiments: number;
  minimum_users: number;
  average_focus_mastery_uplift: number | null;
  average_adherence_uplift: number | null;
  average_coverage_rate: number | null;
  improvement_rate: number | null;
  status: "collecting" | "supported" | "neutral" | "rejected";
  hypothesis: {
    id: "P10_BOTTLENECK_FOCUS";
    label: string;
    status: "collecting" | "supported" | "neutral" | "rejected";
    evidence: string;
  };
}

interface ExperimentRow {
  id: string;
  goal_id: string;
  plan_id: string;
  focus_node_ids: string;
  focus_node_labels: string;
  baseline_distribution: string;
  proposed_distribution: string;
  baseline_focus_mastery: number;
  baseline_plan_adherence: number;
  baseline_due_sessions: number;
  baseline_distinct_nodes: number;
  proposed_distinct_nodes: number;
  exposed_at: string;
  followup_focus_mastery: number | null;
  focus_mastery_uplift: number | null;
  followup_plan_adherence: number | null;
  adherence_uplift: number | null;
  followup_due_sessions: number | null;
  coverage_rate: number | null;
  accepted_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
}

function round(value: number, digits = 3): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function parseStringArray(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function parseDistribution(value: string): PlanFocusDistributionItem[] {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const candidate = item as { node_id?: unknown; label?: unknown; sessions?: unknown };
      return typeof candidate.node_id === "string" && typeof candidate.label === "string" && Number.isInteger(candidate.sessions)
        ? [{ node_id: candidate.node_id, label: candidate.label, sessions: Number(candidate.sessions) }]
        : [];
    });
  } catch {
    return [];
  }
}

function distribution(sequence: PlanFocusNodeSignal[]): PlanFocusDistributionItem[] {
  const counts = new Map<string, PlanFocusDistributionItem>();
  for (const node of sequence) {
    const current = counts.get(node.id);
    counts.set(node.id, { node_id: node.id, label: node.label, sessions: (current?.sessions ?? 0) + 1 });
  }
  return [...counts.values()].sort((left, right) => right.sessions - left.sessions || left.label.localeCompare(right.label, "ja"));
}

export function buildDistributedNodeSequence(nodes: PlanFocusNodeSignal[], sessionCount: number): PlanFocusNodeSignal[] {
  const ready = nodes.filter((node) => node.status === "ready");
  if (ready.length === 0 || sessionCount <= 0) return [];
  return Array.from({ length: sessionCount }, (_, index) => ready[index % ready.length]);
}

export function buildFocusedNodeSequence(
  nodes: PlanFocusNodeSignal[],
  focusNodeIds: readonly string[],
  sessionCount: number,
): PlanFocusNodeSignal[] {
  const ready = nodes.filter((node) => node.status === "ready");
  const focusSet = new Set(focusNodeIds);
  const focused = ready.filter((node) => focusSet.has(node.id));
  const distributed = ready.filter((node) => !focusSet.has(node.id));
  if (ready.length === 0 || focused.length === 0 || sessionCount <= 0) return buildDistributedNodeSequence(nodes, sessionCount);
  const result: PlanFocusNodeSignal[] = [];
  let focusIndex = 0;
  let distributedIndex = 0;
  for (let index = 0; index < sessionCount; index += 1) {
    if (index % 2 === 0) {
      result.push(focused[focusIndex % focused.length]);
      focusIndex += 1;
    } else {
      const pool = distributed.length > 0 ? distributed : ready;
      result.push(pool[distributedIndex % pool.length]);
      distributedIndex += 1;
    }
  }
  return result;
}

export function buildPlanFocusProposal(nodes: PlanFocusNodeSignal[], sessionCount: number): PlanFocusProposal | null {
  const ready = nodes.filter((node) => node.status === "ready");
  if (sessionCount < 6 || ready.length < 2) return null;
  const maxDownstream = Math.max(1, ...ready.map((node) => node.downstream_weight));
  const candidates = ready
    .filter((node) => node.review_due || (node.evidence_count >= 2 && node.mastery < 0.65))
    .map((node) => ({
      node,
      score: (node.review_due ? 2 : 0)
        + (node.evidence_count >= 2 ? (1 - node.mastery) * 1.5 : 0)
        + (node.downstream_weight / maxDownstream) * 0.5
        + (3 - Math.min(3, node.layer)) * 0.08,
    }))
    .sort((left, right) => right.score - left.score || left.node.id.localeCompare(right.node.id));
  if (candidates.length === 0) return null;
  // Leave at least one ready node outside the focus set so the other half of
  // the schedule remains a genuine coverage guardrail.
  const focusNodes = candidates.slice(0, 1).map((candidate) => candidate.node);
  if (focusNodes.length === 0) return null;
  const baselineSequence = buildDistributedNodeSequence(ready, sessionCount);
  const proposedSequence = buildFocusedNodeSequence(ready, focusNodes.map((node) => node.id), sessionCount);
  const baselineDistribution = distribution(baselineSequence);
  const proposedDistribution = distribution(proposedSequence);
  const baselineCounts = new Map(baselineDistribution.map((item) => [item.node_id, item.sessions]));
  if (proposedDistribution.every((item) => baselineCounts.get(item.node_id) === item.sessions)) return null;
  const baselineDistinct = baselineDistribution.length;
  const proposedDistinct = proposedDistribution.length;
  if (proposedDistinct / baselineDistinct < 0.7) return null;
  const weightedEvidence = focusNodes.reduce((sum, node) => sum + Math.max(1, node.evidence_count), 0);
  const focusMastery = focusNodes.reduce((sum, node) => sum + node.mastery * Math.max(1, node.evidence_count), 0) / weightedEvidence;
  return {
    focus_node_ids: focusNodes.map((node) => node.id),
    focus_node_labels: focusNodes.map((node) => node.label),
    baseline_distribution: baselineDistribution,
    proposed_distribution: proposedDistribution,
    baseline_focus_mastery: round(focusMastery),
    baseline_distinct_nodes: baselineDistinct,
    proposed_distinct_nodes: proposedDistinct,
    rationale: `${focusNodes.map((node) => node.label).join("・")}を全予定の最大50%に増やし、残りは現在の分散学習を維持します。`,
  };
}

function proposalKey(proposal: PlanFocusProposal): string {
  return JSON.stringify([proposal.focus_node_ids, proposal.proposed_distribution.map((item) => [item.node_id, item.sessions])]);
}

function experimentView(row: ExperimentRow): PlanFocusView | null {
  if (row.cancelled_at) return null;
  const focusLabels = parseStringArray(row.focus_node_labels);
  let status: PlanFocusView["status"] = row.accepted_at ? "monitoring" : "proposal";
  let message = row.accepted_at
    ? "採用後14日間の重点分野の習熟変化と計画遵守を追跡します。"
    : "実測上の弱点または復習期限がある分野に配分を寄せる候補です。採用するまで計画は変わりません。";
  if (row.completed_at) {
    const mastery = Number(row.focus_mastery_uplift ?? 0);
    const adherence = Number(row.adherence_uplift ?? 0);
    status = mastery >= 0.05 && adherence >= -0.05 ? "improving" : mastery <= -0.05 || adherence <= -0.1 ? "regressing" : "neutral";
    message = status === "improving"
      ? "重点分野の保守的習熟度が上がり、計画遵守も許容範囲でした。"
      : status === "regressing"
        ? "重点化後の習熟または計画遵守が悪化しました。分散計画へ戻して再検討します。"
        : "14日間では明確な差がなく、分散計画へ戻して証拠を蓄積します。";
  }
  return {
    experiment_id: row.id,
    focus_node_ids: parseStringArray(row.focus_node_ids),
    focus_node_labels: focusLabels,
    baseline_distribution: parseDistribution(row.baseline_distribution),
    proposed_distribution: parseDistribution(row.proposed_distribution),
    baseline_focus_mastery: Number(row.baseline_focus_mastery),
    baseline_distinct_nodes: Number(row.baseline_distinct_nodes),
    proposed_distinct_nodes: Number(row.proposed_distinct_nodes),
    rationale: `${focusLabels.join("・")}を全予定の最大50%に増やし、残りは現在の分散学習を維持します。`,
    status,
    baseline_plan_adherence: Number(row.baseline_plan_adherence),
    baseline_due_sessions: Number(row.baseline_due_sessions),
    followup_focus_mastery: row.followup_focus_mastery == null ? null : Number(row.followup_focus_mastery),
    focus_mastery_uplift: row.focus_mastery_uplift == null ? null : Number(row.focus_mastery_uplift),
    followup_plan_adherence: row.followup_plan_adherence == null ? null : Number(row.followup_plan_adherence),
    adherence_uplift: row.adherence_uplift == null ? null : Number(row.adherence_uplift),
    followup_due_sessions: row.followup_due_sessions == null ? null : Number(row.followup_due_sessions),
    coverage_rate: row.coverage_rate == null ? null : Number(row.coverage_rate),
    accepted_at: row.accepted_at,
    completed_at: row.completed_at,
    message,
  };
}

export async function recordPlanFocusExposure(
  db: D1Database,
  userId: string,
  goalId: string,
  planId: string,
  proposal: PlanFocusProposal,
  baseline: { planAdherence: number; dueSessions: number },
  now = new Date(),
): Promise<PlanFocusView> {
  const exposedAt = now.toISOString();
  const exposureDate = new Date(now.getTime() + JST_OFFSET_MS).toISOString().slice(0, 10);
  const key = proposalKey(proposal);
  await db.batch([
    db.prepare("DELETE FROM learning_plan_focus_experiments WHERE user_id = ? AND exposed_at < datetime('now', '-400 days')").bind(userId),
    db.prepare(
      `INSERT OR IGNORE INTO learning_plan_focus_experiments (
         id, user_id, goal_id, plan_id, model_version, proposal_key, exposure_date,
         focus_node_ids, focus_node_labels, baseline_distribution, proposed_distribution,
         baseline_focus_mastery, baseline_plan_adherence, baseline_due_sessions,
         baseline_distinct_nodes, proposed_distinct_nodes, exposed_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      crypto.randomUUID(), userId, goalId, planId, PLAN_FOCUS_MODEL_VERSION, key, exposureDate,
      JSON.stringify(proposal.focus_node_ids), JSON.stringify(proposal.focus_node_labels),
      JSON.stringify(proposal.baseline_distribution), JSON.stringify(proposal.proposed_distribution),
      proposal.baseline_focus_mastery, baseline.planAdherence, baseline.dueSessions,
      proposal.baseline_distinct_nodes, proposal.proposed_distinct_nodes, exposedAt,
    ),
  ]);
  const row = await db.prepare(
    `SELECT * FROM learning_plan_focus_experiments
     WHERE user_id = ? AND goal_id = ? AND model_version = ? AND proposal_key = ? AND exposure_date = ?`,
  ).bind(userId, goalId, PLAN_FOCUS_MODEL_VERSION, key, exposureDate).first<ExperimentRow>();
  const view = row ? experimentView(row) : null;
  if (!view) throw new Error("Plan focus exposure could not be recorded");
  return view;
}

export async function latestPlanFocus(db: D1Database, userId: string, now = new Date()): Promise<PlanFocusView | null> {
  const recentBoundary = new Date(now.getTime() - 30 * DAY_MS).toISOString();
  const row = await db.prepare(
    `SELECT * FROM learning_plan_focus_experiments
     WHERE user_id = ? AND accepted_at IS NOT NULL AND cancelled_at IS NULL
       AND (completed_at IS NULL OR completed_at >= ?)
     ORDER BY accepted_at DESC LIMIT 1`,
  ).bind(userId, recentBoundary).first<ExperimentRow>();
  return row ? experimentView(row) : null;
}

export async function acceptPlanFocus(db: D1Database, userId: string, experimentId: string, now = new Date()): Promise<boolean> {
  const row = await db.prepare(
    `SELECT e.*, ug.is_active, sp.status AS plan_status, sp.updated_at AS plan_updated_at,
            EXISTS(SELECT 1 FROM learning_information_gain_experiments ig
                   WHERE ig.user_id = e.user_id AND ig.accepted_at IS NOT NULL
                     AND ig.completed_at IS NULL AND ig.cancelled_at IS NULL) AS exploration_active
     FROM learning_plan_focus_experiments e
     JOIN user_goals ug ON ug.id = e.goal_id AND ug.user_id = e.user_id
     JOIN study_plans sp ON sp.id = e.plan_id AND sp.user_id = e.user_id
     WHERE e.id = ? AND e.user_id = ?`,
  ).bind(experimentId, userId).first<ExperimentRow & { is_active: number; plan_status: string; plan_updated_at: string; exploration_active: number }>();
  if (!row || row.cancelled_at || row.completed_at || !Number(row.is_active) || row.plan_status !== "active" || Number(row.exploration_active)) return false;
  if (row.accepted_at) return true;
  if (Date.parse(row.plan_updated_at) > Date.parse(row.exposed_at)) return false;
  const acceptedAt = now.toISOString();
  const result = await db.prepare(
    `UPDATE learning_plan_focus_experiments SET accepted_at = ?
     WHERE id = ? AND user_id = ? AND accepted_at IS NULL AND cancelled_at IS NULL`,
  ).bind(acceptedAt, experimentId, userId).run();
  return Number(result.meta.changes ?? 0) > 0;
}

export async function activePlanFocusNodeIds(db: D1Database, userId: string, goalId: string): Promise<string[]> {
  const row = await db.prepare(
    `SELECT focus_node_ids FROM learning_plan_focus_experiments
     WHERE user_id = ? AND goal_id = ? AND accepted_at IS NOT NULL
       AND completed_at IS NULL AND cancelled_at IS NULL
     ORDER BY accepted_at DESC LIMIT 1`,
  ).bind(userId, goalId).first<{ focus_node_ids: string }>();
  return row ? parseStringArray(row.focus_node_ids) : [];
}

export async function pendingPlanFocusOutcome(db: D1Database, userId: string, now = new Date()): Promise<{
  id: string;
  goalId: string;
  focusNodeIds: string[];
} | null> {
  const row = await db.prepare(
    `SELECT * FROM learning_plan_focus_experiments
     WHERE user_id = ? AND accepted_at IS NOT NULL AND completed_at IS NULL AND cancelled_at IS NULL
     ORDER BY accepted_at DESC LIMIT 1`,
  ).bind(userId).first<ExperimentRow>();
  if (!row?.accepted_at || (now.getTime() - Date.parse(row.accepted_at)) / DAY_MS < 14) return null;
  return { id: row.id, goalId: row.goal_id, focusNodeIds: parseStringArray(row.focus_node_ids) };
}

export async function updatePlanFocusOutcome(
  db: D1Database,
  userId: string,
  experimentId: string,
  currentFocusMastery: number,
  now = new Date(),
): Promise<boolean> {
  const row = await db.prepare(
    `SELECT * FROM learning_plan_focus_experiments
     WHERE id = ? AND user_id = ? AND accepted_at IS NOT NULL
       AND completed_at IS NULL AND cancelled_at IS NULL`,
  ).bind(experimentId, userId).first<ExperimentRow>();
  if (!row?.accepted_at) return false;
  const endAt = now.toISOString();
  const sessions = await db.prepare(
    `WITH daily AS (
       SELECT spi.scheduled_date,
              MIN(CASE WHEN spi.status = 'completed' THEN 1 ELSE 0 END) AS completed
       FROM study_plan_items spi
       JOIN study_plans sp ON sp.id = spi.plan_id
       WHERE sp.user_id = ? AND sp.goal_id = ?
         AND spi.scheduled_date >= date(?, '+9 hours') AND spi.scheduled_date < date(?, '+9 hours')
       GROUP BY spi.scheduled_date
     )
     SELECT COUNT(*) AS due_sessions, COALESCE(SUM(completed), 0) AS completed_sessions FROM daily`,
  ).bind(userId, row.goal_id, row.accepted_at, endAt).first<{ due_sessions: number; completed_sessions: number }>();
  const dueSessions = Number(sessions?.due_sessions ?? 0);
  if (dueSessions < 4) return false;
  const nodeCoverage = await db.prepare(
    `SELECT COUNT(DISTINCT spi.graph_node_id) AS distinct_nodes
     FROM study_plan_items spi JOIN study_plans sp ON sp.id = spi.plan_id
     WHERE sp.user_id = ? AND sp.goal_id = ?
       AND spi.scheduled_date >= date(?, '+9 hours') AND spi.scheduled_date < date(?, '+9 hours')`,
  ).bind(userId, row.goal_id, row.accepted_at, endAt).first<{ distinct_nodes: number }>();
  const adherence = Number(sessions?.completed_sessions ?? 0) / dueSessions;
  const coverage = Math.min(1, Number(nodeCoverage?.distinct_nodes ?? 0) / Math.max(1, Number(row.baseline_distinct_nodes)));
  await db.prepare(
    `UPDATE learning_plan_focus_experiments
     SET followup_focus_mastery = ?, focus_mastery_uplift = ?,
         followup_plan_adherence = ?, adherence_uplift = ?, followup_due_sessions = ?,
         coverage_rate = ?, completed_at = ?
     WHERE id = ? AND completed_at IS NULL AND cancelled_at IS NULL`,
  ).bind(
    round(currentFocusMastery), round(currentFocusMastery - Number(row.baseline_focus_mastery)),
    round(adherence), round(adherence - Number(row.baseline_plan_adherence)), dueSessions,
    round(coverage), endAt, row.id,
  ).run();
  return true;
}

export function buildPlanFocusHealth(rows: PlanFocusHealthRow[]): PlanFocusHealth {
  const valid = rows.filter((row) => [row.focus_mastery_uplift, row.adherence_uplift, row.coverage_rate]
    .every((value) => Number.isFinite(value) && value >= -1 && value <= 1) && row.coverage_rate >= 0);
  const users = new Set(valid.map((row) => row.user_id)).size;
  const minimumExperiments = 30;
  const minimumUsers = 10;
  const ready = valid.length >= minimumExperiments && users >= minimumUsers;
  const mean = (values: number[]) => values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length;
  const mastery = mean(valid.map((row) => row.focus_mastery_uplift));
  const adherence = mean(valid.map((row) => row.adherence_uplift));
  const coverage = mean(valid.map((row) => row.coverage_rate));
  const improvement = valid.length === 0 ? null : valid.filter((row) => row.focus_mastery_uplift > 0).length / valid.length;
  const status: PlanFocusHealth["status"] = !ready || mastery === null || adherence === null || coverage === null
    ? "collecting"
    : mastery >= 0.05 && adherence >= -0.05 && coverage >= 0.7
      ? "supported"
      : mastery <= -0.05 || adherence <= -0.1 || coverage < 0.5
        ? "rejected"
        : "neutral";
  return {
    completed_experiments: valid.length,
    users,
    minimum_experiments: minimumExperiments,
    minimum_users: minimumUsers,
    average_focus_mastery_uplift: ready && mastery !== null ? round(mastery) : null,
    average_adherence_uplift: ready && adherence !== null ? round(adherence) : null,
    average_coverage_rate: ready && coverage !== null ? round(coverage) : null,
    improvement_rate: ready && improvement !== null ? round(improvement) : null,
    status,
    hypothesis: {
      id: "P10_BOTTLENECK_FOCUS",
      label: "実測ボトルネックへの最大50%集中は範囲と遵守を保ちながら14日後の習熟を改善する",
      status,
      evidence: ready && mastery !== null && adherence !== null
        ? `${valid.length}件・${users}人 / 習熟 ${mastery >= 0 ? "+" : ""}${Math.round(mastery * 100)}pt / 遵守 ${adherence >= 0 ? "+" : ""}${Math.round(adherence * 100)}pt`
        : `${valid.length}件 / ${users}人`,
    },
  };
}
