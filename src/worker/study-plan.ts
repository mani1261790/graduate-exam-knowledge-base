import type { AppUser, ConceptSummary, ProblemListItem, RecommendationMode } from "./domain";
import {
  buildDiagnosticChoicePolicy,
  loadDiagnosticProblemSignals,
  rankDiagnosticProblems,
  type DiagnosticChoicePolicy,
  recordDiagnosticItemExposure,
} from "./diagnostic-items";
import { ulid } from "./id";
import { parseJsonArray } from "./json";
import { activeInformationGainPolicy, buildExplorationNodeSequence, type InformationGainNodeSignal } from "./information-gain";
import { activePlanFocusNodeIds, buildFocusedNodeSequence, type PlanFocusNodeSignal } from "./plan-focus";
import { attachConcepts } from "./repository";
import { recommendationModeEligible, recommendationModeScore } from "./scoring";

export interface StudyGoalInput {
  goal_text: string;
  subject_key: string;
  target_university?: string | null;
  target_graduate_school?: string | null;
  target_department?: string | null;
  target_date?: string | null;
  sessions_per_week?: number;
  minutes_per_session?: number;
}

export interface ActiveStudyGoal {
  id: string;
  goal_text: string;
  subject_key: string;
  target_university: string | null;
  target_graduate_school: string | null;
  target_department: string | null;
  target_date: string | null;
  sessions_per_week: number;
  minutes_per_session: number;
  updated_at: string;
}

export interface StudyPlanNode {
  id: string;
  label: string;
  node_type: "FOUNDATIONAL" | "BASIC" | "CORE" | "APPLICATION";
  layer: number;
  description: string;
  mastery: number;
  evidence_count: number;
  mastery_basis: "prior" | "observed";
  readiness: number;
  status: "completed" | "ready" | "blocked";
  prerequisites: Array<{ id: string; label: string; weight: number; mastery: number }>;
}

export interface StudyPlanItem {
  id: string;
  graph_node_id: string;
  node_label: string;
  problem_id: string | null;
  scheduled_date: string;
  estimated_minutes: number;
  mode: RecommendationMode | "concept";
  status: "pending" | "completed" | "skipped";
  superseded_at: string | null;
  superseded_reason: "overdue_replanned" | null;
  reason: string;
  problem?: ProblemListItem;
  concepts?: ConceptSummary[];
}

type GraphNodeRow = {
  id: string;
  label: string;
  node_type: StudyPlanNode["node_type"];
  layer: number;
  description: string;
  sort_index: number;
  mastery: number | null;
  evidence_count: number;
  review_due: number;
  downstream_weight: number;
};

type GraphEdgeRow = {
  source_node_id: string;
  target_node_id: string;
  weight: number;
  source_label: string;
};

type CandidateProblemRow = Omit<ProblemListItem, "concepts" | "completed"> & {
  graph_node_id: string;
  mastery: number;
  review_due: number;
  has_attempt: number;
  recently_mastered: number;
  explicitly_linked: number;
};

const DAY_MS = 86_400_000;

const NODE_FOCUS_PATTERNS: Record<string, RegExp> = {
  "数学基礎": /数学|関数|数列|数え上げ|方程式|不等式|mathematical[\s-]*foundation/i,
  "微分積分": /微分積分|微分|積分|calculus/i,
  "線形代数": /線形代数|行列|ベクトル|固有値|固有ベクトル|linear[\s-]*algebra/i,
  "確率": /確率|期待値|確率変数|分布|ベイズ|probability/i,
  "常微分方程式": /常微分方程式|微分方程式|ordinary[\s-]*differential/i,
  "多変数微分積分": /多変数|偏微分|重積分|勾配|ヘッセ|multivariable/i,
  "固有値と対角化": /固有値|固有ベクトル|対角化|eigen/i,
  "フーリエ解析": /フーリエ|fourier/i,
  "数値計算": /数値計算|数値解析|ニュートン法|誤差|numerical/i,
  "統計": /統計|推定|検定|回帰|標本|statistic/i,
  "ラプラス変換": /ラプラス|laplace/i,
  "電気回路": /電気回路|回路解析|キルヒホッフ|インピーダンス|electric[\s-]*circuit/i,
  "信号処理": /信号処理|signal[\s-]*processing|畳み込み|サンプリング|標本化|フィルタ/i,
  "制御システム": /制御システム|制御工学|伝達関数|状態空間|フィードバック|control/i,
  "暗号・符号": /暗号|符号|cryptograph|coding[\s-]*theory/i,
  "通信システム": /通信システム|情報通信|通信路|変調|復調|communication/i,
  "統計モデリング": /統計モデリング|統計モデル|回帰|尤度|推定|statistical[\s-]*model/i,
  "機械学習": /機械学習|machine[\s-]*learning|学習アルゴリズム|教師あり|教師なし/i,
  "データ分析": /データ分析|data[\s-]*analysis|回帰|分類|クラスタ|主成分/i,
  "機械学習応用": /機械学習応用|machine[\s-]*learning|ニューラル|深層学習|モデル評価/i,
  "AIと情報社会": /ai|人工知能|情報社会|倫理|公平性|説明可能/i,
  "物理学": /物理学|physics|物理問題/i,
  "化学": /化学|chemistry|化学反応/i,
  "生命科学": /生命科学|生物|life[\s-]*science/i,
  "力学": /力学|mechanics|運動方程式|振動/i,
  "電磁気学": /電磁気|electromagnet|マクスウェル|電場|磁場/i,
  "熱力学": /熱力学|thermodynamic|エントロピー|熱機関/i,
  "量子力学": /量子力学|quantum|シュレディンガー/i,
  "有機化学": /有機化学|organic[\s-]*chemistry|有機化合物/i,
  "分子生物学": /分子生物学|molecular[\s-]*biology|dna|rna|遺伝/i,
  "材料科学": /材料科学|materials[\s-]*science|材料力学|物性/i,
  "応用科学": /応用化学|物理化学|生命情報|科学技術/i,
  "専門英語": /専門英語|technical[\s-]*english|英語/i,
  "科学英語": /科学英語|scientific[\s-]*english|英語/i,
  "学術読解・論述": /学術読解|論述|academic[\s-]*reading|academic[\s-]*writing|英文/i,
  "入試学術英語": /入試.*英語|学術英語|academic[\s-]*english|英語/i,
  "人間社会情報": /人間社会情報|社会情報|情報社会|メディア/i,
  "経済経営": /経済|経営|economics|management/i,
  "心理・臨床心理": /心理|psychology|臨床/i,
  "教育・福祉": /教育|福祉|education|welfare/i,
  "社会経営・人文学": /社会|経営|人文|倫理|歴史|言語|文学/i,
  "社会課題と情報": /社会課題|情報社会|ai|政策|制度|倫理/i,
  "計算機基礎": /計算機基礎|コンピュータ基礎|情報基礎|計算機|computer[\s-]*fundamental/i,
  "論理回路": /論理回路|ブール|真理値表|フリップフロップ|ゲート|circuit/i,
  "プログラミング言語": /プログラミング言語|programming[\s-]*language|型システム|コンパイラ|言語処理/i,
  "計算機アーキテクチャ": /アーキテクチャ|命令セット|パイプライン|キャッシュ|computer[\s-]*architecture/i,
  "オペレーティングシステム": /オペレーティングシステム|operating[\s-]*system|プロセス|仮想記憶|スケジューリング/i,
  "データベース": /データベース|database|sql|関係データベース/i,
  "ネットワーク通信": /ネットワーク通信|コンピュータネットワーク|通信プロトコル|tcp|ip|network/i,
  "ソフトウェア工学": /ソフトウェア工学|software[\s-]*engineering|要求分析|テスト|設計パターン/i,
  "計算機システム": /計算機システム|コンピュータシステム|computer[\s-]*system/i,
  "論理": /論理|命題|真理値|述語|演繹|必要十分/i,
  "集合": /集合|部分集合|写像|関係|set[\s-]*theory/i,
  "証明": /証明|背理|帰納|不変条件|proof/i,
  "離散数学": /離散|組合せ|数え上げ|順列|combina/i,
  "アルゴリズム": /アルゴリズム|algorithm/i,
  "データ構造": /データ構造|配列|リスト|スタック|キュー|二分木|ヒープ|ハッシュ|data[\s-]*structure/i,
  "計算量": /計算量|complexity|\bbig[\s-]*o\b/i,
  "プログラミングシステム": /プログラミング|プログラム|ソフトウェア|operating[\s-]*system|\bos\b/i,
  "ソート": /ソート|sort/i,
  "グラフ理論": /グラフ|graph|\b木\b|全域|最短|最長|連結|閉路|彩色|カット|マッチング|フロー|dijkstra|ダイクストラ|pagerank|トポロジカル|hamilton|オイラー|巡回路|隣接|経路|\bdag\b|有向|二部/i,
  "グラフ探索": /グラフ探索|graph search|幅優先|深さ優先|\bbfs\b|\bdfs\b|到達可能|探索|走査/i,
  "Union-Find": /union[\s-]*find|素集合|disjoint[\s-]*set|併合|連結判定/i,
  "オートマトン": /オートマトン|automaton|形式言語|正規言語|状態遷移/i,
  "情報理論": /情報理論|information[\s-]*theory|エントロピー|符号化|通信路/i,
  "最適化": /最適化|optimization|最適解|目的関数|制約条件/i,
  "グラフアルゴリズム": /グラフアルゴリズム|最短路|最小全域木|ネットワークフロー|最大流|最小カット/i,
  "動的計画法": /動的計画|dynamic[\s-]*programming|\bdp\b|漸化|部分問題|ナップサック|最適部分構造|最長共通部分|edit[\s-]*distance/i,
};

function normalizedText(value: string | null | undefined): string {
  return (value ?? "").trim().toLocaleLowerCase("ja-JP").replace(/[\s　・()（）「」『』:：,，.．]/g, "");
}

/**
 * A concept tag alone can be shared by an application-domain question. Prefer
 * candidates whose printed title directly signals the graph node being studied.
 * If an imported graph introduces a new label, an exact label match remains a
 * safe generic fallback.
 */
export function studyPlanProblemMatchesNode(nodeLabel: string, problemLabel: string): boolean {
  const title = problemLabel.trim();
  const normalizedNode = normalizedText(nodeLabel);
  if (normalizedNode && normalizedText(title).includes(normalizedNode)) return true;
  const pattern = NODE_FOCUS_PATTERNS[nodeLabel];
  if (!pattern) return false;
  return pattern.test(title);
}

export function targetInstitutionMatch(
  target: Pick<StudyGoalInput, "target_university" | "target_graduate_school" | "target_department">,
  problem: Pick<ProblemListItem, "university" | "graduate_school" | "department">,
): number {
  const matches = (left: string | null | undefined, right: string | null | undefined) => {
    const a = normalizedText(left);
    const b = normalizedText(right);
    return Boolean(a && b && (a === b || (a.length >= 4 && b.length >= 4 && (a.includes(b) || b.includes(a)))));
  };
  if (matches(target.target_department, problem.department)) return 1;
  if (matches(target.target_graduate_school, problem.graduate_school)) return 0.85;
  if (matches(target.target_university, problem.university)) return 0.7;
  return 0;
}

export function excludePreviouslyScheduledProblems<T extends { id: string }>(candidates: T[], usedIds: ReadonlySet<string>): T[] {
  return candidates.filter((candidate) => !usedIds.has(candidate.id));
}

export function evaluateNodeReadiness(
  mastery: number,
  prerequisites: Array<{ weight: number; mastery: number }>,
): { readiness: number; status: "completed" | "ready" | "blocked" } {
  const required = prerequisites.filter((item) => item.weight >= 0.8);
  const readiness = required.length === 0
    ? 1
    : required.reduce((sum, item) => sum + item.mastery * item.weight, 0) / required.reduce((sum, item) => sum + item.weight, 0);
  return {
    readiness,
    status: mastery >= 0.8 ? "completed" : required.every((item) => item.mastery >= 0.6) ? "ready" : "blocked",
  };
}

/**
 * Shrink sparse observations toward a neutral prior. This prevents one early
 * result from being presented as a stable weakness while still converging to
 * the observed mastery as evidence accumulates.
 */
export function conservativeNodeMastery(observedMastery: number | null, evidenceCount: number, priorWeight = 3): number {
  if (observedMastery === null || evidenceCount <= 0) return 0.5;
  const evidence = Math.max(0, evidenceCount);
  const prior = Math.max(0, priorWeight);
  return Math.min(1, Math.max(0, (observedMastery * evidence + 0.5 * prior) / (evidence + prior)));
}

export function buildScheduledDays(start: Date, sessionsPerWeek: number): string[] {
  const days: string[] = [];
  for (let week = 0; week < 2; week += 1) {
    for (let session = 0; session < sessionsPerWeek; session += 1) {
      const offset = week * 7 + Math.floor(session * 7 / sessionsPerWeek);
      days.push(isoDay(new Date(start.getTime() + offset * DAY_MS)));
    }
  }
  return days;
}

export function conceptSessionMinutes(configuredMinutes: number): number {
  return Math.min(180, Math.max(15, Math.round(configuredMinutes)));
}

function isoDay(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function clampInteger(value: number | undefined, fallback: number, min: number, max: number): number {
  if (!Number.isInteger(value)) return fallback;
  return Math.min(max, Math.max(min, Number(value)));
}

function validateGoal(input: StudyGoalInput): Required<Pick<StudyGoalInput, "goal_text" | "subject_key">> & StudyGoalInput {
  const goalText = input.goal_text?.trim();
  const subjectKey = input.subject_key?.trim();
  if (!goalText || goalText.length > 500) throw new Error("goal_text must be 1..500 characters");
  if (!subjectKey || subjectKey.length > 100) throw new Error("subject_key must be 1..100 characters");
  if (input.target_date && !/^\d{4}-\d{2}-\d{2}$/.test(input.target_date)) throw new Error("target_date must be YYYY-MM-DD");
  const normalizeTarget = (value: string | null | undefined, label: string) => {
    if (value == null || value.trim() === "") return null;
    const normalized = value.trim();
    if (normalized.length > 100) throw new Error(`${label} must be 1..100 characters`);
    return normalized;
  };
  return {
    ...input,
    goal_text: goalText,
    subject_key: subjectKey,
    target_university: normalizeTarget(input.target_university, "target_university"),
    target_graduate_school: normalizeTarget(input.target_graduate_school, "target_graduate_school"),
    target_department: normalizeTarget(input.target_department, "target_department"),
  };
}

export async function upsertStudyGoal(db: D1Database, userId: string, input: StudyGoalInput) {
  const normalized = validateGoal(input);
  const sessionsPerWeek = clampInteger(normalized.sessions_per_week, 5, 1, 7);
  const minutesPerSession = clampInteger(normalized.minutes_per_session, 45, 15, 180);
  const existing = await db.prepare("SELECT id FROM user_goals WHERE user_id = ? AND is_active = 1 ORDER BY updated_at DESC LIMIT 1")
    .bind(userId).first<{ id: string }>();
  const goalId = existing?.id ?? ulid("goal");
  const now = new Date().toISOString();
  await db.batch([
    db.prepare("UPDATE user_goals SET is_active = 0, updated_at = ? WHERE user_id = ? AND id <> ?").bind(now, userId, goalId),
    db.prepare(
      `UPDATE learning_schedule_adaptation_experiments SET cancelled_at = ?
       WHERE user_id = ? AND completed_at IS NULL AND cancelled_at IS NULL`,
    ).bind(now, userId),
    db.prepare(
      `UPDATE learning_plan_focus_experiments SET cancelled_at = ?
       WHERE user_id = ? AND completed_at IS NULL AND cancelled_at IS NULL`,
    ).bind(now, userId),
    db.prepare(
      `UPDATE learning_information_gain_experiments SET cancelled_at = ?
       WHERE user_id = ? AND completed_at IS NULL AND cancelled_at IS NULL`,
    ).bind(now, userId),
    db.prepare(
      `UPDATE learning_diagnostic_item_exposures SET cancelled_at = ?
       WHERE user_id = ? AND observed_at IS NULL AND cancelled_at IS NULL`,
    ).bind(now, userId),
    db.prepare(
      `INSERT INTO user_goals (
        id, user_id, target_university, target_graduate_school, target_department, exam_month,
        target_subjects, priority_concept_ids, goal_text, target_date, sessions_per_week,
        minutes_per_session, is_active, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, '[]', ?, ?, ?, ?, 1, ?)
      ON CONFLICT(id) DO UPDATE SET
        target_university = excluded.target_university,
        target_graduate_school = excluded.target_graduate_school,
        target_department = excluded.target_department,
        exam_month = excluded.exam_month,
        target_subjects = excluded.target_subjects,
        goal_text = excluded.goal_text,
        target_date = excluded.target_date,
        sessions_per_week = excluded.sessions_per_week,
        minutes_per_session = excluded.minutes_per_session,
        is_active = 1,
        updated_at = excluded.updated_at`,
    ).bind(
      goalId,
      userId,
      normalized.target_university ?? null,
      normalized.target_graduate_school ?? null,
      normalized.target_department ?? null,
      normalized.target_date?.slice(0, 7) ?? null,
      JSON.stringify([normalized.subject_key]),
      normalized.goal_text,
      normalized.target_date ?? null,
      sessionsPerWeek,
      minutesPerSession,
      now,
    ),
  ]);
  return getActiveStudyGoal(db, userId);
}

export async function getActiveStudyGoal(db: D1Database, userId: string): Promise<ActiveStudyGoal | null> {
  const row = await db.prepare(
    `SELECT id, goal_text, target_university, target_graduate_school, target_department,
            target_date, target_subjects, sessions_per_week, minutes_per_session, updated_at
     FROM user_goals WHERE user_id = ? AND is_active = 1 ORDER BY updated_at DESC LIMIT 1`,
  ).bind(userId).first<Record<string, unknown>>();
  if (!row) return null;
  return {
    id: String(row.id),
    goal_text: String(row.goal_text ?? ""),
    subject_key: parseJsonArray<string>(String(row.target_subjects ?? "[]"))[0] ?? "",
    target_university: row.target_university == null ? null : String(row.target_university),
    target_graduate_school: row.target_graduate_school == null ? null : String(row.target_graduate_school),
    target_department: row.target_department == null ? null : String(row.target_department),
    target_date: row.target_date == null ? null : String(row.target_date),
    sessions_per_week: Number(row.sessions_per_week),
    minutes_per_session: Number(row.minutes_per_session),
    updated_at: String(row.updated_at),
  };
}

async function activeGraphForSubject(db: D1Database, subjectKey: string) {
  return db.prepare(
    `SELECT id, topic, subject_key, source_repository, source_commit
     FROM learning_graphs WHERE subject_key = ? AND status = 'active'
     ORDER BY activated_at DESC, created_at DESC LIMIT 1`,
  ).bind(subjectKey).first<{ id: string; topic: string; subject_key: string; source_repository: string; source_commit: string }>();
}

export async function hasActiveLearningGraph(db: D1Database, subjectKey: string): Promise<boolean> {
  return Boolean(await activeGraphForSubject(db, subjectKey));
}

async function loadGraphState(db: D1Database, graphId: string, userId: string) {
  const [nodesResult, edgesResult] = await Promise.all([
    db.prepare(
      `SELECT n.id, n.label, n.node_type, n.layer, n.description, n.sort_index,
              SUM(CASE WHEN ucs.evidence_count > 0
                       THEN ucs.mastery_score * l.confidence * MIN(ucs.evidence_count, 10) END)
                / NULLIF(SUM(CASE WHEN ucs.evidence_count > 0
                                  THEN l.confidence * MIN(ucs.evidence_count, 10) END), 0) AS mastery,
              COALESCE(SUM(ucs.evidence_count), 0) AS evidence_count,
              MAX(CASE WHEN ucs.review_due_at IS NOT NULL AND ucs.review_due_at <= datetime('now') THEN 1 ELSE 0 END) AS review_due,
              COALESCE((SELECT SUM(e2.weight) FROM learning_graph_edges e2 WHERE e2.graph_id = n.graph_id AND e2.source_node_id = n.id), 0) AS downstream_weight
       FROM learning_graph_nodes n
       LEFT JOIN learning_graph_concept_links l ON l.graph_node_id = n.id AND l.status = 'approved'
       LEFT JOIN user_concept_states ucs ON ucs.concept_id = l.concept_id AND ucs.user_id = ?
       WHERE n.graph_id = ?
       GROUP BY n.id
       ORDER BY n.layer, n.sort_index, n.id`,
    ).bind(userId, graphId).all<GraphNodeRow>(),
    db.prepare(
      `SELECT e.source_node_id, e.target_node_id, e.weight, source.label AS source_label
       FROM learning_graph_edges e
       JOIN learning_graph_nodes source ON source.id = e.source_node_id
       WHERE e.graph_id = ?`,
    ).bind(graphId).all<GraphEdgeRow>(),
  ]);

  const masteryByNode = new Map(nodesResult.results.map((node) => [
    node.id,
    conservativeNodeMastery(node.mastery == null ? null : Number(node.mastery), Number(node.evidence_count)),
  ]));
  const edgesByTarget = new Map<string, GraphEdgeRow[]>();
  for (const edge of edgesResult.results) {
    const edges = edgesByTarget.get(edge.target_node_id) ?? [];
    edges.push(edge);
    edgesByTarget.set(edge.target_node_id, edges);
  }

  const nodes: StudyPlanNode[] = nodesResult.results.map((node) => {
    const prerequisites = (edgesByTarget.get(node.id) ?? []).map((edge) => ({
      id: edge.source_node_id,
      label: edge.source_label,
      weight: Number(edge.weight),
      mastery: masteryByNode.get(edge.source_node_id) ?? 0,
    }));
    const evidenceCount = Number(node.evidence_count);
    const mastery = conservativeNodeMastery(node.mastery == null ? null : Number(node.mastery), evidenceCount);
    const readinessResult = evaluateNodeReadiness(mastery, prerequisites);
    return {
      id: node.id,
      label: node.label,
      node_type: node.node_type,
      layer: Number(node.layer),
      description: node.description,
      mastery,
      evidence_count: evidenceCount,
      mastery_basis: evidenceCount > 0 ? "observed" : "prior",
      readiness: readinessResult.readiness,
      status: readinessResult.status,
      prerequisites,
    };
  });

  const rowById = new Map(nodesResult.results.map((row) => [row.id, row]));
  nodes.sort((left, right) => {
    const leftRow = rowById.get(left.id)!;
    const rightRow = rowById.get(right.id)!;
    return Number(rightRow.review_due) - Number(leftRow.review_due)
      || left.layer - right.layer
      || left.mastery - right.mastery
      || Number(rightRow.downstream_weight) - Number(leftRow.downstream_weight)
      || left.id.localeCompare(right.id);
  });
  return { nodes, rows: nodesResult.results };
}

function modeForNode(node: StudyPlanNode, row: GraphNodeRow): RecommendationMode {
  if (Number(row.review_due) > 0) return "review";
  if (node.mastery < 0.4) return "foundation";
  if (node.mastery >= 0.75 && node.readiness >= 0.6) return "challenge";
  return "normal";
}

async function candidateProblems(db: D1Database, graphId: string, userId: string): Promise<CandidateProblemRow[]> {
  const { results } = await db.prepare(
    `SELECT DISTINCT l.graph_node_id, p.id, p.problem_label, p.statement_text, p.page_start, p.page_end,
            sd.university, sd.graduate_school, sd.department, sd.exam_year, sd.source_url,
            sd.pdf_display_mode, sd.source_status, p.subject_raw, p.difficulty, p.estimated_minutes,
            p.answer_format, p.status, p.answer_text, p.explanation_text,
            COALESCE(ucs.mastery_score, 0) AS mastery,
            CASE WHEN ucs.review_due_at IS NOT NULL AND ucs.review_due_at <= datetime('now') THEN 1 ELSE 0 END AS review_due,
            EXISTS(SELECT 1 FROM attempts a WHERE a.user_id = ? AND a.problem_id = p.id) AS has_attempt,
            EXISTS(SELECT 1 FROM attempts a WHERE a.user_id = ? AND a.problem_id = p.id AND a.score_rate >= 0.85 AND a.created_at >= datetime('now', '-30 days')) AS recently_mastered
            , EXISTS(
                SELECT 1 FROM learning_graph_problem_links lgpl
                WHERE lgpl.graph_node_id = l.graph_node_id AND lgpl.problem_id = p.id
                  AND lgpl.relation_type = 'direct' AND lgpl.status = 'approved'
              ) AS explicitly_linked
     FROM learning_graph_concept_links l
     JOIN concepts mapped_concept ON mapped_concept.id = l.concept_id AND mapped_concept.status = 'active'
     JOIN node_registry nr_concept ON nr_concept.entity_type = 'concept' AND nr_concept.entity_id = l.concept_id
     JOIN knowledge_edges ke ON ke.to_node_id = nr_concept.node_id AND ke.status = 'approved' AND ke.edge_type IN ('tests', 'requires')
     JOIN node_registry nr_problem ON nr_problem.node_id = ke.from_node_id AND nr_problem.entity_type = 'problem'
     JOIN problems p ON p.id = nr_problem.entity_id AND p.status = 'reviewed'
     JOIN source_documents sd ON sd.id = p.source_document_id
     LEFT JOIN user_concept_states ucs ON ucs.user_id = ? AND ucs.concept_id = l.concept_id
     WHERE l.status = 'approved' AND l.graph_node_id IN (SELECT id FROM learning_graph_nodes WHERE graph_id = ?)
       AND (
         (sd.source_url IS NOT NULL AND sd.source_url <> '' AND LOWER(sd.source_url) LIKE 'https://%')
         OR EXISTS (
           SELECT 1 FROM diagnostic_problem_contents dpc
           WHERE dpc.problem_id = p.id AND dpc.status = 'approved' AND dpc.materialized_at IS NOT NULL
         )
       )
       AND sd.access_scope IN ('source_link_only', 'public_ready')
       AND sd.source_status = 'active'`,
  ).bind(userId, userId, userId, graphId).all<CandidateProblemRow>();
  return results;
}

export async function generateStudyPlan(db: D1Database, user: AppUser) {
  const goal = await getActiveStudyGoal(db, user.id);
  if (!goal) throw new Error("学習目標を先に設定してください。");
  const graph = await activeGraphForSubject(db, String(goal.subject_key));
  if (!graph) throw new Error("この科目の学習グラフはまだ準備されていません。");
  const now = new Date();
  const generatedAt = now.toISOString();
  await db.prepare(
    `UPDATE study_plans SET status = 'archived', updated_at = ?
     WHERE user_id = ? AND status = 'active' AND (goal_id <> ? OR graph_id <> ?)`,
  ).bind(generatedAt, user.id, String(goal.id), graph.id).run();
  const existing = await db.prepare(
    "SELECT id FROM study_plans WHERE user_id = ? AND goal_id = ? AND graph_id = ? AND status = 'active' LIMIT 1",
  ).bind(user.id, String(goal.id), graph.id).first<{ id: string }>();
  const planId = existing?.id ?? ulid("plan");
  await db.prepare(
    `INSERT INTO study_plans (id, user_id, goal_id, graph_id, status, start_date, target_date, sessions_per_week, minutes_per_session, generated_at, updated_at)
     VALUES (?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET target_date = excluded.target_date, sessions_per_week = excluded.sessions_per_week,
       minutes_per_session = excluded.minutes_per_session, generated_at = excluded.generated_at, updated_at = excluded.updated_at`,
  ).bind(
    planId, user.id, String(goal.id), graph.id, isoDay(now), goal.target_date ?? null,
    Number(goal.sessions_per_week), Number(goal.minutes_per_session), generatedAt, generatedAt,
  ).run();

  const { nodes, rows } = await loadGraphState(db, graph.id, user.id);
  const rowById = new Map(rows.map((row) => [row.id, row]));
  const candidates = await candidateProblems(db, graph.id, user.id);
  const byNode = new Map<string, CandidateProblemRow[]>();
  for (const candidate of candidates) {
    const list = byNode.get(candidate.graph_node_id) ?? [];
    list.push(candidate);
    byNode.set(candidate.graph_node_id, list);
  }
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  for (const [nodeId, nodeCandidates] of byNode) {
    const node = nodeById.get(nodeId);
    if (!node) continue;
    const focusedById = new Map<string, CandidateProblemRow>();
    for (const candidate of nodeCandidates) {
      if (Number(candidate.explicitly_linked) !== 1 && !studyPlanProblemMatchesNode(node.label, candidate.problem_label)) continue;
      const current = focusedById.get(candidate.id);
      if (!current || Number(candidate.review_due) > Number(current.review_due)) focusedById.set(candidate.id, candidate);
    }
    const focusedCandidates = [...focusedById.values()];
    // When an imported graph introduces a label without a focused candidate,
    // surface the mapped concept task instead of guessing from a broad tag.
    if (focusedCandidates.length > 0) byNode.set(nodeId, focusedCandidates);
    else byNode.set(nodeId, []);
  }
  const usedRecently = await db.prepare(
    `SELECT problem_id FROM study_plan_items WHERE plan_id = ? AND problem_id IS NOT NULL
     AND status IN ('completed', 'skipped') AND scheduled_date >= date('now', '-14 days')`,
  ).bind(planId).all<{ problem_id: string }>();
  const usedIds = new Set(usedRecently.results.map((item) => item.problem_id));
  const completedConceptItems = await db.prepare(
    `SELECT graph_node_id, scheduled_date FROM study_plan_items
     WHERE plan_id = ? AND problem_id IS NULL AND status IN ('completed', 'skipped')`,
  ).bind(planId).all<{ graph_node_id: string; scheduled_date: string }>();
  const completedConceptKeys = new Set(completedConceptItems.results.map((item) => `${item.graph_node_id}:${item.scheduled_date}`));
  // Keep already-missed sessions as evidence. Removing them here would let a
  // user make plan adherence look perfect simply by regenerating the plan.
  // Today's and future work has not matured yet, so it can be replaced safely.
  await db.batch([
    db.prepare(
      `UPDATE study_plan_items
       SET superseded_at = ?, superseded_reason = 'overdue_replanned'
       WHERE plan_id = ? AND status = 'pending' AND superseded_at IS NULL
         AND scheduled_date < ?`,
    ).bind(generatedAt, planId, isoDay(now)),
    db.prepare(
      `DELETE FROM study_plan_items
       WHERE plan_id = ? AND status = 'pending' AND superseded_at IS NULL
         AND scheduled_date >= ?`,
    ).bind(planId, isoDay(now)),
    db.prepare(
      `DELETE FROM study_plan_items
       WHERE plan_id = ? AND superseded_at IS NOT NULL
         AND scheduled_date < date(?, '-180 days')`,
    ).bind(planId, isoDay(now)),
  ]);

  const days = buildScheduledDays(now, Number(goal.sessions_per_week));
  const readyNodes = nodes.filter((node) => node.status === "ready");
  const activeFocusIds = await activePlanFocusNodeIds(db, user.id, goal.id);
  const activeExploration = activeFocusIds.length === 0
    ? await activeInformationGainPolicy(db, user.id, goal.id)
    : null;
  const focusSignals = readyNodes.map((node) => {
    const row = rowById.get(node.id)!;
    return {
      id: node.id,
      label: node.label,
      status: node.status,
      mastery: node.mastery,
      evidence_count: node.evidence_count,
      review_due: Number(row.review_due) > 0,
      downstream_weight: Number(row.downstream_weight),
      layer: node.layer,
    } satisfies PlanFocusNodeSignal;
  });
  const scheduledNodes = activeFocusIds.length > 0
    ? buildFocusedNodeSequence(focusSignals, activeFocusIds, days.length)
    : activeExploration
      ? buildExplorationNodeSequence(
          focusSignals.map((node) => ({ ...node, available_problem_count: byNode.get(node.id)?.length ?? 0 })),
          activeExploration.nodeId,
          days.length,
        )
      : readyNodes;
  const diagnosticRanking = activeExploration
    ? rankDiagnosticProblems(await loadDiagnosticProblemSignals(db, user.id, activeExploration.nodeId))
    : [];
  let diagnosticExposure: DiagnosticChoicePolicy | null = null;
  const inserts: D1PreparedStatement[] = [];
  let sequence = 0;
  for (let dayIndex = 0; dayIndex < days.length && scheduledNodes.length > 0; dayIndex += 1) {
    const scheduledNode = scheduledNodes[dayIndex % scheduledNodes.length];
    const node = nodeById.get(scheduledNode.id)!;
    const row = rowById.get(node.id)!;
    const mode = modeForNode(node, row);
    // One problem should not fill several sessions in the same two-week plan.
    // A due review is still selected once; subsequent sessions use another
    // relevant problem or fall back to a focused concept session.
    const availableProblems = excludePreviouslyScheduledProblems(byNode.get(node.id) ?? [], usedIds);
    const eligibleProblems = availableProblems.filter((problem) => {
      const input = {
        difficulty: Number(problem.difficulty), weakness: 1 - node.mastery, targetMatch: 1,
        prerequisiteReadiness: node.readiness, reviewDue: Number(problem.review_due),
        hasAttempt: Boolean(problem.has_attempt), recentlyMastered: Boolean(problem.recently_mastered),
      };
      return recommendationModeEligible(mode, input);
    });
    const baselineCandidates = [...(eligibleProblems.length > 0 ? eligibleProblems : availableProblems)].sort((left, right) => {
      const score = (problem: CandidateProblemRow) => recommendationModeScore(mode, {
        difficulty: Number(problem.difficulty), weakness: 1 - node.mastery, targetMatch: 1,
        prerequisiteReadiness: node.readiness, reviewDue: Number(problem.review_due),
        hasAttempt: Boolean(problem.has_attempt), recentlyMastered: Boolean(problem.recently_mastered),
      }) + targetInstitutionMatch(goal, problem) * 0.35;
      return score(right) - score(left) || left.id.localeCompare(right.id);
    });
    const isDiagnosticExploration = Boolean(activeExploration && node.id === activeExploration.nodeId);
    const diagnosticPolicy = isDiagnosticExploration
      ? buildDiagnosticChoicePolicy(baselineCandidates.map((problem) => problem.id), diagnosticRanking)
      : null;
    const modeCandidates = diagnosticPolicy
      ? [
          baselineCandidates.find((problem) => problem.id === diagnosticPolicy.selected.problem_id)!,
          ...baselineCandidates.filter((problem) => problem.id !== diagnosticPolicy.selected.problem_id),
        ]
      : baselineCandidates;
    let remaining = Number(goal.minutes_per_session);
    let selected = 0;
    for (const problem of modeCandidates) {
      if (selected >= (isDiagnosticExploration ? 1 : 3)) break;
      if (selected > 0 && Number(problem.estimated_minutes) > remaining * 1.1) continue;
      sequence += 1;
      selected += 1;
      remaining -= Number(problem.estimated_minutes);
      usedIds.add(problem.id);
      if (isDiagnosticExploration && !diagnosticExposure) {
        if (diagnosticPolicy && problem.id === diagnosticPolicy.selected.problem_id) diagnosticExposure = diagnosticPolicy;
      }
      inserts.push(db.prepare(
        `INSERT OR IGNORE INTO study_plan_items (id, plan_id, graph_node_id, problem_id, sequence, scheduled_date, estimated_minutes, mode, status, reason)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
      ).bind(ulid("spi"), planId, node.id, problem.id, sequence, days[dayIndex], Number(problem.estimated_minutes), mode,
        `${node.label}の${mode === "review" ? "復習" : mode === "foundation" ? "基礎固め" : mode === "challenge" ? "発展演習" : "演習"}`));
      if (remaining <= 5) break;
    }
    if (selected === 0) {
      if (completedConceptKeys.has(`${node.id}:${days[dayIndex]}`)) continue;
      sequence += 1;
      inserts.push(db.prepare(
        `INSERT OR IGNORE INTO study_plan_items (id, plan_id, graph_node_id, problem_id, sequence, scheduled_date, estimated_minutes, mode, status, reason)
         VALUES (?, ?, ?, NULL, ?, ?, ?, 'concept', 'pending', ?)`,
      ).bind(ulid("spi"), planId, node.id, sequence, days[dayIndex], conceptSessionMinutes(Number(goal.minutes_per_session)), `${node.label}の概念学習`));
    }
  }
  for (let index = 0; index < inserts.length; index += 50) await db.batch(inserts.slice(index, index + 50));
  if (activeExploration && diagnosticExposure) {
    await recordDiagnosticItemExposure(db, {
      userId: user.id,
      goalId: goal.id,
      planId,
      informationGainExperimentId: activeExploration.experimentId,
      graphNodeId: activeExploration.nodeId,
      policy: diagnosticExposure,
    }, now);
  }
  return getCurrentStudyPlan(db, user);
}

export async function getCurrentPlanFocusContext(db: D1Database, userId: string): Promise<{
  planId: string;
  goalId: string;
  sessionCount: number;
  nodes: InformationGainNodeSignal[];
} | null> {
  const plan = await db.prepare(
    `SELECT id, goal_id, graph_id, sessions_per_week
     FROM study_plans WHERE user_id = ? AND status = 'active'
     ORDER BY updated_at DESC LIMIT 1`,
  ).bind(userId).first<{ id: string; goal_id: string; graph_id: string; sessions_per_week: number }>();
  if (!plan) return null;
  const { nodes, rows } = await loadGraphState(db, plan.graph_id, userId);
  const rowById = new Map(rows.map((row) => [row.id, row]));
  const [candidates, usedRecently] = await Promise.all([
    candidateProblems(db, plan.graph_id, userId),
    db.prepare(
      `SELECT problem_id FROM study_plan_items
       WHERE plan_id = ? AND problem_id IS NOT NULL
         AND status IN ('completed', 'skipped') AND scheduled_date >= date('now', '-14 days')`,
    ).bind(plan.id).all<{ problem_id: string }>(),
  ]);
  const usedIds = new Set(usedRecently.results.map((item) => item.problem_id));
  const availableByNode = new Map<string, Set<string>>();
  for (const candidate of candidates) {
    if (usedIds.has(candidate.id)) continue;
    const node = nodes.find((item) => item.id === candidate.graph_node_id);
    if (!node || (Number(candidate.explicitly_linked) !== 1 && !studyPlanProblemMatchesNode(node.label, candidate.problem_label))) continue;
    const ids = availableByNode.get(node.id) ?? new Set<string>();
    ids.add(candidate.id);
    availableByNode.set(node.id, ids);
  }
  return {
    planId: plan.id,
    goalId: plan.goal_id,
    sessionCount: Math.max(0, Math.round(Number(plan.sessions_per_week)) * 2),
    nodes: nodes.map((node) => {
      const row = rowById.get(node.id)!;
      return {
        id: node.id,
        label: node.label,
        status: node.status,
        mastery: node.mastery,
        evidence_count: node.evidence_count,
        review_due: Number(row.review_due) > 0,
        downstream_weight: Number(row.downstream_weight),
        layer: node.layer,
        available_problem_count: availableByNode.get(node.id)?.size ?? 0,
      };
    }),
  };
}

export async function getCurrentFocusMastery(
  db: D1Database,
  userId: string,
  goalId: string,
  focusNodeIds: readonly string[],
): Promise<number | null> {
  const plan = await db.prepare(
    `SELECT graph_id FROM study_plans
     WHERE user_id = ? AND goal_id = ? ORDER BY updated_at DESC LIMIT 1`,
  ).bind(userId, goalId).first<{ graph_id: string }>();
  if (!plan || focusNodeIds.length === 0) return null;
  const { nodes } = await loadGraphState(db, plan.graph_id, userId);
  const focusSet = new Set(focusNodeIds);
  const focused = nodes.filter((node) => focusSet.has(node.id));
  if (focused.length === 0) return null;
  const weight = focused.reduce((sum, node) => sum + Math.max(1, node.evidence_count), 0);
  return focused.reduce((sum, node) => sum + node.mastery * Math.max(1, node.evidence_count), 0) / weight;
}

export async function getCurrentStudyPlan(db: D1Database, user: AppUser) {
  const plan = await db.prepare(
    `SELECT sp.*, lg.topic, lg.subject_key, lg.source_repository, lg.source_commit,
            ug.goal_text, ug.target_university, ug.target_graduate_school, ug.target_department
     FROM study_plans sp JOIN learning_graphs lg ON lg.id = sp.graph_id JOIN user_goals ug ON ug.id = sp.goal_id
     WHERE sp.user_id = ? AND sp.status = 'active' ORDER BY sp.updated_at DESC LIMIT 1`,
  ).bind(user.id).first<Record<string, unknown>>();
  if (!plan) return null;
  const { nodes } = await loadGraphState(db, String(plan.graph_id), user.id);
  const { results } = await db.prepare(
    `SELECT spi.*, n.label AS node_label FROM study_plan_items spi
     JOIN learning_graph_nodes n ON n.id = spi.graph_node_id
     WHERE spi.plan_id = ? AND spi.superseded_at IS NULL
     ORDER BY spi.scheduled_date, spi.sequence`,
  ).bind(String(plan.id)).all<Omit<StudyPlanItem, "problem">>();
  const problemRows = await db.prepare(
    `SELECT DISTINCT p.id, p.problem_label, p.statement_text, p.page_start, p.page_end,
            sd.university, sd.graduate_school, sd.department, sd.exam_year, sd.source_url,
            sd.pdf_display_mode, sd.source_status, p.subject_raw, p.difficulty, p.estimated_minutes,
            p.answer_format, p.status, p.answer_text, p.explanation_text,
            CASE WHEN EXISTS (SELECT 1 FROM attempts a WHERE a.problem_id = p.id AND a.user_id = ?) THEN 1 ELSE 0 END AS completed
     FROM study_plan_items spi JOIN problems p ON p.id = spi.problem_id JOIN source_documents sd ON sd.id = p.source_document_id
     WHERE spi.plan_id = ? AND spi.problem_id IS NOT NULL AND spi.superseded_at IS NULL`,
  ).bind(user.id, String(plan.id)).all<Omit<ProblemListItem, "concepts">>();
  const withConcepts = await attachConcepts(db, problemRows.results, user.id);
  const problems = new Map(withConcepts.map((problem) => [problem.id, problem]));
  const nodeConceptRows = await db.prepare(
    `SELECT l.graph_node_id, c.id, c.slug, c.name_ja, c.concept_type,
            COUNT(DISTINCT CASE
              WHEN p.status = 'reviewed'
               AND sd.source_status = 'active'
               AND sd.access_scope IN ('source_link_only', 'public_ready')
               AND (
                 (sd.source_url IS NOT NULL AND sd.source_url <> '' AND LOWER(sd.source_url) LIKE 'https://%')
                 OR EXISTS (
                   SELECT 1 FROM diagnostic_problem_contents dpc
                   WHERE dpc.problem_id = p.id AND dpc.status = 'approved' AND dpc.materialized_at IS NOT NULL
                 )
               )
              THEN p.id
            END) AS problem_count
     FROM learning_graph_concept_links l
     JOIN concepts c ON c.id = l.concept_id
     LEFT JOIN node_registry nr_concept
       ON nr_concept.entity_type = 'concept' AND nr_concept.entity_id = c.id
     LEFT JOIN knowledge_edges ke
       ON ke.to_node_id = nr_concept.node_id
      AND ke.edge_type = 'tests' AND ke.status = 'approved'
     LEFT JOIN node_registry nr_problem
       ON nr_problem.node_id = ke.from_node_id AND nr_problem.entity_type = 'problem'
     LEFT JOIN problems p ON p.id = nr_problem.entity_id
     LEFT JOIN source_documents sd ON sd.id = p.source_document_id
     WHERE l.status = 'approved' AND l.graph_node_id IN (
       SELECT id FROM learning_graph_nodes WHERE graph_id = ?
     )
     GROUP BY l.graph_node_id, c.id
     ORDER BY c.name_ja`,
  ).bind(String(plan.graph_id)).all<ConceptSummary & { graph_node_id: string }>();
  const conceptsByNode = new Map<string, ConceptSummary[]>();
  for (const concept of nodeConceptRows.results) {
    const concepts = conceptsByNode.get(concept.graph_node_id) ?? [];
    concepts.push({
      id: concept.id,
      slug: concept.slug,
      name_ja: concept.name_ja,
      concept_type: concept.concept_type,
      problem_count: Number(concept.problem_count ?? 0),
    });
    conceptsByNode.set(concept.graph_node_id, concepts);
  }
  const items = results.map((item) => ({
    ...item,
    problem: item.problem_id ? problems.get(item.problem_id) : undefined,
    concepts: conceptsByNode.get(item.graph_node_id) ?? [],
  }));
  const today = isoDay(new Date());
  return { plan, nodes, items, today: items.filter((item) => item.scheduled_date <= today && item.status === "pending") };
}

export async function completeConceptPlanItem(db: D1Database, userId: string, itemId: string, status: "completed" | "skipped") {
  const result = await db.prepare(
    `UPDATE study_plan_items SET status = ?, completed_at = CASE WHEN ? = 'completed' THEN ? ELSE NULL END
     WHERE id = ? AND problem_id IS NULL AND plan_id IN (SELECT id FROM study_plans WHERE user_id = ? AND status = 'active')`,
  ).bind(status, status, new Date().toISOString(), itemId, userId).run();
  return Number(result.meta.changes ?? 0) > 0;
}

export async function markPlanItemsForAttempt(db: D1Database, userId: string, problemId: string) {
  await db.prepare(
    `UPDATE study_plan_items SET status = 'completed', completed_at = ?
     WHERE problem_id = ? AND status = 'pending' AND superseded_at IS NULL
       AND plan_id IN (SELECT id FROM study_plans WHERE user_id = ? AND status = 'active')`,
  ).bind(new Date().toISOString(), problemId, userId).run();
}
