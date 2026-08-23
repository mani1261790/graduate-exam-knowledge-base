import { buildDistributedNodeSequence, type PlanFocusDistributionItem, type PlanFocusNodeSignal } from "./plan-focus";

const DAY_MS = 86_400_000;
const JST_OFFSET_MS = 9 * 60 * 60 * 1_000;

export const INFORMATION_GAIN_MODEL_VERSION = "information-gain-v1";

export interface InformationGainNodeSignal extends PlanFocusNodeSignal {
  available_problem_count: number;
}

export interface InformationGainProposal {
  exploration_node_id: string;
  exploration_node_label: string;
  baseline_evidence_count: number;
  baseline_distribution: PlanFocusDistributionItem[];
  proposed_distribution: PlanFocusDistributionItem[];
  baseline_distinct_nodes: number;
  proposed_distinct_nodes: number;
  exploration_sessions: number;
  rationale: string;
}

export interface InformationGainView extends InformationGainProposal {
  experiment_id: string;
  status: "proposal" | "monitoring" | "evidence_acquired" | "completed" | "no_evidence";
  baseline_plan_adherence: number | null;
  baseline_due_sessions: number;
  evidence_acquired_at: string | null;
  evidence_latency_hours: number | null;
  followup_plan_adherence: number | null;
  followup_due_sessions: number | null;
  coverage_rate: number | null;
  accepted_at: string | null;
  completed_at: string | null;
  message: string;
}

export interface InformationGainHealthRow {
  user_id: string;
  evidence_acquired_at: string | null;
  evidence_latency_hours: number | null;
  followup_plan_adherence: number;
  coverage_rate: number;
}

export interface InformationGainHealth {
  completed_experiments: number;
  users: number;
  minimum_experiments: number;
  minimum_users: number;
  acquisition_rate: number | null;
  median_evidence_latency_hours: number | null;
  average_plan_adherence: number | null;
  average_coverage_rate: number | null;
  status: "collecting" | "supported" | "neutral" | "rejected";
  hypothesis: {
    id: "P11_DIAGNOSTIC_EXPLORATION";
    label: string;
    status: "collecting" | "supported" | "neutral" | "rejected";
    evidence: string;
  };
}

interface ExperimentRow {
  id: string;
  goal_id: string;
  plan_id: string;
  exploration_node_id: string;
  exploration_node_label: string;
  baseline_evidence_count: number;
  baseline_distribution: string;
  proposed_distribution: string;
  baseline_distinct_nodes: number;
  proposed_distinct_nodes: number;
  exploration_sessions: number;
  baseline_plan_adherence: number | null;
  baseline_due_sessions: number;
  exposed_at: string;
  accepted_at: string | null;
  evidence_acquired_at: string | null;
  evidence_latency_hours: number | null;
  followup_plan_adherence: number | null;
  followup_due_sessions: number | null;
  coverage_rate: number | null;
  completed_at: string | null;
  cancelled_at: string | null;
}

function round(value: number, digits = 3): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function distribution(sequence: InformationGainNodeSignal[]): PlanFocusDistributionItem[] {
  const counts = new Map<string, PlanFocusDistributionItem>();
  for (const node of sequence) {
    const current = counts.get(node.id);
    counts.set(node.id, { node_id: node.id, label: node.label, sessions: (current?.sessions ?? 0) + 1 });
  }
  return [...counts.values()].sort((left, right) => right.sessions - left.sessions || left.label.localeCompare(right.label, "ja"));
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

export function buildExplorationNodeSequence(
  nodes: InformationGainNodeSignal[],
  explorationNodeId: string,
  sessionCount: number,
): InformationGainNodeSignal[] {
  const ready = nodes.filter((node) => node.status === "ready");
  const exploration = ready.find((node) => node.id === explorationNodeId);
  if (!exploration || sessionCount <= 0) return buildDistributedNodeSequence(ready, sessionCount) as InformationGainNodeSignal[];
  const others = ready.filter((node) => node.id !== explorationNodeId);
  if (others.length === 0) return buildDistributedNodeSequence(ready, sessionCount) as InformationGainNodeSignal[];
  const explorationSessions = Math.max(1, Math.min(
    Math.floor(sessionCount * 0.2),
    exploration.available_problem_count,
  ));
  const result: InformationGainNodeSignal[] = [];
  let otherIndex = 0;
  for (let index = 0; index < sessionCount; index += 1) {
    const isExploration = index < explorationSessions * 2 && index % 2 === 0;
    if (isExploration) result.push(exploration);
    else {
      result.push(others[otherIndex % others.length]);
      otherIndex += 1;
    }
  }
  return result;
}

export function buildInformationGainProposal(nodes: InformationGainNodeSignal[], sessionCount: number): InformationGainProposal | null {
  const ready = nodes.filter((node) => node.status === "ready");
  if (sessionCount < 5 || ready.length < 2) return null;
  const candidates = ready
    .filter((node) => node.evidence_count === 0 && node.available_problem_count > 0)
    .sort((left, right) => right.downstream_weight - left.downstream_weight || left.layer - right.layer || left.id.localeCompare(right.id));
  const exploration = candidates[0];
  if (!exploration) return null;
  const baseline = buildDistributedNodeSequence(ready, sessionCount) as InformationGainNodeSignal[];
  const proposed = buildExplorationNodeSequence(ready, exploration.id, sessionCount);
  const baselineDistribution = distribution(baseline);
  const proposedDistribution = distribution(proposed);
  const explorationSessions = proposed.filter((node) => node.id === exploration.id).length;
  if (explorationSessions / sessionCount > 0.2) return null;
  const baselineDistinct = baselineDistribution.length;
  const proposedDistinct = proposedDistribution.length;
  if (proposedDistinct / baselineDistinct < 0.7) return null;
  return {
    exploration_node_id: exploration.id,
    exploration_node_label: exploration.label,
    baseline_evidence_count: exploration.evidence_count,
    baseline_distribution: baselineDistribution,
    proposed_distribution: proposedDistribution,
    baseline_distinct_nodes: baselineDistinct,
    proposed_distinct_nodes: proposedDistinct,
    exploration_sessions: explorationSessions,
    rationale: `${exploration.label}は未観測で、弱点とは判定できません。最初の確認枠を最大20%だけ使い、残りは分散学習を維持します。`,
  };
}

function proposalKey(proposal: InformationGainProposal): string {
  return JSON.stringify([proposal.exploration_node_id, proposal.exploration_sessions, proposal.proposed_distribution]);
}

function experimentView(row: ExperimentRow): InformationGainView | null {
  if (row.cancelled_at) return null;
  let status: InformationGainView["status"] = row.accepted_at ? "monitoring" : "proposal";
  let message = row.accepted_at
    ? "確認枠から実測証拠が得られるかを追跡しています。証拠取得後は分散計画へ戻します。"
    : "未観測分野を弱点と決めつけず、短い確認演習で情報を増やす候補です。採用するまで計画は変わりません。";
  if (row.evidence_acquired_at) {
    status = row.completed_at ? "completed" : "evidence_acquired";
    message = row.completed_at
      ? "確認枠で実測証拠を取得できました。以後の予定は分散計画へ戻しています。"
      : "実測証拠を取得したため、確認枠を終了して分散計画へ戻しました。14日後まで遵守を観測します。";
  } else if (row.completed_at) {
    status = "no_evidence";
    message = "14日間では実測証拠を取得できませんでした。確認枠は終了し、分散計画へ戻しました。";
  }
  return {
    experiment_id: row.id,
    exploration_node_id: row.exploration_node_id,
    exploration_node_label: row.exploration_node_label,
    baseline_evidence_count: Number(row.baseline_evidence_count),
    baseline_distribution: parseDistribution(row.baseline_distribution),
    proposed_distribution: parseDistribution(row.proposed_distribution),
    baseline_distinct_nodes: Number(row.baseline_distinct_nodes),
    proposed_distinct_nodes: Number(row.proposed_distinct_nodes),
    exploration_sessions: Number(row.exploration_sessions),
    rationale: `${row.exploration_node_label}は未観測で、弱点とは判定できません。最初の確認枠を最大20%だけ使い、残りは分散学習を維持します。`,
    status,
    baseline_plan_adherence: row.baseline_plan_adherence == null ? null : Number(row.baseline_plan_adherence),
    baseline_due_sessions: Number(row.baseline_due_sessions),
    evidence_acquired_at: row.evidence_acquired_at,
    evidence_latency_hours: row.evidence_latency_hours == null ? null : Number(row.evidence_latency_hours),
    followup_plan_adherence: row.followup_plan_adherence == null ? null : Number(row.followup_plan_adherence),
    followup_due_sessions: row.followup_due_sessions == null ? null : Number(row.followup_due_sessions),
    coverage_rate: row.coverage_rate == null ? null : Number(row.coverage_rate),
    accepted_at: row.accepted_at,
    completed_at: row.completed_at,
    message,
  };
}

export async function recordInformationGainExposure(
  db: D1Database,
  userId: string,
  goalId: string,
  planId: string,
  proposal: InformationGainProposal,
  baseline: { planAdherence: number | null; dueSessions: number },
  now = new Date(),
): Promise<InformationGainView | null> {
  const exposedAt = now.toISOString();
  const exposureDate = new Date(now.getTime() + JST_OFFSET_MS).toISOString().slice(0, 10);
  const key = proposalKey(proposal);
  await db.batch([
    db.prepare("DELETE FROM learning_information_gain_experiments WHERE user_id = ? AND exposed_at < datetime('now', '-400 days')").bind(userId),
    db.prepare(
      `INSERT OR IGNORE INTO learning_information_gain_experiments (
         id, user_id, goal_id, plan_id, model_version, proposal_key, exposure_date,
         exploration_node_id, exploration_node_label, baseline_evidence_count,
         baseline_distribution, proposed_distribution, baseline_distinct_nodes,
         proposed_distinct_nodes, exploration_sessions, baseline_plan_adherence,
         baseline_due_sessions, exposed_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      crypto.randomUUID(), userId, goalId, planId, INFORMATION_GAIN_MODEL_VERSION, key, exposureDate,
      proposal.exploration_node_id, proposal.exploration_node_label, proposal.baseline_evidence_count,
      JSON.stringify(proposal.baseline_distribution), JSON.stringify(proposal.proposed_distribution),
      proposal.baseline_distinct_nodes, proposal.proposed_distinct_nodes, proposal.exploration_sessions,
      baseline.planAdherence, baseline.dueSessions, exposedAt,
    ),
  ]);
  const row = await db.prepare(
    `SELECT * FROM learning_information_gain_experiments
     WHERE user_id = ? AND goal_id = ? AND model_version = ? AND proposal_key = ? AND exposure_date = ?
       AND cancelled_at IS NULL`,
  ).bind(userId, goalId, INFORMATION_GAIN_MODEL_VERSION, key, exposureDate).first<ExperimentRow>();
  return row ? experimentView(row) : null;
}

export async function latestInformationGain(db: D1Database, userId: string, now = new Date()): Promise<InformationGainView | null> {
  const recentBoundary = new Date(now.getTime() - 30 * DAY_MS).toISOString();
  const row = await db.prepare(
    `SELECT * FROM learning_information_gain_experiments
     WHERE user_id = ? AND accepted_at IS NOT NULL AND cancelled_at IS NULL
       AND (completed_at IS NULL OR completed_at >= ?)
     ORDER BY accepted_at DESC LIMIT 1`,
  ).bind(userId, recentBoundary).first<ExperimentRow>();
  return row ? experimentView(row) : null;
}

export async function acceptInformationGain(db: D1Database, userId: string, experimentId: string, now = new Date()): Promise<boolean> {
  const row = await db.prepare(
    `SELECT e.*, ug.is_active, sp.status AS plan_status, sp.updated_at AS plan_updated_at,
            EXISTS(SELECT 1 FROM learning_plan_focus_experiments f
                   WHERE f.user_id = e.user_id AND f.accepted_at IS NOT NULL
                     AND f.completed_at IS NULL AND f.cancelled_at IS NULL) AS focus_active
     FROM learning_information_gain_experiments e
     JOIN user_goals ug ON ug.id = e.goal_id AND ug.user_id = e.user_id
     JOIN study_plans sp ON sp.id = e.plan_id AND sp.user_id = e.user_id
     WHERE e.id = ? AND e.user_id = ?`,
  ).bind(experimentId, userId).first<ExperimentRow & { is_active: number; plan_status: string; plan_updated_at: string; focus_active: number }>();
  if (!row || row.cancelled_at || row.completed_at || !Number(row.is_active) || row.plan_status !== "active" || Number(row.focus_active)) return false;
  if (row.accepted_at) return true;
  if (Date.parse(row.plan_updated_at) > Date.parse(row.exposed_at)) return false;
  const result = await db.prepare(
    `UPDATE learning_information_gain_experiments SET accepted_at = ?
     WHERE id = ? AND user_id = ? AND accepted_at IS NULL AND cancelled_at IS NULL`,
  ).bind(now.toISOString(), experimentId, userId).run();
  return Number(result.meta.changes ?? 0) > 0;
}

export async function activeInformationGainNodeId(db: D1Database, userId: string, goalId: string): Promise<string | null> {
  return (await activeInformationGainPolicy(db, userId, goalId))?.nodeId ?? null;
}

export async function activeInformationGainPolicy(db: D1Database, userId: string, goalId: string): Promise<{
  experimentId: string;
  nodeId: string;
} | null> {
  const row = await db.prepare(
    `SELECT id, exploration_node_id FROM learning_information_gain_experiments
     WHERE user_id = ? AND goal_id = ? AND accepted_at IS NOT NULL
       AND evidence_acquired_at IS NULL AND completed_at IS NULL AND cancelled_at IS NULL
     ORDER BY accepted_at DESC LIMIT 1`,
  ).bind(userId, goalId).first<{ id: string; exploration_node_id: string }>();
  return row ? { experimentId: row.id, nodeId: row.exploration_node_id } : null;
}

export async function updateInformationGainOutcome(db: D1Database, userId: string, now = new Date()): Promise<{ evidenceAcquired: boolean; completed: boolean }> {
  const row = await db.prepare(
    `SELECT * FROM learning_information_gain_experiments
     WHERE user_id = ? AND accepted_at IS NOT NULL AND completed_at IS NULL AND cancelled_at IS NULL
     ORDER BY accepted_at DESC LIMIT 1`,
  ).bind(userId).first<ExperimentRow>();
  if (!row?.accepted_at) return { evidenceAcquired: false, completed: false };
  let acquiredNow = false;
  if (!row.evidence_acquired_at) {
    const evidence = await db.prepare(
      `SELECT COALESCE(SUM(ucs.evidence_count), 0) AS evidence_count
       FROM learning_graph_concept_links l
       LEFT JOIN user_concept_states ucs ON ucs.concept_id = l.concept_id AND ucs.user_id = ?
       WHERE l.graph_node_id = ? AND l.status = 'approved'`,
    ).bind(userId, row.exploration_node_id).first<{ evidence_count: number }>();
    if (Number(evidence?.evidence_count ?? 0) > Number(row.baseline_evidence_count)) {
      const latency = Math.max(0, (now.getTime() - Date.parse(row.accepted_at)) / 3_600_000);
      await db.prepare(
        `UPDATE learning_information_gain_experiments
         SET evidence_acquired_at = ?, evidence_latency_hours = ?
         WHERE id = ? AND evidence_acquired_at IS NULL AND completed_at IS NULL`,
      ).bind(now.toISOString(), round(latency, 1), row.id).run();
      row.evidence_acquired_at = now.toISOString();
      acquiredNow = true;
    }
  }
  if ((now.getTime() - Date.parse(row.accepted_at)) / DAY_MS < 14) return { evidenceAcquired: acquiredNow, completed: false };
  const sessions = await db.prepare(
    `WITH daily AS (
       SELECT spi.scheduled_date,
              MIN(CASE WHEN spi.status = 'completed' THEN 1 ELSE 0 END) AS completed
       FROM study_plan_items spi JOIN study_plans sp ON sp.id = spi.plan_id
       WHERE sp.user_id = ? AND sp.goal_id = ?
         AND spi.scheduled_date >= date(?, '+9 hours') AND spi.scheduled_date < date(?, '+9 hours')
       GROUP BY spi.scheduled_date
     ) SELECT COUNT(*) AS due_sessions, COALESCE(SUM(completed), 0) AS completed_sessions FROM daily`,
  ).bind(userId, row.goal_id, row.accepted_at, now.toISOString()).first<{ due_sessions: number; completed_sessions: number }>();
  const dueSessions = Number(sessions?.due_sessions ?? 0);
  if (dueSessions < 4) return { evidenceAcquired: acquiredNow, completed: false };
  const coverage = await db.prepare(
    `SELECT COUNT(DISTINCT spi.graph_node_id) AS distinct_nodes
     FROM study_plan_items spi JOIN study_plans sp ON sp.id = spi.plan_id
     WHERE sp.user_id = ? AND sp.goal_id = ?
       AND spi.scheduled_date >= date(?, '+9 hours') AND spi.scheduled_date < date(?, '+9 hours')`,
  ).bind(userId, row.goal_id, row.accepted_at, now.toISOString()).first<{ distinct_nodes: number }>();
  await db.prepare(
    `UPDATE learning_information_gain_experiments
     SET followup_plan_adherence = ?, followup_due_sessions = ?, coverage_rate = ?, completed_at = ?
     WHERE id = ? AND completed_at IS NULL AND cancelled_at IS NULL`,
  ).bind(
    round(Number(sessions?.completed_sessions ?? 0) / dueSessions), dueSessions,
    round(Math.min(1, Number(coverage?.distinct_nodes ?? 0) / Math.max(1, Number(row.baseline_distinct_nodes)))),
    now.toISOString(), row.id,
  ).run();
  return { evidenceAcquired: acquiredNow, completed: true };
}

export function buildInformationGainHealth(rows: InformationGainHealthRow[]): InformationGainHealth {
  const valid = rows.filter((row) => Number.isFinite(row.followup_plan_adherence)
    && row.followup_plan_adherence >= 0 && row.followup_plan_adherence <= 1
    && Number.isFinite(row.coverage_rate) && row.coverage_rate >= 0 && row.coverage_rate <= 1
    && (row.evidence_acquired_at === null
      ? row.evidence_latency_hours === null
      : row.evidence_latency_hours !== null && Number.isFinite(row.evidence_latency_hours) && row.evidence_latency_hours >= 0));
  const users = new Set(valid.map((row) => row.user_id)).size;
  const minimumExperiments = 30;
  const minimumUsers = 10;
  const ready = valid.length >= minimumExperiments && users >= minimumUsers;
  const acquired = valid.filter((row) => row.evidence_acquired_at !== null);
  const acquisitionRate = valid.length === 0 ? null : acquired.length / valid.length;
  const latencies = acquired.map((row) => row.evidence_latency_hours).filter((value): value is number => value !== null && Number.isFinite(value));
  const sortedLatencies = [...latencies].sort((left, right) => left - right);
  const middle = Math.floor(sortedLatencies.length / 2);
  const medianLatency = sortedLatencies.length === 0 ? null : sortedLatencies.length % 2
    ? sortedLatencies[middle]
    : (sortedLatencies[middle - 1] + sortedLatencies[middle]) / 2;
  const mean = (values: number[]) => values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length;
  const adherence = mean(valid.map((row) => row.followup_plan_adherence));
  const coverage = mean(valid.map((row) => row.coverage_rate));
  const status: InformationGainHealth["status"] = !ready || acquisitionRate === null || adherence === null || coverage === null
    ? "collecting"
    : acquisitionRate >= 0.6 && adherence >= 0.6 && coverage >= 0.7
      ? "supported"
      : acquisitionRate < 0.3 || adherence < 0.5 || coverage < 0.5
        ? "rejected"
        : "neutral";
  const evidence = !ready || acquisitionRate === null || adherence === null || coverage === null
    ? `${valid.length}件 / ${users}人（判定には${minimumExperiments}件・${minimumUsers}人）`
    : `情報獲得率 ${round(acquisitionRate)} / 遵守 ${round(adherence)} / 範囲 ${round(coverage)}`;
  return {
    completed_experiments: valid.length,
    users,
    minimum_experiments: minimumExperiments,
    minimum_users: minimumUsers,
    acquisition_rate: ready && acquisitionRate !== null ? round(acquisitionRate) : null,
    median_evidence_latency_hours: ready && medianLatency !== null ? round(medianLatency, 1) : null,
    average_plan_adherence: ready && adherence !== null ? round(adherence) : null,
    average_coverage_rate: ready && coverage !== null ? round(coverage) : null,
    status,
    hypothesis: {
      id: "P11_DIAGNOSTIC_EXPLORATION",
      label: "未観測分野の確認枠は、遵守と範囲を保ちながら14日以内の実測証拠を増やす",
      status,
      evidence,
    },
  };
}
