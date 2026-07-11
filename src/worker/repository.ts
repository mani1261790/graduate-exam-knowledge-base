import type { AppUser, ConceptSummary, ProblemDetail, ProblemListItem, RecommendationMode, SimilarProblem } from "./domain";
import { parseJsonArray } from "./json";
import { academicFieldMatch, recommendationModeEligible, recommendationModeScore, similarProblemScore } from "./scoring";

type ProblemRow = Omit<ProblemListItem, "concepts">;

export async function attachConcepts(db: D1Database, problems: ProblemRow[], userId?: string): Promise<ProblemListItem[]> {
  if (problems.length === 0) return [];
  const ids = problems.map((problem) => problem.id);
  const placeholders = ids.map(() => "?").join(",");
  const { results } = await db
    .prepare(
      `SELECT nr_problem.entity_id AS problem_id, c.id, c.slug, c.name_ja, c.concept_type, ucs.mastery_score
       FROM knowledge_edges ke
       JOIN node_registry nr_problem ON nr_problem.node_id = ke.from_node_id
       JOIN node_registry nr_concept ON nr_concept.node_id = ke.to_node_id
       JOIN concepts c ON c.id = nr_concept.entity_id
       LEFT JOIN user_concept_states ucs ON ucs.concept_id = c.id AND ucs.user_id = ?
       WHERE nr_problem.entity_type = 'problem'
         AND nr_concept.entity_type = 'concept'
         AND ke.edge_type IN ('tests', 'requires', 'solved_by')
         AND ke.status = 'approved'
         AND nr_problem.entity_id IN (${placeholders})
       ORDER BY ke.edge_type, c.slug`,
    )
    .bind(userId ?? "", ...ids)
    .all<ConceptSummary & { problem_id: string }>();

  const conceptsByProblem = new Map<string, ConceptSummary[]>();
  for (const row of results) {
    const concepts = conceptsByProblem.get(row.problem_id) ?? [];
    concepts.push({
      id: row.id,
      slug: row.slug,
      name_ja: row.name_ja,
      concept_type: row.concept_type,
      mastery_score: row.mastery_score,
    });
    conceptsByProblem.set(row.problem_id, concepts);
  }

  return problems.map((problem) => ({
    ...problem,
    completed: Boolean(problem.completed),
    concepts: conceptsByProblem.get(problem.id) ?? [],
  }));
}

export async function listProblems(
  db: D1Database,
  user: AppUser,
  filters: {
    q?: string;
    concept?: string;
    university?: string;
    year?: number;
    difficulty?: number;
    status?: string;
    limit?: number;
    offset?: number;
  },
): Promise<ProblemListItem[]> {
  const where: string[] = [];
  const bind: Array<string | number> = [];

  if (filters.university) {
    where.push("sd.university = ?");
    bind.push(filters.university);
  }
  if (filters.year) {
    where.push("sd.exam_year = ?");
    bind.push(filters.year);
  }
  if (filters.difficulty) {
    where.push("p.difficulty = ?");
    bind.push(filters.difficulty);
  }
  if (filters.status) {
    where.push("p.status = ?");
    bind.push(filters.status);
  } else if (user.role === "member") {
    where.push("p.status = 'reviewed'");
  }
  if (filters.q) {
    where.push("(p.statement_text LIKE ? OR p.explanation_text LIKE ? OR sd.university LIKE ? OR p.subject_raw LIKE ?)");
    const query = `%${filters.q}%`;
    bind.push(query, query, query, query);
  }
  if (filters.concept) {
    where.push(
      `p.id IN (
        SELECT nr_problem.entity_id
        FROM knowledge_edges ke
        JOIN node_registry nr_problem ON nr_problem.node_id = ke.from_node_id
        JOIN node_registry nr_concept ON nr_concept.node_id = ke.to_node_id
        JOIN concepts c ON c.id = nr_concept.entity_id
        WHERE nr_problem.entity_type = 'problem'
          AND nr_concept.entity_type = 'concept'
          AND ke.status = 'approved'
          AND (c.id = ? OR c.slug = ? OR c.name_ja LIKE ? OR c.name_en LIKE ? OR c.aliases LIKE ?)
      )`,
    );
    bind.push(filters.concept, filters.concept, `%${filters.concept}%`, `%${filters.concept}%`, `%${filters.concept}%`);
  }

  const sql = `SELECT p.id, p.problem_label, p.statement_text, p.page_start, p.page_end,
                      sd.university, sd.graduate_school, sd.department, sd.exam_year, sd.source_url,
                      p.subject_raw, p.difficulty, p.estimated_minutes, p.answer_format, p.status,
                      p.answer_text, p.explanation_text,
                      CASE WHEN EXISTS (
                        SELECT 1 FROM attempts a WHERE a.problem_id = p.id AND a.user_id = ?
                      ) THEN 1 ELSE 0 END AS completed
               FROM problems p
               JOIN source_documents sd ON sd.id = p.source_document_id
               ${where.length > 0 ? `WHERE ${where.join(" AND ")}` : ""}
               ORDER BY p.status = 'reviewed' DESC, sd.exam_year DESC, p.difficulty ASC
               LIMIT ? OFFSET ?`;

  const { results } = await db.prepare(sql).bind(user.id, ...bind, filters.limit ?? 80, filters.offset ?? 0).all<ProblemRow>();
  return attachConcepts(db, results, user.id);
}

export async function getProblem(db: D1Database, user: AppUser, problemId: string): Promise<ProblemDetail | null> {
  const problem = await db
    .prepare(
      `SELECT p.*, sd.title AS source_title, sd.university, sd.graduate_school, sd.department, sd.exam_year,
              sd.exam_category, sd.source_url, sd.access_scope
       FROM problems p
       JOIN source_documents sd ON sd.id = p.source_document_id
       WHERE p.id = ?`,
    )
    .bind(problemId)
    .first<Record<string, unknown>>();

  if (!problem) return null;
  if (user.role === "member" && problem.status !== "reviewed") return null;

  const concepts = await attachConcepts(
    db,
    [
      {
        id: String(problem.id),
        problem_label: String(problem.problem_label),
        statement_text: String(problem.statement_text ?? ""),
        page_start: problem.page_start == null ? null : Number(problem.page_start),
        page_end: problem.page_end == null ? null : Number(problem.page_end),
        source_url: problem.source_url as string | null,
        university: String(problem.university),
        graduate_school: problem.graduate_school as string | null,
        department: problem.department as string | null,
        exam_year: Number(problem.exam_year),
        subject_raw: problem.subject_raw as string | null,
        difficulty: Number(problem.difficulty),
        estimated_minutes: Number(problem.estimated_minutes),
        answer_format: String(problem.answer_format),
        status: problem.status as ProblemRow["status"],
        answer_text: problem.answer_text as string | null,
        explanation_text: problem.explanation_text as string | null,
        completed: false,
      },
    ],
    user.id,
  );

  const similar = await listSimilarProblems(db, String(problem.id), Number(problem.difficulty));
  const attempts = await db
    .prepare(
      `SELECT id, started_at, submitted_at, time_spent_minutes, score_rate, result, used_hint, looked_solution,
              self_confidence, note, created_at
       FROM attempts
       WHERE user_id = ? AND problem_id = ?
       ORDER BY created_at DESC
       LIMIT 10`,
    )
    .bind(user.id, problemId)
    .all();
  const listItem = concepts[0];
  if (!listItem) return null;

  return {
    ...listItem,
    source_title: String(problem.source_title),
    access_scope: String(problem.access_scope),
    completed: attempts.results.length > 0,
    statement_asset_ids: parseJsonArray<string>(problem.statement_asset_ids as string),
    similar,
    attempts: attempts.results,
  };
}

export async function listSimilarProblems(db: D1Database, problemId: string, difficulty: number): Promise<SimilarProblem[]> {
  const direct = await db
    .prepare(
      `SELECT p.id, p.problem_label, p.statement_text, sd.university, sd.exam_year, p.difficulty, ke.weight AS edge_weight
       FROM knowledge_edges ke
       JOIN node_registry from_node ON from_node.node_id = ke.from_node_id
       JOIN node_registry to_node ON to_node.node_id = ke.to_node_id
       JOIN problems p ON p.id = to_node.entity_id
       JOIN source_documents sd ON sd.id = p.source_document_id
       WHERE from_node.entity_type = 'problem'
         AND to_node.entity_type = 'problem'
         AND from_node.entity_id = ?
         AND ke.edge_type IN ('similar_to', 'same_template_as', 'variant_of', 'easier_version_of', 'prerequisite_problem_of')
         AND ke.status = 'approved'
         AND p.status = 'reviewed'
       LIMIT 10`,
    )
    .bind(problemId)
    .all<SimilarProblem & { edge_weight: number }>();

  return direct.results.map((row) => ({
    id: row.id,
    problem_label: row.problem_label,
    statement_text: row.statement_text,
    university: row.university,
    exam_year: row.exam_year,
    difficulty: row.difficulty,
    score: similarProblemScore({
      conceptScore: row.edge_weight,
      vectorScore: row.edge_weight,
      solutionPatternScore: row.edge_weight,
      difficultyA: difficulty,
      difficultyB: row.difficulty,
    }),
  }));
}

export async function listConcepts(db: D1Database, q?: string): Promise<ConceptSummary[]> {
  const bind: string[] = [];
  const where: string[] = ["c.status = 'active'"];
  if (q) {
    where.push("(c.slug LIKE ? OR c.name_ja LIKE ? OR c.name_en LIKE ? OR c.aliases LIKE ?)");
    bind.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
  }
  const { results } = await db
    .prepare(
      `SELECT
         c.id,
         c.slug,
         c.name_ja,
         c.concept_type,
         COUNT(DISTINCT p.id) AS problem_count
       FROM concepts c
       LEFT JOIN node_registry nr_concept
         ON nr_concept.entity_type = 'concept' AND nr_concept.entity_id = c.id
       LEFT JOIN knowledge_edges ke
         ON ke.to_node_id = nr_concept.node_id
        AND ke.edge_type = 'tests'
        AND ke.status = 'approved'
       LEFT JOIN node_registry nr_problem
         ON nr_problem.node_id = ke.from_node_id AND nr_problem.entity_type = 'problem'
       LEFT JOIN problems p
         ON p.id = nr_problem.entity_id AND p.status = 'reviewed'
       WHERE ${where.join(" AND ")}
       GROUP BY c.id
       ORDER BY problem_count DESC, c.name_ja, c.slug
       LIMIT 500`,
    )
    .bind(...bind)
    .all<ConceptSummary>();
  return results;
}

export async function getConceptDetail(db: D1Database, conceptIdOrSlug: string, userId: string) {
  const concept = await db
    .prepare(
      `SELECT c.*, ucs.mastery_score, ucs.evidence_count, ucs.review_due_at
       FROM concepts c
       LEFT JOIN user_concept_states ucs ON ucs.concept_id = c.id AND ucs.user_id = ?
       WHERE c.id = ? OR c.slug = ?`,
    )
    .bind(userId, conceptIdOrSlug, conceptIdOrSlug)
    .first<Record<string, unknown>>();
  if (!concept) return null;

  const edges = await db
    .prepare(
      `SELECT ke.edge_type, other.entity_type, other.entity_id, other.display_name, ke.weight, ke.confidence
       FROM knowledge_edges ke
       JOIN node_registry self ON self.node_id IN (ke.from_node_id, ke.to_node_id)
       JOIN node_registry other ON other.node_id = CASE
         WHEN self.node_id = ke.from_node_id THEN ke.to_node_id
         ELSE ke.from_node_id
       END
       WHERE self.entity_type = 'concept'
         AND self.entity_id = ?
         AND ke.status = 'approved'
       ORDER BY ke.edge_type, ke.weight DESC
       LIMIT 80`,
    )
    .bind(String(concept.id))
    .all();

  const problems = await db
    .prepare(
      `SELECT p.id, p.problem_label, p.statement_text, p.page_start, p.page_end,
              sd.university, sd.exam_year, sd.source_url, p.difficulty, p.estimated_minutes,
              CASE WHEN EXISTS (
                SELECT 1 FROM attempts a WHERE a.problem_id = p.id AND a.user_id = ?
              ) THEN 1 ELSE 0 END AS completed
       FROM knowledge_edges ke
       JOIN node_registry nr_problem ON nr_problem.node_id = ke.from_node_id
       JOIN node_registry nr_concept ON nr_concept.node_id = ke.to_node_id
       JOIN problems p ON p.id = nr_problem.entity_id
       JOIN source_documents sd ON sd.id = p.source_document_id
       WHERE nr_problem.entity_type = 'problem'
         AND nr_concept.entity_type = 'concept'
         AND nr_concept.entity_id = ?
         AND ke.edge_type IN ('tests', 'requires', 'solved_by')
         AND ke.status = 'approved'
         AND p.status = 'reviewed'
       ORDER BY p.difficulty ASC, sd.exam_year DESC
       LIMIT 40`,
    )
    .bind(userId, String(concept.id))
    .all();

  return {
    ...concept,
    aliases: parseJsonArray<string>(concept.aliases as string),
    edges: edges.results,
    problems: problems.results.map((problem) => ({ ...problem, completed: Boolean(problem.completed) })),
  };
}

export async function buildRecommendations(db: D1Database, userId: string, mode: RecommendationMode): Promise<void> {
  const user = await db.prepare("SELECT department FROM users WHERE id = ?").bind(userId).first<{ department: string | null }>();
  const problems = await db
    .prepare(
      `SELECT p.id, p.difficulty, p.estimated_minutes, sd.university, sd.graduate_school, sd.department, p.subject_raw,
              COALESCE(AVG(CASE WHEN ke.edge_type = 'tests' THEN 1 - COALESCE(ucs.mastery_score, 0.5) END), 0) AS weakness,
              COALESCE(AVG(CASE WHEN ke.edge_type = 'requires' THEN COALESCE(ucs.mastery_score, 0.5) END), 1) AS prerequisite_readiness,
              MAX(CASE WHEN ucs.review_due_at IS NOT NULL AND ucs.review_due_at <= datetime('now') THEN 1 ELSE 0 END) AS review_due,
              EXISTS(SELECT 1 FROM attempts a WHERE a.user_id = ? AND a.problem_id = p.id) AS has_attempt,
              EXISTS(
                SELECT 1 FROM attempts a
                WHERE a.user_id = ? AND a.problem_id = p.id AND a.score_rate >= 0.85
                  AND a.created_at >= datetime('now', '-30 days')
              ) AS recently_mastered
       FROM problems p
       JOIN source_documents sd ON sd.id = p.source_document_id
       LEFT JOIN node_registry nr_problem ON nr_problem.entity_type = 'problem' AND nr_problem.entity_id = p.id
       LEFT JOIN knowledge_edges ke ON ke.from_node_id = nr_problem.node_id
         AND ke.status = 'approved' AND ke.edge_type IN ('tests', 'requires', 'solved_by')
       LEFT JOIN node_registry nr_concept ON nr_concept.node_id = ke.to_node_id AND nr_concept.entity_type = 'concept'
       LEFT JOIN user_concept_states ucs ON ucs.concept_id = nr_concept.entity_id AND ucs.user_id = ?
       WHERE p.status = 'reviewed'
       GROUP BY p.id`,
    )
    .bind(userId, userId, userId)
    .all<Record<string, unknown>>();

  await db.prepare("DELETE FROM recommendation_candidates WHERE user_id = ? AND mode = ?").bind(userId, mode).run();

  const candidates: Array<{ problemId: string; score: number; reasons: string[] }> = [];
  for (const problem of problems.results) {
    const weakness = Number(problem.weakness ?? 0);
    const prerequisiteReadiness = Number(problem.prerequisite_readiness ?? 1);
    const reviewDue = Number(problem.review_due ?? 0);
    const difficulty = Number(problem.difficulty);

    const sourceDepartment = String(problem.department ?? "").trim();
    const subject = String(problem.subject_raw ?? "").trim();
    const subjectIsSpecific = subject && !["一般入試", "専門科目", "基礎科目", "その他"].includes(subject);
    const targetFields = sourceDepartment
      ? [sourceDepartment, subject]
      : subjectIsSpecific
        ? [subject]
        : [String(problem.graduate_school ?? "")];
    const targetMatch = academicFieldMatch(user?.department, targetFields);
    const modeInput = {
      difficulty,
      weakness,
      targetMatch,
      prerequisiteReadiness,
      reviewDue,
      hasAttempt: Boolean(problem.has_attempt),
      recentlyMastered: Boolean(problem.recently_mastered),
    };
    if (!recommendationModeEligible(mode, modeInput)) continue;
    const score = recommendationModeScore(mode, modeInput);
    const modeReason = {
      normal: "今日のバランス演習",
      review: "学習履歴から復習",
      foundation: "基礎レベルを優先",
      challenge: "高難度に挑戦",
    }[mode];
    const reasons = [
      modeReason,
      targetMatch >= 0.8 ? "所属分野に関連" : null,
      weakness >= 0.5 ? "弱点Conceptに一致" : "Concept演習",
      prerequisiteReadiness < 0.35 ? "前提補修" : "前提知識は演習可能",
      reviewDue ? "復習期限" : null,
    ].filter((reason): reason is string => Boolean(reason));
    candidates.push({ problemId: String(problem.id), score, reasons });
  }

  const rankedCandidates = candidates
    .sort((left, right) => right.score - left.score || left.problemId.localeCompare(right.problemId))
    .slice(0, 100);
  for (let start = 0; start < rankedCandidates.length; start += 15) {
    const chunk = rankedCandidates.slice(start, start + 15);
    const values = chunk.map(() => "(?, ?, ?, ?, ?)").join(", ");
    const bindings = chunk.flatMap((candidate) => [userId, candidate.problemId, mode, candidate.score, JSON.stringify(candidate.reasons)]);
    await db.prepare(`INSERT INTO recommendation_candidates (user_id, problem_id, mode, score, reasons) VALUES ${values}`).bind(...bindings).run();
  }
}

export async function listRecommendations(
  db: D1Database,
  user: AppUser,
  mode: RecommendationMode,
  limit = 20,
): Promise<Array<ProblemListItem & { score: number; reasons: string[] }>> {
  const modeReason = {
    normal: "今日のバランス演習",
    review: "学習履歴から復習",
    foundation: "基礎レベルを優先",
    challenge: "高難度に挑戦",
  }[mode];
  let rows = await db
    .prepare(
      `SELECT p.id, p.problem_label, p.statement_text, p.page_start, p.page_end,
              sd.university, sd.graduate_school, sd.department, sd.exam_year, sd.source_url,
              p.subject_raw, p.difficulty, p.estimated_minutes, p.answer_format, p.status,
              p.answer_text, p.explanation_text, rc.score, rc.reasons,
              CASE WHEN EXISTS (
                SELECT 1 FROM attempts a WHERE a.problem_id = p.id AND a.user_id = ?
              ) THEN 1 ELSE 0 END AS completed
       FROM recommendation_candidates rc
       JOIN problems p ON p.id = rc.problem_id
       JOIN source_documents sd ON sd.id = p.source_document_id
       WHERE rc.user_id = ? AND rc.mode = ? AND p.status = 'reviewed'
       ORDER BY rc.score DESC
       LIMIT ?`,
    )
    .bind(user.id, user.id, mode, limit)
    .all<ProblemRow & { score: number; reasons: string }>();

  const reasonsAreCurrent = rows.results.some((row) => parseJsonArray<string>(row.reasons).includes(modeReason));
  if (rows.results.length === 0 || !reasonsAreCurrent) {
    await buildRecommendations(db, user.id, mode);
    rows = await db
      .prepare(
        `SELECT p.id, p.problem_label, p.statement_text, p.page_start, p.page_end,
                sd.university, sd.graduate_school, sd.department, sd.exam_year, sd.source_url,
                p.subject_raw, p.difficulty, p.estimated_minutes, p.answer_format, p.status,
                p.answer_text, p.explanation_text, rc.score, rc.reasons,
                CASE WHEN EXISTS (
                  SELECT 1 FROM attempts a WHERE a.problem_id = p.id AND a.user_id = ?
                ) THEN 1 ELSE 0 END AS completed
         FROM recommendation_candidates rc
         JOIN problems p ON p.id = rc.problem_id
         JOIN source_documents sd ON sd.id = p.source_document_id
         WHERE rc.user_id = ? AND rc.mode = ? AND p.status = 'reviewed'
         ORDER BY rc.score DESC
         LIMIT ?`,
      )
      .bind(user.id, user.id, mode, limit)
      .all<ProblemRow & { score: number; reasons: string }>();
  }

  const withConcepts = await attachConcepts(db, rows.results, user.id);
  return withConcepts.map((problem, index) => ({
    ...problem,
    score: rows.results[index]?.score ?? 0,
    reasons: parseJsonArray<string>(rows.results[index]?.reasons),
  }));
}
