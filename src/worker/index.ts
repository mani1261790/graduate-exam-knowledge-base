import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { auditLog } from "./audit";
import { authenticateRequest, loginWithPassword, logoutSession, requireRole } from "./auth";
import type { AppUser, AttemptInput, RecommendationMode, RecommendationQueueMessage } from "./domain";
import { ulid } from "./id";
import { fail, jsonOk, readJson } from "./json";
import {
  buildRecommendations,
  getConceptDetail,
  getProblem,
  listConcepts,
  listProblems,
  listRecommendations,
} from "./repository";
import { boundedIntegerParam } from "./query";
import { attemptInputError, effectiveScore, nextMastery, RECOMMENDATION_MODEL_VERSION, relevanceAdjustedEvidence, reviewDueIso } from "./scoring";
import { buildPersonalAnalytics, type AnalyticsAttempt, type AnalyticsConceptState, type AnalyticsMasteryEvidenceRow, type ModelEvaluationRow } from "./analytics";
import {
  buildGoalReadiness,
  GOAL_READINESS_MODEL_VERSION,
  loadGoalReadinessHistory,
  recordGoalReadinessSnapshot,
  type ReadinessConcept,
  type ReadinessPlanItem,
} from "./goal-readiness";
import {
  buildModelHealth,
  type ModelHealthEvaluationRow,
  type ModelHealthOutcomeRow,
  type ModelHealthShadowRow,
  type ModelHealthStrategyRow,
} from "./model-health";
import {
  completeDiagnosticItemExposure,
  DIAGNOSTIC_ITEM_MODEL_VERSION,
  latestDiagnosticItem,
  type DiagnosticItemHealthRow,
} from "./diagnostic-items";
import {
  mergeDiagnosticContentInventory,
  type DiagnosticContentCandidateRow,
  type DiagnosticContentNodeInventoryRow,
  type DiagnosticContentNodeRow,
} from "./diagnostic-content";
import {
  buildDiagnosticRemediationQueue,
  type DiagnosticRemediationCandidateRow,
} from "./diagnostic-remediation";
import {
  buildDiagnosticBlueprintQueue,
  defaultDiagnosticBlueprint,
  diagnosticBlueprintFromRow,
  validateDiagnosticBlueprintInput,
  type DiagnosticBlueprintRow,
} from "./diagnostic-blueprints";
import {
  buildDiagnosticProblemAuthoringQueue,
  defaultDiagnosticProblemContent,
  diagnosticProblemBlueprintContext,
  diagnosticProblemContentFromRow,
  diagnosticProblemVerificationRunFromRow,
  fingerprintDiagnosticProblemContent,
  validateDiagnosticProblemContent,
  validateDiagnosticVerificationResults,
  type DiagnosticProblemBlueprintContext,
  type DiagnosticProblemContentInput,
  type DiagnosticProblemContentRow,
  type DiagnosticProblemVerificationRunRow,
} from "./diagnostic-problem-content";
import {
  buildDiagnosticProblemValidity,
  diagnosticProblemCalibrationInputError,
  DIAGNOSTIC_PROBLEM_VALIDITY_MODEL_VERSION,
  type DiagnosticProblemCalibrationInput,
  type DiagnosticProblemCalibrationRow,
  type DiagnosticProblemValidityAttemptRow,
  type DiagnosticProblemValidityItemRow,
} from "./diagnostic-problem-validity";
import {
  acceptInformationGain,
  buildInformationGainProposal,
  INFORMATION_GAIN_MODEL_VERSION,
  latestInformationGain,
  recordInformationGainExposure,
  type InformationGainHealthRow,
  updateInformationGainOutcome,
} from "./information-gain";
import type { ReadinessHealthRow } from "./readiness-health";
import {
  acceptPlanFocus,
  buildPlanFocusProposal,
  latestPlanFocus,
  pendingPlanFocusOutcome,
  PLAN_FOCUS_MODEL_VERSION,
  recordPlanFocusExposure,
  type PlanFocusHealthRow,
  updatePlanFocusOutcome,
} from "./plan-focus";
import {
  acceptScheduleAdaptation,
  buildScheduleAdaptation,
  latestScheduleAdaptation,
  recordScheduleAdaptationExposure,
  SCHEDULE_ADAPTATION_MODEL_VERSION,
  type ScheduleAdaptationHealthRow,
  updateScheduleAdaptationOutcome,
} from "./schedule-adaptation";
import {
  acceptStrategyExperiment,
  latestStrategyEvaluation,
  recordStrategyExposure,
  updateActiveStrategyOutcome,
} from "./strategy-experiments";
import {
  MASTERY_CURRENT_MODEL_VERSION,
  MASTERY_DIFFICULTY_SHADOW_VERSION,
  masteryShadowPredictions,
  type MasteryShadowEvaluationRow,
} from "./mastery-shadow";
import {
  completeConceptPlanItem,
  generateStudyPlan,
  getActiveStudyGoal,
  getCurrentFocusMastery,
  getCurrentPlanFocusContext,
  getCurrentStudyPlan,
  hasActiveLearningGraph,
  markPlanItemsForAttempt,
  studyPlanProblemMatchesNode,
  upsertStudyGoal,
} from "./study-plan";

type Variables = {
  user: AppUser;
};

type ProblemChatMessage = {
  role: "user" | "assistant";
  content: string;
};

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

app.onError((error, c) => {
  if (error instanceof HTTPException) {
    return c.json({ error: error.message }, error.status);
  }
  console.error(JSON.stringify({ level: "error", message: "Unhandled error", error: String(error) }));
  return c.json({ error: "Internal server error" }, 500);
});

app.use("/api/*", async (c, next) => {
  c.header("Cache-Control", "private, no-store, max-age=0");
  if (c.req.path === "/api/auth/login" || c.req.path === "/api/auth/logout" || c.req.path === "/api/health") {
    await next();
    return;
  }
  const user = await authenticateRequest(c.env.DB, c.req.raw, c.env);
  c.set("user", user);
  await next();
});

app.get("/api/health", (c) =>
  c.json({
    ok: true,
    app: "graduate-exam-knowledge-base",
    env: c.env.APP_ENV,
  }),
);

app.post("/api/auth/login", async (c) => {
  const body = await readJson<{ email?: string; password?: string }>(c.req.raw);
  if (!body.email || !body.password || body.password.length > 256) fail(400, "メールアドレスとパスワードを入力してください。");
  const { user, cookie } = await loginWithPassword(c.env.DB, body.email, body.password, c.req.raw);
  c.header("Set-Cookie", cookie);
  return c.json({ user });
});

app.post("/api/auth/logout", async (c) => {
  c.header("Set-Cookie", await logoutSession(c.env.DB, c.req.raw));
  return c.json({ ok: true });
});

app.get("/preview-login", (c) => {
  const previewEnv = c.env as Env & { PREVIEW_AUTH_TOKEN?: string };
  const token = c.req.query("token");
  if (!previewEnv.PREVIEW_AUTH_TOKEN || token !== previewEnv.PREVIEW_AUTH_TOKEN) fail(403, "Invalid preview token");
  const response = c.redirect("/");
  response.headers.append(
    "Set-Cookie",
    `graduate_preview_token=${encodeURIComponent(token)}; Path=/; Max-Age=604800; HttpOnly; Secure; SameSite=Lax`,
  );
  return response;
});

app.get("/pdf", (c) => {
  const url = new URL(c.req.url);
  url.pathname = "/";
  url.searchParams.set("pdf", "1");
  return c.redirect(url.toString(), 302);
});

app.get("/api/session", (c) => c.json({ user: c.get("user") }));

app.patch("/api/profile", async (c) => {
  const user = c.get("user");
  const body = await readJson<{ department?: unknown }>(c.req.raw);
  if (typeof body.department !== "string") fail(400, "学習分野を入力してください。");
  const department = body.department.trim().replace(/\s+/g, " ");
  if (!department || department.length > 100) fail(400, "学習分野は1〜100文字で入力してください。");
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE users SET department = ? WHERE id = ?").bind(department, user.id),
    c.env.DB.prepare("DELETE FROM recommendation_candidates WHERE user_id = ?").bind(user.id),
  ]);
  const updatedUser = { ...user, department };
  await auditLog(c.env.DB, user, "profile.update", "user", user.id, { department: user.department }, { department });
  return c.json({ user: updatedUser });
});

app.get("/api/concepts", async (c) => {
  const concepts = await listConcepts(c.env.DB, c.req.query("q"));
  return c.json({ concepts });
});

app.get("/api/concepts/:id", async (c) => {
  const concept = await getConceptDetail(c.env.DB, c.req.param("id"), c.get("user").id);
  if (!concept) fail(404, "Concept not found");
  return c.json({ concept });
});

app.post("/api/concepts", async (c) => {
  const user = c.get("user");
  requireRole(user, "editor");
  const body = await readJson<{
    slug: string;
    name_ja: string;
    name_en?: string;
    aliases?: string[];
    concept_type: string;
    description?: string;
  }>(c.req.raw);
  const id = ulid("con");
  await c.env.DB.batch([
    c.env.DB
      .prepare(
        `INSERT INTO concepts (id, slug, name_ja, name_en, aliases, concept_type, description, created_by, reviewed_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        id,
        body.slug,
        body.name_ja,
        body.name_en ?? null,
        JSON.stringify(body.aliases ?? []),
        body.concept_type,
        body.description ?? null,
        user.id,
        user.role === "reviewer" || user.role === "admin" ? user.id : null,
      ),
    c.env.DB
      .prepare("INSERT INTO node_registry (node_id, entity_type, entity_id, display_name) VALUES (?, 'concept', ?, ?)")
      .bind(ulid("node"), id, body.name_ja),
  ]);
  await auditLog(c.env.DB, user, "concept.create", "concept", id, undefined, body);
  return c.json({ id }, 201);
});

app.get("/api/problems", async (c) => {
  const problems = await listProblems(c.env.DB, c.get("user"), {
    q: c.req.query("q"),
    concept: c.req.query("concept"),
    university: c.req.query("university"),
    year: c.req.query("year") ? Number(c.req.query("year")) : undefined,
    difficulty: c.req.query("difficulty") ? Number(c.req.query("difficulty")) : undefined,
    status: c.req.query("status"),
    limit: boundedIntegerParam(c.req.query("limit"), { defaultValue: 80, min: 1, max: 200 }),
    offset: boundedIntegerParam(c.req.query("offset"), { defaultValue: 0, min: 0, max: 10_000 }),
  });
  return c.json({ problems });
});

app.get("/api/problems/:id", async (c) => {
  const problem = await getProblem(c.env.DB, c.get("user"), c.req.param("id"));
  if (!problem) fail(404, "Problem not found");
  return c.json({ problem });
});

app.post("/api/problems/:id/chat", async (c) => {
  const user = c.get("user");
  const problemId = c.req.param("id");
  const body = await readJson<{ messages?: unknown }>(c.req.raw);
  const messages = normalizeProblemChatMessages(body.messages);
  if (messages.length === 0 || messages.at(-1)?.role !== "user") {
    fail(400, "A user message is required");
  }

  const problem = await getProblem(c.env.DB, user, problemId);
  if (!problem) fail(404, "Problem not found");

  const context = buildProblemChatContext(problem);
  const response = await c.env.AI.run("@cf/meta/llama-3.3-70b-instruct-fp8-fast", {
    messages: [
      {
        role: "system",
        content: [
          "あなたは大学院入試の問題演習を支援する日本語チューターです。",
          "以下の問題コンテキストを優先して、解法の方針、必要な定義・公式、途中式、検算の観点を簡潔に説明してください。",
          "PDF本文が不足している場合は、分かる範囲を明示し、ユーザーに見えている問題文の該当箇所を短く共有してもらってください。",
          "答えだけを断定せず、受験勉強に使える形で段階的に説明してください。",
          "",
          "問題コンテキスト:",
          context,
        ].join("\n"),
      },
      ...messages.slice(-10),
    ],
    max_tokens: 900,
    temperature: 0.2,
  });

  return c.json({ answer: extractAiText(response) });
});

app.post("/api/problems", async (c) => {
  const user = c.get("user");
  requireRole(user, "editor");
  const body = await readJson<{
    source_document_id: string;
    problem_label: string;
    statement_text?: string;
    answer_text?: string;
    explanation_text?: string;
    subject_raw?: string;
    difficulty: number;
    estimated_minutes: number;
    answer_format: string;
    status?: string;
  }>(c.req.raw);
  if (body.status === "reviewed" && user.role !== "reviewer" && user.role !== "admin") {
    fail(403, "reviewer role is required to create reviewed problems");
  }
  const id = ulid("prob");
  await c.env.DB.batch([
    c.env.DB
      .prepare(
        `INSERT INTO problems (
          id, source_document_id, problem_label, statement_text, answer_text, explanation_text,
          subject_raw, difficulty, estimated_minutes, answer_format, status, created_by, reviewed_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        id,
        body.source_document_id,
        body.problem_label,
        body.statement_text ?? null,
        body.answer_text ?? null,
        body.explanation_text ?? null,
        body.subject_raw ?? null,
        body.difficulty,
        body.estimated_minutes,
        body.answer_format,
        body.status ?? "draft",
        user.id,
        body.status === "reviewed" ? user.id : null,
      ),
    c.env.DB
      .prepare("INSERT INTO node_registry (node_id, entity_type, entity_id, display_name) VALUES (?, 'problem', ?, ?)")
      .bind(ulid("node"), id, body.problem_label),
  ]);
  await auditLog(c.env.DB, user, "problem.create", "problem", id, undefined, body);
  return c.json({ id }, 201);
});

app.patch("/api/problems/:id", async (c) => {
  const user = c.get("user");
  requireRole(user, "editor");
  const problemId = c.req.param("id");
  const before = await c.env.DB.prepare("SELECT * FROM problems WHERE id = ?").bind(problemId).first<Record<string, unknown>>();
  if (!before) fail(404, "Problem not found");
  const governedOriginal = await c.env.DB.prepare(
    "SELECT id FROM diagnostic_problem_contents WHERE problem_id = ? AND status IN ('candidate', 'approved') LIMIT 1",
  ).bind(problemId).first<{ id: string }>();
  if (governedOriginal) fail(409, "Governed original diagnostic problems must be changed through their content review workflow");
  const body = await readJson<Record<string, unknown>>(c.req.raw);
  if (body.status === "reviewed") {
    requireRole(user, "reviewer");
    await assertReviewable(c.env.DB, problemId);
  }
  const allowed = ["statement_text", "answer_text", "explanation_text", "difficulty", "estimated_minutes", "answer_format", "status", "duplicate_of"];
  const updates = Object.entries(body).filter(([key]) => allowed.includes(key));
  if (updates.length === 0) return c.json({ id: problemId, changed: false });
  const assignments = updates.map(([key]) => `${key} = ?`).join(", ");
  const values = updates.map(([, value]) => value);
  await c.env.DB
    .prepare(`UPDATE problems SET ${assignments}, reviewed_by = CASE WHEN status = 'reviewed' THEN ? ELSE reviewed_by END, updated_at = datetime('now') WHERE id = ?`)
    .bind(...values, user.id, problemId)
    .run();
  await auditLog(c.env.DB, user, "problem.update", "problem", problemId, before, body);
  return c.json({ id: problemId, changed: true });
});

app.get("/api/sources", async (c) => {
  requireRole(c.get("user"), "editor");
  const limit = boundedIntegerParam(c.req.query("limit"), { defaultValue: 50, min: 1, max: 100 });
  const offset = boundedIntegerParam(c.req.query("offset"), { defaultValue: 0, min: 0, max: 100_000 });
  const q = c.req.query("q")?.trim().slice(0, 200);
  const university = c.req.query("university")?.trim();
  const sourceStatus = c.req.query("status");
  const displayMode = c.req.query("display");
  if (sourceStatus && !["active", "unavailable", "needs_review"].includes(sourceStatus)) fail(400, "Unknown source status");
  if (displayMode && !["embed", "external_only"].includes(displayMode)) fail(400, "Unknown PDF display mode");
  const where: string[] = [];
  const bind: unknown[] = [];
  if (q) {
    where.push("(sd.title LIKE ? OR sd.university LIKE ? OR COALESCE(sd.graduate_school, '') LIKE ? OR COALESCE(sd.department, '') LIKE ?)");
    const like = `%${q}%`;
    bind.push(like, like, like, like);
  }
  if (university) {
    where.push("sd.university = ?");
    bind.push(university);
  }
  if (sourceStatus) {
    where.push("sd.source_status = ?");
    bind.push(sourceStatus);
  }
  if (displayMode) {
    where.push("sd.pdf_display_mode = ?");
    bind.push(displayMode);
  }
  const whereSql = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
  const [sourceResult, total] = await Promise.all([
    c.env.DB.prepare(
      `SELECT sd.id, sd.source_type, sd.title, sd.university, sd.graduate_school, sd.department,
              sd.exam_year, sd.exam_category, sd.source_url, sd.publisher_page_url, sd.file_hash,
              sd.storage_path, sd.access_scope, sd.pdf_display_mode, sd.source_status,
              sd.source_checked_at, sd.extraction_status, sd.created_at,
              (SELECT COUNT(*) FROM problems p WHERE p.source_document_id = sd.id) AS problem_count
       FROM source_documents sd
       ${whereSql}
       ORDER BY CASE sd.source_status WHEN 'needs_review' THEN 0 WHEN 'unavailable' THEN 1 ELSE 2 END,
                sd.exam_year DESC, sd.university ASC, sd.title ASC
       LIMIT ? OFFSET ?`,
    ).bind(...bind, limit, offset).all(),
    c.env.DB.prepare(`SELECT COUNT(*) AS count FROM source_documents sd ${whereSql}`).bind(...bind).first<{ count: number }>(),
  ]);
  return c.json({ sources: sourceResult.results, total: total?.count ?? 0, limit, offset });
});

app.get("/api/source-stats", async (c) => {
  requireRole(c.get("user"), "editor");
  const [total, byUniversity, byScope, byStatus, byDisplay] = await Promise.all([
    c.env.DB.prepare("SELECT COUNT(*) AS count FROM source_documents").first<{ count: number }>(),
    c.env.DB
      .prepare("SELECT university, COUNT(*) AS count FROM source_documents GROUP BY university ORDER BY count DESC, university ASC")
      .all(),
    c.env.DB.prepare("SELECT access_scope, COUNT(*) AS count FROM source_documents GROUP BY access_scope ORDER BY count DESC").all(),
    c.env.DB.prepare("SELECT source_status, COUNT(*) AS count FROM source_documents GROUP BY source_status ORDER BY count DESC").all(),
    c.env.DB.prepare("SELECT pdf_display_mode, COUNT(*) AS count FROM source_documents GROUP BY pdf_display_mode ORDER BY count DESC").all(),
  ]);
  return c.json({
    total: total?.count ?? 0,
    byUniversity: byUniversity.results,
    byScope: byScope.results,
    byStatus: byStatus.results,
    byDisplay: byDisplay.results,
  });
});

app.post("/api/sources", async (c) => {
  const user = c.get("user");
  requireRole(user, "editor");
  const id = ulid("src");
  const source = await readJson<{
    source_type: string;
    title: string;
    university: string;
    graduate_school?: string;
    department?: string;
    exam_year: number;
    exam_category?: string;
    source_url: string;
    publisher_page_url?: string;
    access_scope: string;
    pdf_display_mode?: "embed" | "external_only";
    source_status?: "active" | "unavailable" | "needs_review";
  }>(c.req.raw);
  if (!source.title?.trim() || !source.university?.trim() || !Number.isInteger(source.exam_year)) {
    fail(400, "title, university and exam_year are required");
  }
  if (!['official_pdf', 'unofficial_pdf', 'scan', 'web_page', 'manual_input', 'book', 'other'].includes(source.source_type)) {
    fail(400, "source_type is invalid");
  }
  if (source.pdf_display_mode !== undefined && !["embed", "external_only"].includes(source.pdf_display_mode)) {
    fail(400, "pdf_display_mode must be embed or external_only");
  }
  if (source.source_status !== undefined && !["active", "unavailable", "needs_review"].includes(source.source_status)) {
    fail(400, "source_status is invalid");
  }
  const sourceUrl = externalHttpsUrl(source.source_url, "source_url");
  const publisherPageUrl = source.publisher_page_url ? externalHttpsUrl(source.publisher_page_url, "publisher_page_url") : null;
  if (!['source_link_only', 'public_ready'].includes(source.access_scope)) fail(400, "only public link sources can be registered");
  if (source.source_status === "active") {
    requireRole(user, "reviewer");
    assertPublishableSource(sourceUrl, source.access_scope);
  }
  const fileHash = await sha256Hex(new TextEncoder().encode(sourceUrl).buffer as ArrayBuffer);
  const existing = await c.env.DB.prepare("SELECT id FROM source_documents WHERE file_hash = ? OR source_url = ?").bind(fileHash, sourceUrl).first();
  if (existing) fail(409, "SourceDocument with the same public URL already exists");
  await c.env.DB
    .prepare(
      `INSERT INTO source_documents (
        id, source_type, title, university, graduate_school, department, exam_year, exam_category,
        source_url, publisher_page_url, file_hash, storage_path, access_scope, pdf_display_mode,
        source_status, source_checked_at, extraction_status, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', ?, ?, ?, datetime('now'), 'uploaded', ?)`,
    )
    .bind(
      id,
      source.source_type,
      source.title,
      source.university,
      source.graduate_school ?? null,
      source.department ?? null,
      source.exam_year,
      source.exam_category ?? null,
      sourceUrl,
      publisherPageUrl,
      fileHash,
      source.access_scope,
      source.pdf_display_mode ?? "external_only",
      source.source_status ?? "needs_review",
      user.id,
    )
    .run();
  await auditLog(c.env.DB, user, "source.create", "source_document", id, undefined, source);
  return c.json({ id, file_hash: fileHash }, 201);
});

app.patch("/api/sources/:id", async (c) => {
  const user = c.get("user");
  requireRole(user, "reviewer");
  const body = await readJson<{
    source_url?: string;
    publisher_page_url?: string | null;
    pdf_display_mode?: "embed" | "external_only";
    source_status?: "active" | "unavailable" | "needs_review";
    access_scope?: "source_link_only" | "public_ready";
  }>(c.req.raw);
  const before = await c.env.DB.prepare("SELECT * FROM source_documents WHERE id = ?").bind(c.req.param("id")).first();
  if (!before) fail(404, "SourceDocument not found");
  if (body.access_scope !== undefined && !["source_link_only", "public_ready"].includes(body.access_scope)) {
    fail(400, "access_scope must be source_link_only or public_ready");
  }
  if (body.pdf_display_mode !== undefined && !["embed", "external_only"].includes(body.pdf_display_mode)) {
    fail(400, "pdf_display_mode must be embed or external_only");
  }
  if (body.source_status !== undefined && !["active", "unavailable", "needs_review"].includes(body.source_status)) {
    fail(400, "source_status is invalid");
  }
  const sourceUrl = body.source_url ? externalHttpsUrl(body.source_url, "source_url") : String(before.source_url ?? "");
  const publisherPageUrl = body.publisher_page_url === undefined
    ? before.publisher_page_url
    : body.publisher_page_url ? externalHttpsUrl(body.publisher_page_url, "publisher_page_url") : null;
  const nextAccessScope = body.access_scope ?? String(before.access_scope);
  const nextSourceStatus = body.source_status ?? String(before.source_status);
  if (nextSourceStatus === "active") assertPublishableSource(sourceUrl, nextAccessScope);
  await c.env.DB.prepare(
    `UPDATE source_documents SET source_url = ?, publisher_page_url = ?, access_scope = ?, pdf_display_mode = ?, source_status = ?,
       source_checked_at = datetime('now') WHERE id = ?`,
  ).bind(
    sourceUrl,
    publisherPageUrl,
    nextAccessScope,
    body.pdf_display_mode ?? before.pdf_display_mode,
    nextSourceStatus,
    c.req.param("id"),
  ).run();
  await auditLog(c.env.DB, user, "source.review", "source_document", c.req.param("id"), before, body);
  return c.json({ id: c.req.param("id") });
});

app.post("/api/edges", async (c) => {
  const user = c.get("user");
  requireRole(user, "editor");
  const body = await readJson<{
    from_entity_type: string;
    from_entity_id: string;
    edge_type: string;
    to_entity_type: string;
    to_entity_id: string;
    weight?: number;
    confidence?: number;
    evidence_type?: string;
    status?: string;
  }>(c.req.raw);
  const fromNode = await ensureNode(c.env.DB, body.from_entity_type, body.from_entity_id);
  const toNode = await ensureNode(c.env.DB, body.to_entity_type, body.to_entity_id);
  validateEdgeShape(body.from_entity_type, body.edge_type, body.to_entity_type);
  if (body.status === "approved") requireRole(user, "reviewer");
  const id = ulid("edge");
  await c.env.DB
    .prepare(
      `INSERT INTO knowledge_edges (id, from_node_id, edge_type, to_node_id, weight, confidence, evidence_type, status, created_by, reviewed_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      fromNode,
      body.edge_type,
      toNode,
      body.weight ?? 0.6,
      body.confidence ?? 0.6,
      body.evidence_type ?? "manual",
      body.status ?? "candidate",
      user.id,
      body.status === "approved" ? user.id : null,
    )
    .run();
  await auditLog(c.env.DB, user, "edge.create", "knowledge_edge", id, undefined, body);
  return c.json({ id }, 201);
});

app.patch("/api/edges/:id/review", async (c) => {
  const user = c.get("user");
  requireRole(user, "reviewer");
  const id = c.req.param("id");
  const body = await readJson<{ status: "approved" | "rejected" }>(c.req.raw);
  if (!["approved", "rejected"].includes(body.status)) fail(400, "status must be approved or rejected");
  const before = await c.env.DB.prepare("SELECT * FROM knowledge_edges WHERE id = ?").bind(id).first();
  if (!before) fail(404, "Edge not found");
  await c.env.DB.prepare("UPDATE knowledge_edges SET status = ?, reviewed_by = ? WHERE id = ?").bind(body.status, user.id, id).run();
  await auditLog(c.env.DB, user, "edge.review", "knowledge_edge", id, before, body);
  return c.json({ id, status: body.status });
});

app.post("/api/attempts", async (c) => {
  const user = c.get("user");
  const rawBody = await readJson<unknown>(c.req.raw);
  const inputError = attemptInputError(rawBody);
  if (inputError) fail(400, inputError);
  const body = rawBody as AttemptInput;
  const problem = await c.env.DB
    .prepare(
      `SELECT p.id, p.estimated_minutes, p.difficulty,
              EXISTS(
                SELECT 1 FROM diagnostic_problem_contents dpc
                WHERE dpc.problem_id = p.id AND dpc.status = 'approved' AND dpc.materialized_at IS NOT NULL
              ) AS governed_original,
              EXISTS(
                SELECT 1
                FROM diagnostic_problem_contents dpc
                JOIN diagnostic_problem_calibration_decisions dcal
                  ON dcal.content_id = dpc.id
                 AND dcal.content_revision = dpc.revision
                 AND dcal.status = 'approved'
                 AND dcal.decision = 'mastery_enabled'
                 AND dcal.valid_until > datetime('now')
                WHERE dpc.problem_id = p.id AND dpc.status = 'approved' AND dpc.materialized_at IS NOT NULL
              ) AS mastery_eligible
       FROM problems p WHERE p.id = ? AND p.status = 'reviewed'`,
    )
    .bind(body.problem_id)
    .first<{ id: string; estimated_minutes: number; difficulty: number; governed_original: number; mastery_eligible: number }>();
  if (!problem) fail(404, "Reviewed problem not found");

  const id = ulid("att");
  const submittedAt = new Date().toISOString();
  const startedAt = body.started_at && Number.isFinite(Date.parse(body.started_at))
    ? new Date(body.started_at).toISOString()
    : submittedAt;
  const conceptRows = await c.env.DB
    .prepare(
      `SELECT c.id,
              MAX(CASE WHEN ke.edge_type = 'tests' THEN 1 ELSE 0 END) AS directly_tested,
              MAX(ke.weight * ke.confidence) AS edge_strength
       FROM knowledge_edges ke
       JOIN node_registry nr_problem ON nr_problem.node_id = ke.from_node_id
       JOIN node_registry nr_concept ON nr_concept.node_id = ke.to_node_id
       JOIN concepts c ON c.id = nr_concept.entity_id
       WHERE nr_problem.entity_type = 'problem'
         AND nr_concept.entity_type = 'concept'
         AND nr_problem.entity_id = ?
         AND ke.edge_type IN ('tests', 'requires')
         AND ke.status = 'approved'
       GROUP BY c.id`,
    )
    .bind(problem.id)
    .all<{ id: string; directly_tested: number; edge_strength: number }>();

  const mistakeCounts = new Map<string, number>();
  const allowedConceptIds = new Set(conceptRows.results.map((row) => row.id));
  for (const mistake of body.mistakes ?? []) {
    if (mistake.concept_id && !allowedConceptIds.has(mistake.concept_id)) fail(400, "この問題に関連しない分野は記録できません。");
    if (mistake.concept_id) mistakeCounts.set(mistake.concept_id, (mistakeCounts.get(mistake.concept_id) ?? 0) + 1);
  }

  const score = effectiveScore({
    result: body.result,
    scoreRate: body.score_rate,
    usedHint: Boolean(body.used_hint),
    lookedSolution: Boolean(body.looked_solution),
    timeSpentMinutes: body.time_spent_minutes,
    estimatedMinutes: problem.estimated_minutes,
    mistakePenaltyCount: 0,
  });

  const statements: D1PreparedStatement[] = [
    c.env.DB
      .prepare(
        `INSERT INTO attempts (
          id, user_id, problem_id, started_at, submitted_at, time_spent_minutes, score_rate, result,
          used_hint, looked_solution, self_confidence, note
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        id,
        user.id,
        problem.id,
        startedAt,
        submittedAt,
        body.time_spent_minutes ?? null,
        score,
        body.result,
        body.used_hint ? 1 : 0,
        body.looked_solution ? 1 : 0,
        body.self_confidence ?? null,
        body.note ?? null,
      ),
  ];

  for (const mistake of body.mistakes ?? []) {
    statements.push(
      c.env.DB
        .prepare("INSERT INTO mistakes (id, attempt_id, concept_id, mistake_type, note) VALUES (?, ?, ?, ?, ?)")
        .bind(ulid("mis"), id, mistake.concept_id ?? null, mistake.mistake_type, mistake.note ?? null),
    );
  }

  const predictionWindowStart = new Date(new Date(submittedAt).getTime() - 30 * 86_400_000).toISOString();
  statements.push(
    c.env.DB
      .prepare(
        `UPDATE learning_model_predictions
         SET observed_attempt_id = ?, observed_score = ?, observed_at = ?
         WHERE id = (
           SELECT id FROM learning_model_predictions
           WHERE user_id = ? AND problem_id = ? AND observed_attempt_id IS NULL
             AND exposed_at >= ? AND exposed_at <= ?
           ORDER BY exposed_at DESC
           LIMIT 1
         )`,
      )
      .bind(id, score, submittedAt, user.id, problem.id, predictionWindowStart, submittedAt),
  );

  await c.env.DB.batch(statements);

  const masteryEvidenceApplied = !Boolean(problem.governed_original) || Boolean(problem.mastery_eligible);
  for (const row of masteryEvidenceApplied ? conceptRows.results : []) {
    const previous = await c.env.DB
      .prepare("SELECT mastery_score, evidence_count FROM user_concept_states WHERE user_id = ? AND concept_id = ?")
      .bind(user.id, row.id)
      .first<{ mastery_score: number; evidence_count: number }>();
    const rawEvidence = effectiveScore({
      result: body.result,
      scoreRate: body.score_rate,
      usedHint: Boolean(body.used_hint),
      lookedSolution: Boolean(body.looked_solution),
      timeSpentMinutes: body.time_spent_minutes,
      estimatedMinutes: problem.estimated_minutes,
      previousMastery: previous?.mastery_score,
      mistakePenaltyCount: mistakeCounts.get(row.id) ?? 0,
    });
    const relevanceWeight = row.edge_strength * (row.directly_tested ? 1 : 0.55);
    const evidence = relevanceAdjustedEvidence(rawEvidence, previous?.mastery_score, relevanceWeight);
    const mastery = nextMastery(previous?.mastery_score, evidence, previous?.evidence_count ?? 0);
    const shadow = masteryShadowPredictions({
      previousMastery: previous?.mastery_score,
      evidenceCount: previous?.evidence_count ?? 0,
      rawEvidence,
      relevanceWeight,
      difficulty: Number(problem.difficulty),
    });
    await c.env.DB.prepare(
      `UPDATE learning_mastery_shadow_evidence
       SET observed_attempt_id = ?, observed_score = ?, observed_at = ?
       WHERE id = (
         SELECT id FROM learning_mastery_shadow_evidence
         WHERE user_id = ? AND concept_id = ? AND problem_id <> ?
           AND observed_attempt_id IS NULL
           AND julianday(created_at) <= julianday(?, '-1 day')
           AND julianday(created_at) >= julianday(?, '-30 days')
         ORDER BY created_at DESC, id DESC LIMIT 1
       )`,
    ).bind(id, rawEvidence, submittedAt, user.id, row.id, problem.id, submittedAt, submittedAt).run();
    await c.env.DB
      .prepare(
        `INSERT INTO user_concept_states (
          user_id, concept_id, mastery_score, evidence_count, last_attempted_at, last_failed_at, review_due_at, updated_at
        ) VALUES (?, ?, ?, 1, ?, ?, ?, ?)
        ON CONFLICT(user_id, concept_id) DO UPDATE SET
          mastery_score = excluded.mastery_score,
          evidence_count = user_concept_states.evidence_count + 1,
          last_attempted_at = excluded.last_attempted_at,
          last_failed_at = excluded.last_failed_at,
          review_due_at = excluded.review_due_at,
          updated_at = excluded.updated_at`,
      )
      .bind(user.id, row.id, mastery, submittedAt, evidence < 0.5 ? submittedAt : null, reviewDueIso(evidence), submittedAt)
      .run();
    await c.env.DB.prepare(
      `INSERT INTO learning_mastery_shadow_evidence (
         id, attempt_id, user_id, concept_id, problem_id, difficulty, target_score,
         raw_evidence, relevance_weight, previous_mastery, evidence_count_before,
         current_prediction, candidate_prediction, current_model_version,
         candidate_model_version, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      ulid("mse"), id, user.id, row.id, problem.id, Number(problem.difficulty), shadow.targetScore,
      rawEvidence, relevanceWeight, previous?.mastery_score ?? null, previous?.evidence_count ?? 0,
      mastery, shadow.candidate, MASTERY_CURRENT_MODEL_VERSION, MASTERY_DIFFICULTY_SHADOW_VERSION, submittedAt,
    ).run();
  }

  await completeDiagnosticItemExposure(c.env.DB, {
    userId: user.id,
    problemId: problem.id,
    attemptId: id,
    result: body.result,
    timeSpentMinutes: body.time_spent_minutes ?? null,
  }, new Date(submittedAt));

  await markPlanItemsForAttempt(c.env.DB, user.id, problem.id);
  await updateActiveStrategyOutcome(c.env.DB, user.id, new Date(submittedAt));

  await auditLog(c.env.DB, user, "attempt.create", "attempt", id, undefined, body);
  c.executionCtx.waitUntil(
    Promise.allSettled([
      buildRecommendations(c.env.DB, user.id, "normal"),
      c.env.RECOMMENDATION_QUEUE.send({ userId: user.id, reason: "attempt_saved" }),
    ]).then((results) => {
      for (const result of results) {
        if (result.status === "rejected") {
          console.error(JSON.stringify({ level: "error", message: "Post-attempt recommendation update failed", error: String(result.reason) }));
        }
      }
    }),
  );
  return c.json({ id, score_rate: score, mastery_evidence_applied: masteryEvidenceApplied }, 201);
});

app.get("/api/recommendations", async (c) => {
  const mode = (c.req.query("mode") ?? "normal") as RecommendationMode;
  if (!["normal", "review", "foundation", "challenge"].includes(mode)) fail(400, "Unknown recommendation mode");
  const limit = boundedIntegerParam(c.req.query("limit"), { defaultValue: 20, min: 1, max: 100 });
  const recommendations = await listRecommendations(c.env.DB, c.get("user"), mode, limit);
  return c.json({ recommendations });
});

app.get("/api/study-goal", async (c) => {
  return c.json({ goal: await getActiveStudyGoal(c.env.DB, c.get("user").id) });
});

app.get("/api/learning-graphs/subjects", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT subject_key, topic, source_repository, source_commit, activated_at
     FROM learning_graphs WHERE status = 'active'
     ORDER BY subject_key, activated_at DESC`,
  ).all();
  return c.json({ subjects: results });
});

app.put("/api/study-goal", async (c) => {
  const user = c.get("user");
  const body = await readJson<Parameters<typeof upsertStudyGoal>[2]>(c.req.raw);
  try {
    const goal = await upsertStudyGoal(c.env.DB, user.id, body);
    c.executionCtx.waitUntil(c.env.RECOMMENDATION_QUEUE.send({ userId: user.id, reason: "goal_changed" }));
    return c.json({ goal });
  } catch (error) {
    fail(400, error instanceof Error ? error.message : "学習目標を保存できませんでした。");
  }
});

app.get("/api/study-plans/current", async (c) => {
  return c.json({ study_plan: await getCurrentStudyPlan(c.env.DB, c.get("user")) });
});

app.post("/api/study-plans", async (c) => {
  try {
    return c.json({ study_plan: await generateStudyPlan(c.env.DB, c.get("user")) }, 201);
  } catch (error) {
    fail(409, error instanceof Error ? error.message : "学習計画を生成できませんでした。");
  }
});

app.patch("/api/study-plan-items/:id", async (c) => {
  const body = await readJson<{ status?: "completed" | "skipped" }>(c.req.raw);
  if (body.status !== "completed" && body.status !== "skipped") fail(400, "status must be completed or skipped");
  const changed = await completeConceptPlanItem(c.env.DB, c.get("user").id, c.req.param("id"), body.status);
  if (!changed) fail(404, "Study plan item not found");
  return c.json({ id: c.req.param("id"), status: body.status });
});

app.get("/api/progress", async (c) => {
  const { results } = await c.env.DB
    .prepare(
      `SELECT c.id, c.slug, c.name_ja, c.concept_type, ucs.mastery_score, ucs.evidence_count, ucs.last_attempted_at, ucs.review_due_at
       FROM user_concept_states ucs
       JOIN concepts c ON c.id = ucs.concept_id
       WHERE ucs.user_id = ?
       ORDER BY ucs.mastery_score ASC, ucs.review_due_at ASC`,
    )
    .bind(c.get("user").id)
    .all();
  return c.json({ progress: results });
});

app.get("/api/analytics/personal", async (c) => {
  const userId = c.get("user").id;
  const [attempts, conceptStates, attemptCount, predictionEvaluations, masteryEvidenceRows] = await Promise.all([
    c.env.DB
      .prepare(
        `SELECT a.id, a.problem_id, a.score_rate, a.result, a.time_spent_minutes, p.estimated_minutes,
                a.self_confidence, a.used_hint, a.looked_solution, a.created_at
         FROM attempts a
         JOIN problems p ON p.id = a.problem_id
         WHERE a.user_id = ? AND a.created_at >= datetime('now', '-365 days')
         ORDER BY a.created_at DESC
         LIMIT 5000`,
      )
      .bind(userId)
      .all<AnalyticsAttempt>(),
    c.env.DB
      .prepare(
        `SELECT c.id, c.name_ja, ucs.mastery_score, ucs.evidence_count,
                ucs.last_attempted_at, ucs.review_due_at
         FROM user_concept_states ucs
         JOIN concepts c ON c.id = ucs.concept_id
         WHERE ucs.user_id = ? AND c.status = 'active'
         ORDER BY ucs.mastery_score ASC
         LIMIT 500`,
      )
      .bind(userId)
      .all<AnalyticsConceptState>(),
    c.env.DB
      .prepare("SELECT COUNT(*) AS count FROM attempts WHERE user_id = ? AND created_at >= datetime('now', '-365 days')")
      .bind(userId)
      .first<{ count: number }>(),
    c.env.DB
      .prepare(
        `SELECT model_version, personalized_prediction, baseline_prediction,
                prediction_confidence, observed_score, exposed_at, observed_at
         FROM learning_model_predictions
         WHERE user_id = ? AND model_version = ? AND observed_score IS NOT NULL
           AND observed_at >= datetime('now', '-365 days')
         ORDER BY observed_at DESC
         LIMIT 5000`,
      )
      .bind(userId, RECOMMENDATION_MODEL_VERSION)
      .all<ModelEvaluationRow>(),
    c.env.DB
      .prepare(
        `SELECT mse.id, mse.concept_id, c.name_ja AS concept_name,
                mse.problem_id, p.problem_label, mse.difficulty, mse.raw_evidence,
                mse.previous_mastery, mse.current_prediction, mse.created_at
         FROM learning_mastery_shadow_evidence mse
         JOIN concepts c ON c.id = mse.concept_id
         JOIN problems p ON p.id = mse.problem_id
         WHERE mse.user_id = ? AND mse.created_at >= datetime('now', '-365 days')
         ORDER BY mse.created_at DESC, mse.id DESC
         LIMIT 500`,
      )
      .bind(userId)
      .all<AnalyticsMasteryEvidenceRow>(),
  ]);
  const now = new Date();
  const analytics = buildPersonalAnalytics(
    [...attempts.results].reverse(),
    conceptStates.results,
    now,
    {
      windowDays: 365,
      availableAttempts: Number(attemptCount?.count ?? attempts.results.length),
      predictionEvaluations: predictionEvaluations.results,
      masteryEvidenceRows: masteryEvidenceRows.results.map((row) => ({
        ...row,
        difficulty: Number(row.difficulty),
        raw_evidence: Number(row.raw_evidence),
        previous_mastery: row.previous_mastery === null ? null : Number(row.previous_mastery),
        current_prediction: Number(row.current_prediction),
      })),
    },
  );
  const recentScores = attempts.results
    .map((attempt) => attempt.score_rate)
    .filter((score): score is number => Number.isFinite(score))
    .slice(0, 3);
  const baselineScore = recentScores.length < 3
    ? null
    : recentScores.reduce((sum, score) => sum + score, 0) / recentScores.length;
  analytics.strategy.experiment_id = await recordStrategyExposure(c.env.DB, userId, analytics, baselineScore, now);
  analytics.strategy_evaluation = await latestStrategyEvaluation(c.env.DB, userId);
  const goal = await getActiveStudyGoal(c.env.DB, userId);
  const [readinessConcepts, readinessPlanItems] = goal
    ? await Promise.all([
        c.env.DB.prepare(
          `WITH active_graph AS (
             SELECT id FROM learning_graphs
             WHERE subject_key = ? AND status = 'active'
             ORDER BY activated_at DESC, created_at DESC LIMIT 1
           )
           SELECT c.id, c.name_ja, ucs.mastery_score, COALESCE(ucs.evidence_count, 0) AS evidence_count,
                  ucs.last_attempted_at, MAX(l.confidence) AS weight
           FROM active_graph g
           JOIN learning_graph_nodes n ON n.graph_id = g.id
           JOIN learning_graph_concept_links l ON l.graph_node_id = n.id AND l.status = 'approved'
           JOIN concepts c ON c.id = l.concept_id AND c.status = 'active'
           LEFT JOIN user_concept_states ucs ON ucs.concept_id = c.id AND ucs.user_id = ?
           GROUP BY c.id, c.name_ja, ucs.mastery_score, ucs.evidence_count, ucs.last_attempted_at
           ORDER BY c.name_ja`,
        ).bind(goal.subject_key, userId).all<ReadinessConcept>(),
        c.env.DB.prepare(
          `SELECT spi.scheduled_date, spi.status, spi.superseded_at
           FROM study_plan_items spi
           JOIN study_plans sp ON sp.id = spi.plan_id
           WHERE sp.user_id = ? AND sp.status = 'active'
             AND spi.scheduled_date >= date('now', '-28 days')
           ORDER BY spi.scheduled_date, spi.sequence`,
        ).bind(userId).all<ReadinessPlanItem>(),
      ])
    : [{ results: [] as ReadinessConcept[] }, { results: [] as ReadinessPlanItem[] }];
  analytics.goal_readiness = buildGoalReadiness({
    goal,
    concepts: readinessConcepts.results,
    planItems: readinessPlanItems.results,
    attempts: attempts.results,
    now,
  });
  await recordGoalReadinessSnapshot(c.env.DB, userId, analytics.goal_readiness, now);
  if (analytics.goal_readiness.goal_id) {
    analytics.goal_readiness.history = await loadGoalReadinessHistory(c.env.DB, userId, analytics.goal_readiness.goal_id);
  }
  await updateScheduleAdaptationOutcome(c.env.DB, userId, now);
  analytics.schedule_adaptation = await latestScheduleAdaptation(c.env.DB, userId, now);
  if (!analytics.schedule_adaptation && goal && analytics.goal_readiness.plan_adherence !== null) {
    const proposal = buildScheduleAdaptation({
      sessionsPerWeek: goal.sessions_per_week,
      minutesPerSession: goal.minutes_per_session,
      planAdherence: analytics.goal_readiness.plan_adherence,
      currentWeeklyPace: analytics.goal_readiness.current_weekly_pace,
      dueSessions: analytics.goal_readiness.due_plan_sessions,
      daysRemaining: analytics.goal_readiness.days_remaining,
    });
    if (proposal) {
      analytics.schedule_adaptation = await recordScheduleAdaptationExposure(
        c.env.DB,
        userId,
        goal.id,
        proposal,
        {
          planAdherence: analytics.goal_readiness.plan_adherence,
          weeklyPace: analytics.goal_readiness.current_weekly_pace,
          dueSessions: analytics.goal_readiness.due_plan_sessions,
        },
        now,
      );
    }
  }
  const pendingFocus = await pendingPlanFocusOutcome(c.env.DB, userId, now);
  if (pendingFocus) {
    const currentMastery = await getCurrentFocusMastery(
      c.env.DB,
      userId,
      pendingFocus.goalId,
      pendingFocus.focusNodeIds,
    );
    if (currentMastery !== null) {
      const completed = await updatePlanFocusOutcome(c.env.DB, userId, pendingFocus.id, currentMastery, now);
      if (completed) await generateStudyPlan(c.env.DB, c.get("user"));
    }
  }
  const informationGainUpdate = await updateInformationGainOutcome(c.env.DB, userId, now);
  if (informationGainUpdate.evidenceAcquired || informationGainUpdate.completed) {
    await generateStudyPlan(c.env.DB, c.get("user"));
  }
  analytics.plan_focus = await latestPlanFocus(c.env.DB, userId, now);
  analytics.information_gain = await latestInformationGain(c.env.DB, userId, now);
  analytics.diagnostic_item = await latestDiagnosticItem(c.env.DB, userId);
  if (!analytics.plan_focus && !analytics.information_gain && goal && analytics.goal_readiness.plan_adherence !== null
    && analytics.goal_readiness.due_plan_sessions >= 4) {
    const context = await getCurrentPlanFocusContext(c.env.DB, userId);
    if (context?.goalId === goal.id) {
      const proposal = buildPlanFocusProposal(context.nodes, context.sessionCount);
      if (proposal) {
        analytics.plan_focus = await recordPlanFocusExposure(
          c.env.DB,
          userId,
          goal.id,
          context.planId,
          proposal,
          {
            planAdherence: analytics.goal_readiness.plan_adherence,
            dueSessions: analytics.goal_readiness.due_plan_sessions,
          },
          now,
        );
      }
    }
  }
  if (!analytics.plan_focus && !analytics.information_gain && goal
    && analytics.goal_readiness.evidence_coverage !== null
    && analytics.goal_readiness.evidence_coverage < 0.5) {
    const context = await getCurrentPlanFocusContext(c.env.DB, userId);
    if (context?.goalId === goal.id) {
      const proposal = buildInformationGainProposal(context.nodes, context.sessionCount);
      if (proposal) {
        analytics.information_gain = await recordInformationGainExposure(
          c.env.DB,
          userId,
          goal.id,
          context.planId,
          proposal,
          {
            planAdherence: analytics.goal_readiness.plan_adherence,
            dueSessions: analytics.goal_readiness.due_plan_sessions,
          },
          now,
        );
      }
    }
  }
  return c.json({ analytics });
});

app.post("/api/analytics/strategy/:id/accept", async (c) => {
  const user = c.get("user");
  const experimentId = c.req.param("id");
  const accepted = await acceptStrategyExperiment(c.env.DB, user.id, experimentId);
  if (!accepted) fail(404, "Strategy experiment not found or no longer active");
  return c.json({ id: experimentId, accepted: true });
});

app.post("/api/analytics/schedule-adaptation/:id/accept", async (c) => {
  const user = c.get("user");
  const accepted = await acceptScheduleAdaptation(c.env.DB, user.id, c.req.param("id"));
  if (!accepted) fail(409, "Schedule adaptation is stale or no longer active");
  const studyPlan = await generateStudyPlan(c.env.DB, user);
  return c.json({
    accepted: true,
    goal: await getActiveStudyGoal(c.env.DB, user.id),
    study_plan: studyPlan,
  });
});

app.post("/api/analytics/plan-focus/:id/accept", async (c) => {
  const user = c.get("user");
  const accepted = await acceptPlanFocus(c.env.DB, user.id, c.req.param("id"));
  if (!accepted) fail(409, "Plan focus proposal is stale or no longer active");
  return c.json({
    accepted: true,
    study_plan: await generateStudyPlan(c.env.DB, user),
  });
});

app.post("/api/analytics/information-gain/:id/accept", async (c) => {
  const user = c.get("user");
  const accepted = await acceptInformationGain(c.env.DB, user.id, c.req.param("id"));
  if (!accepted) fail(409, "Information gain proposal is stale or no longer active");
  return c.json({
    accepted: true,
    study_plan: await generateStudyPlan(c.env.DB, user),
  });
});

function normalizeDiagnosticProblemCalibrationRow(row: DiagnosticProblemCalibrationRow): DiagnosticProblemCalibrationRow {
  return {
    ...row,
    content_revision: Number(row.content_revision),
    users: Number(row.users),
    paired_users: Number(row.paired_users),
    mean_score: row.mean_score === null ? null : Number(row.mean_score),
    score_stddev: row.score_stddev === null ? null : Number(row.score_stddev),
    anchor_correlation: row.anchor_correlation === null ? null : Number(row.anchor_correlation),
    target_score: Number(row.target_score),
  };
}

async function loadDiagnosticProblemValidityForContent(db: D1Database, contentId: string) {
  const item = await db.prepare(
    `SELECT dpc.id AS content_id, dpc.problem_id, dpc.problem_label,
            dpc.revision AS content_revision, dpb.difficulty
     FROM diagnostic_problem_contents dpc
     JOIN diagnostic_problem_blueprints dpb ON dpb.id = dpc.blueprint_id
     WHERE dpc.id = ? AND dpc.status = 'approved' AND dpc.materialized_at IS NOT NULL`,
  ).bind(contentId).first<DiagnosticProblemValidityItemRow>();
  if (!item) return null;
  const attempts = await db.prepare(
    `WITH ranked AS (
       SELECT a.problem_id, a.user_id, a.score_rate, a.created_at,
              ROW_NUMBER() OVER (
                PARTITION BY a.problem_id, a.user_id ORDER BY a.created_at DESC, a.id DESC
              ) AS row_number
       FROM attempts a
       WHERE a.problem_id = ? AND a.score_rate IS NOT NULL
         AND a.created_at >= datetime('now', '-365 days')
     )
     SELECT r.problem_id, r.user_id, r.score_rate,
            (
              SELECT AVG(a2.score_rate)
              FROM attempts a2
              WHERE a2.user_id = r.user_id AND a2.problem_id <> r.problem_id
                AND a2.score_rate IS NOT NULL
                AND a2.created_at < r.created_at
                AND a2.created_at >= datetime(r.created_at, '-180 days')
                AND EXISTS (
                  SELECT 1
                  FROM node_registry nr_original
                  JOIN knowledge_edges ke_original
                    ON ke_original.from_node_id = nr_original.node_id
                   AND ke_original.edge_type = 'tests' AND ke_original.status = 'approved'
                  JOIN node_registry nr_other
                    ON nr_other.entity_type = 'problem' AND nr_other.entity_id = a2.problem_id
                  JOIN knowledge_edges ke_other
                    ON ke_other.from_node_id = nr_other.node_id
                   AND ke_other.to_node_id = ke_original.to_node_id
                   AND ke_other.edge_type = 'tests' AND ke_other.status = 'approved'
                  WHERE nr_original.entity_type = 'problem' AND nr_original.entity_id = r.problem_id
                )
            ) AS anchor_score
     FROM ranked r WHERE r.row_number = 1
     ORDER BY r.user_id`,
  ).bind(item.problem_id).all<DiagnosticProblemValidityAttemptRow>();
  return buildDiagnosticProblemValidity(
    [{ ...item, difficulty: Number(item.difficulty), content_revision: Number(item.content_revision ?? 1) }],
    attempts.results.map((row) => ({
      ...row,
      score_rate: Number(row.score_rate),
      anchor_score: row.anchor_score === null ? null : Number(row.anchor_score),
    })),
  ).items[0] ?? null;
}

app.get("/api/admin/model-health", async (c) => {
  requireRole(c.get("user"), "reviewer");
  const [evaluations, counts, shadowEvaluations, outcomeEvaluations, strategyEvaluations, readinessEvaluations, scheduleAdaptationEvaluations, planFocusEvaluations, informationGainEvaluations, diagnosticItemEvaluations, diagnosticContentNodes, diagnosticContentCandidates, diagnosticProblemValidityItems, diagnosticProblemValidityAttempts, diagnosticProblemCalibrationRows, masteryShadowRows] = await Promise.all([
    c.env.DB
      .prepare(
        `WITH attempt_counts AS (
           SELECT user_id, COUNT(*) AS attempt_count FROM attempts GROUP BY user_id
         )
         SELECT p.user_id, p.mode, p.personalized_prediction, p.baseline_prediction,
                p.prediction_confidence, p.observed_score, p.observed_at,
                COALESCE(ac.attempt_count, 0) AS user_attempt_count
         FROM learning_model_predictions p
         LEFT JOIN attempt_counts ac ON ac.user_id = p.user_id
         WHERE p.model_version = ? AND p.observed_score IS NOT NULL
           AND p.observed_at >= datetime('now', '-365 days')
         ORDER BY p.observed_at DESC
         LIMIT 10000`,
      )
      .bind(RECOMMENDATION_MODEL_VERSION)
      .all<ModelHealthEvaluationRow>(),
    c.env.DB
      .prepare(
        `SELECT COUNT(*) AS exposures,
                SUM(CASE WHEN observed_score IS NOT NULL THEN 1 ELSE 0 END) AS observed
         FROM learning_model_predictions
         WHERE model_version = ? AND exposed_at >= datetime('now', '-365 days')`,
      )
      .bind(RECOMMENDATION_MODEL_VERSION)
      .first<{ exposures: number; observed: number }>(),
    c.env.DB
      .prepare(
        `WITH recent_predictions AS (
           SELECT id, user_id, personalized_prediction, observed_score
           FROM learning_model_predictions
           WHERE model_version = ? AND observed_score IS NOT NULL
             AND observed_at >= datetime('now', '-365 days')
           ORDER BY observed_at DESC
           LIMIT 10000
         )
         SELECT p.user_id, s.candidate_version, s.hypothesis_id, s.candidate_label,
                s.predicted_success AS candidate_prediction,
                p.personalized_prediction AS current_prediction, p.observed_score
         FROM recent_predictions p
         JOIN learning_model_shadow_predictions s ON s.prediction_id = p.id
         ORDER BY s.candidate_version, p.id`,
      )
      .bind(RECOMMENDATION_MODEL_VERSION)
      .all<ModelHealthShadowRow>(),
    c.env.DB
      .prepare(
        `SELECT user_id, rank_position, recommendation_score,
                CASE WHEN observed_at IS NOT NULL
                           AND julianday(observed_at) >= julianday(exposed_at)
                           AND julianday(observed_at) <= julianday(exposed_at, '+7 days')
                     THEN 1 ELSE 0 END AS attempted_7d,
                CASE WHEN observed_at IS NOT NULL
                           AND julianday(observed_at) >= julianday(exposed_at)
                           AND julianday(observed_at) <= julianday(exposed_at, '+7 days')
                     THEN (julianday(observed_at) - julianday(exposed_at)) * 24
                     ELSE NULL END AS latency_hours
         FROM learning_model_predictions
         WHERE model_version = ?
           AND exposed_at >= datetime('now', '-365 days')
           AND exposed_at <= datetime('now', '-7 days')
           AND rank_position BETWEEN 1 AND 20
         ORDER BY exposed_at DESC
         LIMIT 10000`,
      )
      .bind(RECOMMENDATION_MODEL_VERSION)
      .all<ModelHealthOutcomeRow>(),
    c.env.DB
      .prepare(
        `SELECT user_id, recommended_mode, score_uplift
         FROM learning_strategy_experiments
         WHERE completed_at IS NOT NULL AND cancelled_at IS NULL
           AND baseline_score IS NOT NULL AND followup_score IS NOT NULL AND score_uplift IS NOT NULL
           AND completed_at >= datetime('now', '-365 days')
         ORDER BY completed_at DESC
         LIMIT 10000`,
      )
      .all<ModelHealthStrategyRow>(),
    c.env.DB
      .prepare(
        `SELECT user_id, goal_id, snapshot_date, readiness_score,
                knowledge_readiness, plan_adherence
         FROM learning_readiness_snapshots
         WHERE model_version = ? AND recorded_at >= datetime('now', '-400 days')
         ORDER BY snapshot_date DESC
         LIMIT 10000`,
      )
      .bind(GOAL_READINESS_MODEL_VERSION)
      .all<ReadinessHealthRow>(),
    c.env.DB
      .prepare(
        `SELECT user_id, adherence_uplift
         FROM learning_schedule_adaptation_experiments
         WHERE model_version = ? AND completed_at IS NOT NULL AND cancelled_at IS NULL
           AND adherence_uplift IS NOT NULL AND completed_at >= datetime('now', '-365 days')
         ORDER BY completed_at DESC
         LIMIT 10000`,
      )
      .bind(SCHEDULE_ADAPTATION_MODEL_VERSION)
      .all<ScheduleAdaptationHealthRow>(),
    c.env.DB
      .prepare(
        `SELECT user_id, focus_mastery_uplift, adherence_uplift, coverage_rate
         FROM learning_plan_focus_experiments
         WHERE model_version = ? AND completed_at IS NOT NULL AND cancelled_at IS NULL
           AND focus_mastery_uplift IS NOT NULL AND adherence_uplift IS NOT NULL
           AND coverage_rate IS NOT NULL AND completed_at >= datetime('now', '-365 days')
         ORDER BY completed_at DESC
         LIMIT 10000`,
      )
      .bind(PLAN_FOCUS_MODEL_VERSION)
      .all<PlanFocusHealthRow>(),
    c.env.DB
      .prepare(
        `SELECT user_id, evidence_acquired_at, evidence_latency_hours,
                followup_plan_adherence, coverage_rate
         FROM learning_information_gain_experiments
         WHERE model_version = ? AND completed_at IS NOT NULL AND cancelled_at IS NULL
           AND followup_plan_adherence IS NOT NULL AND coverage_rate IS NOT NULL
           AND completed_at >= datetime('now', '-365 days')
         ORDER BY completed_at DESC
         LIMIT 10000`,
      )
      .bind(INFORMATION_GAIN_MODEL_VERSION)
      .all<InformationGainHealthRow>(),
    c.env.DB
      .prepare(
        `SELECT user_id, selected_utility, baseline_utility, estimated_minutes,
                observed_result, observed_direct_evidence_count,
                observed_time_minutes, completion_latency_hours,
                candidate_problem_count, comparable_candidate_count,
                utility_spread, ranking_opportunity, selection_changed
         FROM learning_diagnostic_item_exposures
         WHERE model_version = ? AND cancelled_at IS NULL
           AND exposed_at <= datetime('now', '-14 days')
           AND exposed_at >= datetime('now', '-365 days')
         ORDER BY exposed_at DESC
         LIMIT 10000`,
      )
      .bind(DIAGNOSTIC_ITEM_MODEL_VERSION)
      .all<DiagnosticItemHealthRow>(),
    c.env.DB
      .prepare(
        `WITH active_graphs AS (
           SELECT id, subject_key, topic FROM learning_graphs WHERE status = 'active'
         )
         SELECT g.id AS graph_id, g.subject_key, g.topic,
                n.id AS graph_node_id, n.label AS node_label, n.node_type, n.layer,
                COUNT(DISTINCT c.id) AS mapped_concept_count,
                COALESCE((
                  SELECT SUM(lge.weight) FROM learning_graph_edges lge
                  WHERE lge.graph_id = g.id AND lge.source_node_id = n.id
                ), 0.0) AS downstream_weight
         FROM active_graphs g
         JOIN learning_graph_nodes n ON n.graph_id = g.id
         LEFT JOIN learning_graph_concept_links l
           ON l.graph_node_id = n.id AND l.status = 'approved'
         LEFT JOIN concepts c ON c.id = l.concept_id AND c.status = 'active'
         GROUP BY g.id, g.subject_key, g.topic, n.id, n.label, n.node_type, n.layer
         ORDER BY g.subject_key, n.layer, n.sort_index, n.id`,
      )
      .all<DiagnosticContentNodeInventoryRow>(),
    c.env.DB
      .prepare(
        `SELECT n.id AS graph_node_id, p.id AS problem_id, p.problem_label, ke.edge_type,
                EXISTS(
                  SELECT 1 FROM learning_graph_problem_links lgpl
                  WHERE lgpl.graph_node_id = n.id AND lgpl.problem_id = p.id
                    AND lgpl.relation_type = 'direct' AND lgpl.status = 'approved'
                ) AS explicit_direct
         FROM learning_graphs g
         JOIN learning_graph_nodes n ON n.graph_id = g.id
         JOIN learning_graph_concept_links l
           ON l.graph_node_id = n.id AND l.status = 'approved'
         JOIN concepts c ON c.id = l.concept_id AND c.status = 'active'
         JOIN node_registry nr_concept
           ON nr_concept.entity_type = 'concept' AND nr_concept.entity_id = c.id
         JOIN knowledge_edges ke
           ON ke.to_node_id = nr_concept.node_id AND ke.status = 'approved'
          AND ke.edge_type IN ('tests', 'requires')
         JOIN node_registry nr_problem
           ON nr_problem.node_id = ke.from_node_id AND nr_problem.entity_type = 'problem'
         JOIN problems p ON p.id = nr_problem.entity_id AND p.status = 'reviewed'
         JOIN source_documents sd
           ON sd.id = p.source_document_id AND sd.source_status = 'active'
          AND (
            (sd.source_url IS NOT NULL AND sd.source_url <> '' AND LOWER(sd.source_url) LIKE 'https://%')
            OR EXISTS (
              SELECT 1 FROM diagnostic_problem_contents dpc
              WHERE dpc.problem_id = p.id AND dpc.status = 'approved' AND dpc.materialized_at IS NOT NULL
            )
          )
          AND sd.access_scope IN ('source_link_only', 'public_ready')
         WHERE g.status = 'active'
         ORDER BY n.id, p.id, ke.edge_type`,
      )
      .all<DiagnosticContentCandidateRow>(),
    c.env.DB.prepare(
      `SELECT dpc.id AS content_id, dpc.problem_id, dpc.problem_label,
              dpc.revision AS content_revision, dpb.difficulty
       FROM diagnostic_problem_contents dpc
       JOIN diagnostic_problem_blueprints dpb ON dpb.id = dpc.blueprint_id
       WHERE dpc.status = 'approved' AND dpc.materialized_at IS NOT NULL
       ORDER BY dpc.problem_label, dpc.id`,
    ).all<DiagnosticProblemValidityItemRow>(),
    c.env.DB.prepare(
      `WITH approved_originals AS (
         SELECT problem_id FROM diagnostic_problem_contents
         WHERE status = 'approved' AND materialized_at IS NOT NULL
       ), ranked AS (
         SELECT a.problem_id, a.user_id, a.score_rate, a.created_at,
                ROW_NUMBER() OVER (
                  PARTITION BY a.problem_id, a.user_id ORDER BY a.created_at DESC, a.id DESC
                ) AS row_number
         FROM attempts a JOIN approved_originals oi ON oi.problem_id = a.problem_id
         WHERE a.score_rate IS NOT NULL AND a.created_at >= datetime('now', '-365 days')
       )
       SELECT r.problem_id, r.user_id, r.score_rate,
              (
                SELECT AVG(a2.score_rate)
                FROM attempts a2
                WHERE a2.user_id = r.user_id AND a2.problem_id <> r.problem_id
                  AND a2.score_rate IS NOT NULL
                  AND a2.created_at < r.created_at
                  AND a2.created_at >= datetime(r.created_at, '-180 days')
                  AND EXISTS (
                    SELECT 1
                    FROM node_registry nr_original
                    JOIN knowledge_edges ke_original
                      ON ke_original.from_node_id = nr_original.node_id
                     AND ke_original.edge_type = 'tests' AND ke_original.status = 'approved'
                    JOIN node_registry nr_other
                      ON nr_other.entity_type = 'problem' AND nr_other.entity_id = a2.problem_id
                    JOIN knowledge_edges ke_other
                      ON ke_other.from_node_id = nr_other.node_id
                     AND ke_other.to_node_id = ke_original.to_node_id
                     AND ke_other.edge_type = 'tests' AND ke_other.status = 'approved'
                    WHERE nr_original.entity_type = 'problem' AND nr_original.entity_id = r.problem_id
                  )
              ) AS anchor_score
       FROM ranked r WHERE r.row_number = 1
       ORDER BY r.problem_id, r.user_id`,
    ).all<DiagnosticProblemValidityAttemptRow>(),
    c.env.DB.prepare(
      `SELECT id, content_id, content_revision, validity_model_version, snapshot_key,
              users, paired_users, mean_score, score_stddev, anchor_correlation,
              target_score, observed_status, decision, rationale, status,
              proposed_by, reviewed_by, review_note, created_at, reviewed_at, valid_until
       FROM diagnostic_problem_calibration_decisions
       WHERE status IN ('candidate', 'approved')
       ORDER BY created_at DESC, id DESC`,
    ).all<DiagnosticProblemCalibrationRow>(),
    c.env.DB.prepare(
      `SELECT user_id, current_prediction, candidate_prediction, observed_score
       FROM learning_mastery_shadow_evidence
       WHERE candidate_model_version = ? AND observed_score IS NOT NULL
         AND observed_at >= datetime('now', '-365 days')
       ORDER BY observed_at DESC LIMIT 10000`,
    ).bind(MASTERY_DIFFICULTY_SHADOW_VERSION).all<MasteryShadowEvaluationRow>(),
  ]);
  return c.json({
    model_health: buildModelHealth(evaluations.results, {
      modelVersion: RECOMMENDATION_MODEL_VERSION,
      totalExposures: Number(counts?.exposures ?? 0),
      availableObserved: Number(counts?.observed ?? evaluations.results.length),
      shadowRows: shadowEvaluations.results,
      outcomeRows: outcomeEvaluations.results,
      strategyRows: strategyEvaluations.results,
      readinessRows: readinessEvaluations.results,
      scheduleAdaptationRows: scheduleAdaptationEvaluations.results,
      planFocusRows: planFocusEvaluations.results,
      informationGainRows: informationGainEvaluations.results,
      diagnosticItemRows: diagnosticItemEvaluations.results,
      diagnosticContentRows: mergeDiagnosticContentInventory(
        diagnosticContentNodes.results.map((row) => ({
          ...row,
          layer: Number(row.layer),
          mapped_concept_count: Number(row.mapped_concept_count),
          downstream_weight: Number(row.downstream_weight),
        })),
        diagnosticContentCandidates.results,
        studyPlanProblemMatchesNode,
      ),
      diagnosticProblemValidityItems: diagnosticProblemValidityItems.results.map((row) => ({
        ...row,
        difficulty: Number(row.difficulty),
        content_revision: Number(row.content_revision ?? 1),
      })),
      diagnosticProblemValidityAttempts: diagnosticProblemValidityAttempts.results.map((row) => ({
        ...row,
        score_rate: Number(row.score_rate),
        anchor_score: row.anchor_score === null ? null : Number(row.anchor_score),
      })),
      diagnosticProblemCalibrationRows: diagnosticProblemCalibrationRows.results.map(normalizeDiagnosticProblemCalibrationRow),
      masteryShadowRows: masteryShadowRows.results.map((row) => ({
        ...row,
        current_prediction: Number(row.current_prediction),
        candidate_prediction: Number(row.candidate_prediction),
        observed_score: Number(row.observed_score),
      })),
    }),
  });
});

app.post("/api/admin/model-health/original-problems/:id/calibrations", async (c) => {
  const user = c.get("user");
  requireRole(user, "reviewer");
  const current = await loadDiagnosticProblemValidityForContent(c.env.DB, c.req.param("id"));
  if (!current) fail(404, "Approved original problem not found");
  const rawBody = await readJson<unknown>(c.req.raw);
  const inputError = diagnosticProblemCalibrationInputError(rawBody, current);
  if (inputError) fail(409, inputError);
  const body = rawBody as DiagnosticProblemCalibrationInput;
  const existing = await c.env.DB.prepare(
    "SELECT id FROM diagnostic_problem_calibration_decisions WHERE content_id = ? AND status = 'candidate'",
  ).bind(current.content_id).first<{ id: string }>();
  if (existing) fail(409, "審査待ちの校正判断がすでにあります。");
  const id = ulid("dcal");
  await c.env.DB.prepare(
    `INSERT INTO diagnostic_problem_calibration_decisions (
       id, content_id, content_revision, validity_model_version, snapshot_key,
       users, paired_users, mean_score, score_stddev, anchor_correlation,
       target_score, observed_status, decision, rationale, status, proposed_by
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'candidate', ?)`,
  ).bind(
    id,
    current.content_id,
    current.content_revision,
    DIAGNOSTIC_PROBLEM_VALIDITY_MODEL_VERSION,
    current.snapshot_key,
    current.users,
    current.paired_users,
    current.mean_score,
    current.score_stddev,
    current.anchor_correlation,
    current.target_score,
    current.status,
    body.decision,
    body.rationale.trim(),
    user.id,
  ).run();
  const created = await c.env.DB.prepare(
    "SELECT * FROM diagnostic_problem_calibration_decisions WHERE id = ?",
  ).bind(id).first<DiagnosticProblemCalibrationRow>();
  await auditLog(c.env.DB, user, "diagnostic_problem_calibration.propose", "diagnostic_problem_calibration", id, undefined, created);
  return c.json({ calibration: created ? normalizeDiagnosticProblemCalibrationRow(created) : null }, 201);
});

app.patch("/api/admin/model-health/original-problems/:contentId/calibrations/:decisionId/review", async (c) => {
  const user = c.get("user");
  requireRole(user, "admin");
  const body = await readJson<{
    status?: "approved" | "rejected";
    expected_snapshot_key?: string;
    review_note?: string;
  }>(c.req.raw);
  if (body.status !== "approved" && body.status !== "rejected") fail(400, "審査結果を選んでください。");
  if (typeof body.review_note !== "string" || body.review_note.trim().length < 10 || body.review_note.trim().length > 1000) {
    fail(400, "審査メモは10〜1000文字で入力してください。");
  }
  const before = await c.env.DB.prepare(
    "SELECT * FROM diagnostic_problem_calibration_decisions WHERE id = ? AND content_id = ? AND status = 'candidate'",
  ).bind(c.req.param("decisionId"), c.req.param("contentId")).first<DiagnosticProblemCalibrationRow>();
  if (!before) fail(404, "Calibration decision not found");
  if (before.proposed_by === user.id) fail(403, "提案者本人は校正判断を承認できません。");

  if (body.status === "approved") {
    const current = await loadDiagnosticProblemValidityForContent(c.env.DB, before.content_id);
    if (!current) fail(409, "対象問題が公開対象ではなくなっています。");
    if (typeof body.expected_snapshot_key !== "string"
      || body.expected_snapshot_key !== before.snapshot_key
      || current.snapshot_key !== before.snapshot_key) {
      fail(409, "観測結果が提案時から更新されています。再提案してください。");
    }
    if (before.decision === "mastery_enabled" && current.status !== "healthy") {
      fail(409, "現在の健全性判定では習熟度への反映を承認できません。");
    }
    const reviewedAt = new Date().toISOString();
    const validUntil = new Date(Date.parse(reviewedAt) + 90 * 86_400_000).toISOString();
    await c.env.DB.batch([
      c.env.DB.prepare(
        `UPDATE diagnostic_problem_calibration_decisions
         SET status = 'superseded'
         WHERE content_id = ? AND status = 'approved'`,
      ).bind(before.content_id),
      c.env.DB.prepare(
        `UPDATE diagnostic_problem_calibration_decisions
         SET status = 'approved', reviewed_by = ?, review_note = ?, reviewed_at = ?, valid_until = ?
         WHERE id = ? AND status = 'candidate'`,
      ).bind(user.id, body.review_note.trim(), reviewedAt, validUntil, before.id),
    ]);
  } else {
    await c.env.DB.prepare(
      `UPDATE diagnostic_problem_calibration_decisions
       SET status = 'rejected', reviewed_by = ?, review_note = ?, reviewed_at = ?
       WHERE id = ? AND status = 'candidate'`,
    ).bind(user.id, body.review_note.trim(), new Date().toISOString(), before.id).run();
  }
  const updated = await c.env.DB.prepare(
    "SELECT * FROM diagnostic_problem_calibration_decisions WHERE id = ?",
  ).bind(before.id).first<DiagnosticProblemCalibrationRow>();
  await auditLog(c.env.DB, user, "diagnostic_problem_calibration.review", "diagnostic_problem_calibration", before.id, before, updated);
  return c.json({ calibration: updated ? normalizeDiagnosticProblemCalibrationRow(updated) : null });
});

app.get("/api/admin/diagnostic-content/remediation", async (c) => {
  requireRole(c.get("user"), "editor");
  const [nodeRows, contentCandidateRows, remediationCandidateRows] = await Promise.all([
    c.env.DB.prepare(
      `WITH active_graphs AS (
         SELECT id, subject_key, topic FROM learning_graphs WHERE status = 'active'
       )
       SELECT g.id AS graph_id, g.subject_key, g.topic,
              n.id AS graph_node_id, n.label AS node_label, n.node_type, n.layer,
              COUNT(DISTINCT c.id) AS mapped_concept_count,
              COALESCE((
                SELECT SUM(lge.weight) FROM learning_graph_edges lge
                WHERE lge.graph_id = g.id AND lge.source_node_id = n.id
              ), 0.0) AS downstream_weight
       FROM active_graphs g
       JOIN learning_graph_nodes n ON n.graph_id = g.id
       LEFT JOIN learning_graph_concept_links l
         ON l.graph_node_id = n.id AND l.status = 'approved'
       LEFT JOIN concepts c ON c.id = l.concept_id AND c.status = 'active'
       GROUP BY g.id, g.subject_key, g.topic, n.id, n.label, n.node_type, n.layer
       ORDER BY g.subject_key, n.layer, n.sort_index, n.id`,
    ).all<DiagnosticContentNodeInventoryRow>(),
    c.env.DB.prepare(
      `SELECT n.id AS graph_node_id, p.id AS problem_id, p.problem_label, ke.edge_type,
              EXISTS(
                SELECT 1 FROM learning_graph_problem_links lgpl
                WHERE lgpl.graph_node_id = n.id AND lgpl.problem_id = p.id
                  AND lgpl.relation_type = 'direct' AND lgpl.status = 'approved'
              ) AS explicit_direct
       FROM learning_graphs g
       JOIN learning_graph_nodes n ON n.graph_id = g.id
       JOIN learning_graph_concept_links l
         ON l.graph_node_id = n.id AND l.status = 'approved'
       JOIN concepts c ON c.id = l.concept_id AND c.status = 'active'
       JOIN node_registry nr_concept
         ON nr_concept.entity_type = 'concept' AND nr_concept.entity_id = c.id
       JOIN knowledge_edges ke
         ON ke.to_node_id = nr_concept.node_id AND ke.status = 'approved'
        AND ke.edge_type IN ('tests', 'requires')
       JOIN node_registry nr_problem
         ON nr_problem.node_id = ke.from_node_id AND nr_problem.entity_type = 'problem'
       JOIN problems p ON p.id = nr_problem.entity_id AND p.status = 'reviewed'
       JOIN source_documents sd
         ON sd.id = p.source_document_id AND sd.source_status = 'active'
        AND (
          (sd.source_url IS NOT NULL AND sd.source_url <> '' AND LOWER(sd.source_url) LIKE 'https://%')
          OR EXISTS (
            SELECT 1 FROM diagnostic_problem_contents dpc
            WHERE dpc.problem_id = p.id AND dpc.status = 'approved' AND dpc.materialized_at IS NOT NULL
          )
        )
        AND sd.access_scope IN ('source_link_only', 'public_ready')
       WHERE g.status = 'active'
       ORDER BY n.id, p.id, ke.edge_type`,
    ).all<DiagnosticContentCandidateRow>(),
    c.env.DB.prepare(
      `SELECT n.id AS graph_node_id, p.id AS problem_id, p.problem_label,
              sd.university, sd.exam_year, p.answer_format, p.estimated_minutes,
              SUBSTR(COALESCE(p.statement_text, ''), 1, 240) AS statement_preview,
              sd.source_url, p.page_start, p.page_end,
              COUNT(DISTINCT c.id) AS concept_overlap,
              GROUP_CONCAT(DISTINCT c.name_ja) AS concept_names,
              lgpl.id AS link_id, lgpl.status AS link_status,
              lgpl.confidence AS link_confidence, lgpl.rationale AS link_rationale,
              lgpl.created_by AS link_created_by, lgpl.reviewed_by AS link_reviewed_by
       FROM learning_graphs g
       JOIN learning_graph_nodes n ON n.graph_id = g.id
       JOIN learning_graph_concept_links l
         ON l.graph_node_id = n.id AND l.status = 'approved'
       JOIN concepts c ON c.id = l.concept_id AND c.status = 'active'
       JOIN node_registry nr_concept
         ON nr_concept.entity_type = 'concept' AND nr_concept.entity_id = c.id
       JOIN knowledge_edges ke
         ON ke.to_node_id = nr_concept.node_id AND ke.status = 'approved' AND ke.edge_type = 'tests'
       JOIN node_registry nr_problem
         ON nr_problem.node_id = ke.from_node_id AND nr_problem.entity_type = 'problem'
       JOIN problems p ON p.id = nr_problem.entity_id AND p.status = 'reviewed'
       JOIN source_documents sd
         ON sd.id = p.source_document_id AND sd.source_status = 'active'
        AND (
          (sd.source_url IS NOT NULL AND sd.source_url <> '' AND LOWER(sd.source_url) LIKE 'https://%')
          OR EXISTS (
            SELECT 1 FROM diagnostic_problem_contents dpc
            WHERE dpc.problem_id = p.id AND dpc.status = 'approved' AND dpc.materialized_at IS NOT NULL
          )
        )
        AND sd.access_scope IN ('source_link_only', 'public_ready')
       LEFT JOIN learning_graph_problem_links lgpl
         ON lgpl.graph_node_id = n.id AND lgpl.problem_id = p.id AND lgpl.relation_type = 'direct'
       WHERE g.status = 'active'
       GROUP BY n.id, p.id, p.problem_label, sd.university, sd.exam_year,
                p.answer_format, p.estimated_minutes, p.statement_text, sd.source_url,
                p.page_start, p.page_end, lgpl.id, lgpl.status,
                lgpl.confidence, lgpl.rationale, lgpl.created_by, lgpl.reviewed_by
       ORDER BY n.id, concept_overlap DESC, p.problem_label`,
    ).all<Omit<DiagnosticRemediationCandidateRow, "label_match">>(),
  ]);
  const inventory = mergeDiagnosticContentInventory(
    nodeRows.results.map((row) => ({
      ...row,
      layer: Number(row.layer),
      mapped_concept_count: Number(row.mapped_concept_count),
      downstream_weight: Number(row.downstream_weight),
    })),
    contentCandidateRows.results.map((row) => ({ ...row, explicit_direct: Number(row.explicit_direct ?? 0) })),
    studyPlanProblemMatchesNode,
  );
  const nodeLabelById = new Map(nodeRows.results.map((node) => [node.graph_node_id, node.node_label]));
  const candidates = remediationCandidateRows.results.map((row): DiagnosticRemediationCandidateRow => ({
    ...row,
    exam_year: Number(row.exam_year),
    estimated_minutes: Number(row.estimated_minutes),
    concept_overlap: Number(row.concept_overlap),
    link_confidence: row.link_confidence === null ? null : Number(row.link_confidence),
    label_match: studyPlanProblemMatchesNode(
      nodeLabelById.get(row.graph_node_id) ?? "",
      row.problem_label,
    ) ? 1 : 0,
  }));
  return c.json({ remediation: buildDiagnosticRemediationQueue(inventory, candidates) });
});

app.post("/api/admin/diagnostic-content/links", async (c) => {
  const user = c.get("user");
  requireRole(user, "editor");
  const body = await readJson<{ graph_node_id?: unknown; problem_id?: unknown }>(c.req.raw);
  const graphNodeId = typeof body.graph_node_id === "string" ? body.graph_node_id.trim() : "";
  const problemId = typeof body.problem_id === "string" ? body.problem_id.trim() : "";
  if (!graphNodeId || !problemId || graphNodeId.length > 160 || problemId.length > 160) {
    fail(400, "graph_node_id and problem_id are required");
  }
  const evidence = await diagnosticLinkEvidence(c.env.DB, graphNodeId, problemId);
  const labelMatch = studyPlanProblemMatchesNode(evidence.node_label, evidence.problem_label);
  const confidence = Math.min(0.95, 0.65 + evidence.concept_overlap * 0.1 + (labelMatch ? 0.1 : 0));
  const rationale = `${evidence.concept_overlap}件の承認済みtests概念が重複（${evidence.concept_names}）${labelMatch ? "、名称適合あり" : ""}`;
  const id = ulid("lgpl");
  const result = await c.env.DB.prepare(
    `INSERT OR IGNORE INTO learning_graph_problem_links (
       id, graph_node_id, problem_id, relation_type, confidence, evidence_type,
       rationale, status, created_by
     ) VALUES (?, ?, ?, 'direct', ?, ?, ?, 'candidate', ?)`,
  ).bind(id, graphNodeId, problemId, confidence, labelMatch ? "label_match" : "concept_overlap", rationale, user.id).run();
  const created = Number(result.meta.changes ?? 0) > 0;
  const link = await c.env.DB.prepare(
    `SELECT id, graph_node_id, problem_id, relation_type, confidence, evidence_type,
            rationale, status, created_by, reviewed_by, created_at, reviewed_at
     FROM learning_graph_problem_links
     WHERE graph_node_id = ? AND problem_id = ? AND relation_type = 'direct'`,
  ).bind(graphNodeId, problemId).first();
  if (!link) fail(500, "Diagnostic content link could not be loaded");
  if (created) {
    await auditLog(c.env.DB, user, "diagnostic_content_link.propose", "learning_graph_problem_link", id, undefined, link);
    return c.json({ link, created: true }, 201);
  }
  return c.json({ link, created: false });
});

app.patch("/api/admin/diagnostic-content/links/:id/review", async (c) => {
  const user = c.get("user");
  requireRole(user, "reviewer");
  const id = c.req.param("id");
  const body = await readJson<{ status?: unknown; expected_status?: unknown }>(c.req.raw);
  if (body.status !== "approved" && body.status !== "rejected") fail(400, "status must be approved or rejected");
  if (body.expected_status !== "candidate") fail(400, "expected_status must be candidate");
  const before = await c.env.DB.prepare("SELECT * FROM learning_graph_problem_links WHERE id = ?").bind(id).first<Record<string, unknown>>();
  if (!before) fail(404, "Diagnostic content link not found");
  if (body.status === "approved") {
    await diagnosticLinkEvidence(c.env.DB, String(before.graph_node_id), String(before.problem_id));
  }
  const result = await c.env.DB.prepare(
    `UPDATE learning_graph_problem_links
     SET status = ?, reviewed_by = ?, reviewed_at = datetime('now')
     WHERE id = ? AND status = ?`,
  ).bind(body.status, user.id, id, body.expected_status).run();
  if (Number(result.meta.changes ?? 0) !== 1) fail(409, "Diagnostic content link changed before review; reload and try again");
  const after = await c.env.DB.prepare("SELECT * FROM learning_graph_problem_links WHERE id = ?").bind(id).first();
  await auditLog(c.env.DB, user, "diagnostic_content_link.review", "learning_graph_problem_link", id, before, after);
  return c.json({ link: after });
});

app.patch("/api/admin/diagnostic-content/links/:id/resubmit", async (c) => {
  const user = c.get("user");
  requireRole(user, "editor");
  const id = c.req.param("id");
  const body = await readJson<{ expected_status?: unknown }>(c.req.raw);
  if (body.expected_status !== "rejected") fail(400, "expected_status must be rejected");
  const before = await c.env.DB.prepare("SELECT * FROM learning_graph_problem_links WHERE id = ?").bind(id).first<Record<string, unknown>>();
  if (!before) fail(404, "Diagnostic content link not found");
  const evidence = await diagnosticLinkEvidence(c.env.DB, String(before.graph_node_id), String(before.problem_id));
  const labelMatch = studyPlanProblemMatchesNode(evidence.node_label, evidence.problem_label);
  const confidence = Math.min(0.95, 0.65 + evidence.concept_overlap * 0.1 + (labelMatch ? 0.1 : 0));
  const rationale = `${evidence.concept_overlap}件の承認済みtests概念が重複（${evidence.concept_names}）${labelMatch ? "、名称適合あり" : ""}`;
  const result = await c.env.DB.prepare(
    `UPDATE learning_graph_problem_links
     SET status = 'candidate', confidence = ?, evidence_type = ?, rationale = ?,
         reviewed_by = NULL, reviewed_at = NULL
     WHERE id = ? AND status = ?`,
  ).bind(confidence, labelMatch ? "label_match" : "concept_overlap", rationale, id, body.expected_status).run();
  if (Number(result.meta.changes ?? 0) !== 1) fail(409, "Diagnostic content link changed before resubmission; reload and try again");
  const after = await c.env.DB.prepare("SELECT * FROM learning_graph_problem_links WHERE id = ?").bind(id).first();
  await auditLog(c.env.DB, user, "diagnostic_content_link.resubmit", "learning_graph_problem_link", id, before, after);
  return c.json({ link: after });
});

app.get("/api/admin/diagnostic-content/blueprints", async (c) => {
  requireRole(c.get("user"), "editor");
  const [nodes, blueprintRows] = await Promise.all([
    loadDiagnosticContentSnapshot(c.env.DB),
    c.env.DB.prepare(
      `SELECT id, graph_node_id, slot, title, assessment_objective, evidence_expectation,
              cognitive_demand, answer_format, difficulty, estimated_minutes,
              rubric_json, misconception_targets_json, originality_policy, status,
              revision, review_note, created_by, submitted_by, reviewed_by,
              submitted_at, reviewed_at
       FROM diagnostic_problem_blueprints
       WHERE graph_node_id IN (
         SELECT n.id FROM learning_graph_nodes n
         JOIN learning_graphs g ON g.id = n.graph_id WHERE g.status = 'active'
       )
       ORDER BY graph_node_id, slot`,
    ).all<DiagnosticBlueprintRow>(),
  ]);
  return c.json({ blueprint_queue: buildDiagnosticBlueprintQueue(nodes, blueprintRows.results) });
});

app.post("/api/admin/diagnostic-content/blueprints", async (c) => {
  const user = c.get("user");
  requireRole(user, "editor");
  const body = await readJson<{ graph_node_id?: unknown; slot?: unknown }>(c.req.raw);
  const graphNodeId = typeof body.graph_node_id === "string" ? body.graph_node_id.trim() : "";
  const slot = typeof body.slot === "number" && Number.isInteger(body.slot) ? body.slot : 0;
  if (!graphNodeId || graphNodeId.length > 160 || slot < 1 || slot > 3) fail(400, "graph_node_id and slot 1..3 are required");
  const node = await c.env.DB.prepare(
    `SELECT n.id AS graph_node_id, n.label AS node_label, n.node_type, n.layer, g.topic
     FROM learning_graph_nodes n JOIN learning_graphs g ON g.id = n.graph_id
     WHERE n.id = ? AND g.status = 'active'`,
  ).bind(graphNodeId).first<{
    graph_node_id: string;
    node_label: string;
    node_type: "FOUNDATIONAL" | "BASIC" | "CORE" | "APPLICATION";
    layer: number;
    topic: string;
  }>();
  if (!node) fail(404, "Active graph node not found");
  const defaults = defaultDiagnosticBlueprint({ ...node, layer: Number(node.layer) }, slot as 1 | 2 | 3);
  const id = ulid("dbp");
  const result = await c.env.DB.prepare(
    `INSERT OR IGNORE INTO diagnostic_problem_blueprints (
       id, graph_node_id, slot, title, assessment_objective, evidence_expectation,
       cognitive_demand, answer_format, difficulty, estimated_minutes, rubric_json,
       misconception_targets_json, originality_policy, status, created_by
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'original_only', 'draft', ?)`,
  ).bind(
    id, graphNodeId, slot, defaults.title, defaults.assessment_objective, defaults.evidence_expectation,
    defaults.cognitive_demand, defaults.answer_format, defaults.difficulty, defaults.estimated_minutes,
    JSON.stringify(defaults.rubric), JSON.stringify(defaults.misconception_targets), user.id,
  ).run();
  const created = Number(result.meta.changes ?? 0) === 1;
  const blueprint = await c.env.DB.prepare("SELECT * FROM diagnostic_problem_blueprints WHERE graph_node_id = ? AND slot = ?")
    .bind(graphNodeId, slot).first();
  if (!blueprint) fail(500, "Diagnostic blueprint could not be loaded");
  if (created) {
    await auditLog(c.env.DB, user, "diagnostic_blueprint.create", "diagnostic_problem_blueprint", id, undefined, blueprint);
    return c.json({ blueprint, created: true }, 201);
  }
  return c.json({ blueprint, created: false });
});

app.patch("/api/admin/diagnostic-content/blueprints/:id", async (c) => {
  const user = c.get("user");
  requireRole(user, "editor");
  const id = c.req.param("id");
  const body = await readJson<{ expected_revision?: unknown; blueprint?: unknown }>(c.req.raw);
  const expectedRevision = typeof body.expected_revision === "number" && Number.isInteger(body.expected_revision) ? body.expected_revision : 0;
  const validation = validateDiagnosticBlueprintInput(body.blueprint);
  if (!validation.data) fail(400, validation.issues.join(" / "));
  const before = await c.env.DB.prepare("SELECT * FROM diagnostic_problem_blueprints WHERE id = ?").bind(id).first<Record<string, unknown>>();
  if (!before) fail(404, "Diagnostic blueprint not found");
  if (before.status !== "draft" && before.status !== "rejected") fail(409, "Only draft or rejected blueprints can be edited");
  const input = validation.data;
  const result = await c.env.DB.prepare(
    `UPDATE diagnostic_problem_blueprints SET
       title = ?, assessment_objective = ?, evidence_expectation = ?, cognitive_demand = ?,
       answer_format = ?, difficulty = ?, estimated_minutes = ?, rubric_json = ?,
       misconception_targets_json = ?, originality_policy = 'original_only', status = 'draft',
       revision = revision + 1, review_note = NULL, submitted_by = NULL, reviewed_by = NULL,
       submitted_at = NULL, reviewed_at = NULL, updated_at = datetime('now')
     WHERE id = ? AND revision = ? AND status IN ('draft', 'rejected')`,
  ).bind(
    input.title, input.assessment_objective, input.evidence_expectation, input.cognitive_demand,
    input.answer_format, input.difficulty, input.estimated_minutes, JSON.stringify(input.rubric),
    JSON.stringify(input.misconception_targets), id, expectedRevision,
  ).run();
  if (Number(result.meta.changes ?? 0) !== 1) fail(409, "Diagnostic blueprint changed before save; reload and try again");
  const after = await c.env.DB.prepare("SELECT * FROM diagnostic_problem_blueprints WHERE id = ?").bind(id).first();
  await auditLog(c.env.DB, user, "diagnostic_blueprint.update", "diagnostic_problem_blueprint", id, before, after);
  return c.json({ blueprint: after });
});

app.patch("/api/admin/diagnostic-content/blueprints/:id/submit", async (c) => {
  const user = c.get("user");
  requireRole(user, "editor");
  const id = c.req.param("id");
  const body = await readJson<{ expected_revision?: unknown; measurable_attested?: unknown; originality_attested?: unknown }>(c.req.raw);
  const expectedRevision = typeof body.expected_revision === "number" && Number.isInteger(body.expected_revision) ? body.expected_revision : 0;
  if (body.measurable_attested !== true || body.originality_attested !== true) {
    fail(400, "Measurability and originality attestations are required");
  }
  const before = await c.env.DB.prepare("SELECT * FROM diagnostic_problem_blueprints WHERE id = ?").bind(id).first<Record<string, unknown>>();
  if (!before) fail(404, "Diagnostic blueprint not found");
  const validation = diagnosticBlueprintRowValidation(before);
  if (!validation.data) fail(400, validation.issues.join(" / "));
  const result = await c.env.DB.prepare(
    `UPDATE diagnostic_problem_blueprints
     SET status = 'candidate', revision = revision + 1, submitted_by = ?, submitted_at = datetime('now'),
         review_note = NULL, reviewed_by = NULL, reviewed_at = NULL, updated_at = datetime('now')
     WHERE id = ? AND revision = ? AND status IN ('draft', 'rejected')`,
  ).bind(user.id, id, expectedRevision).run();
  if (Number(result.meta.changes ?? 0) !== 1) fail(409, "Diagnostic blueprint changed before submission; reload and try again");
  const after = await c.env.DB.prepare("SELECT * FROM diagnostic_problem_blueprints WHERE id = ?").bind(id).first();
  await auditLog(c.env.DB, user, "diagnostic_blueprint.submit", "diagnostic_problem_blueprint", id, before, after);
  return c.json({ blueprint: after });
});

app.patch("/api/admin/diagnostic-content/blueprints/:id/review", async (c) => {
  const user = c.get("user");
  requireRole(user, "reviewer");
  const id = c.req.param("id");
  const body = await readJson<{
    expected_revision?: unknown;
    status?: unknown;
    review_note?: unknown;
    checks?: { objective_matches_node?: unknown; rubric_scores_evidence?: unknown; originality_confirmed?: unknown };
  }>(c.req.raw);
  const expectedRevision = typeof body.expected_revision === "number" && Number.isInteger(body.expected_revision) ? body.expected_revision : 0;
  if (body.status !== "approved" && body.status !== "rejected") fail(400, "status must be approved or rejected");
  const reviewNote = typeof body.review_note === "string" ? body.review_note.trim() : "";
  if (reviewNote.length > 500 || (body.status === "rejected" && reviewNote.length < 10)) {
    fail(400, "A rejection note of 10..500 characters is required");
  }
  const before = await c.env.DB.prepare("SELECT * FROM diagnostic_problem_blueprints WHERE id = ?").bind(id).first<Record<string, unknown>>();
  if (!before) fail(404, "Diagnostic blueprint not found");
  if (String(before.submitted_by) === user.id) fail(403, "A different reviewer is required from the submitter");
  if (body.status === "approved") {
    if (body.checks?.objective_matches_node !== true || body.checks?.rubric_scores_evidence !== true || body.checks?.originality_confirmed !== true) {
      fail(400, "All review checks are required for approval");
    }
    const validation = diagnosticBlueprintRowValidation(before);
    if (!validation.data) fail(400, validation.issues.join(" / "));
  }
  const result = await c.env.DB.prepare(
    `UPDATE diagnostic_problem_blueprints
     SET status = ?, revision = revision + 1, review_note = ?, reviewed_by = ?, reviewed_at = datetime('now'),
         updated_at = datetime('now')
     WHERE id = ? AND revision = ? AND status = 'candidate'`,
  ).bind(body.status, reviewNote || null, user.id, id, expectedRevision).run();
  if (Number(result.meta.changes ?? 0) !== 1) fail(409, "Diagnostic blueprint changed before review; reload and try again");
  const after = await c.env.DB.prepare("SELECT * FROM diagnostic_problem_blueprints WHERE id = ?").bind(id).first();
  await auditLog(c.env.DB, user, "diagnostic_blueprint.review", "diagnostic_problem_blueprint", id, before, after);
  return c.json({ blueprint: after });
});

app.get("/api/admin/diagnostic-content/original-problems", async (c) => {
  requireRole(c.get("user"), "editor");
  const [blueprintRows, contentRows, verificationRows] = await Promise.all([
    c.env.DB.prepare(
      `SELECT id, graph_node_id, slot, title, assessment_objective, evidence_expectation,
              cognitive_demand, answer_format, difficulty, estimated_minutes,
              rubric_json, misconception_targets_json, originality_policy, status,
              revision, review_note, created_by, submitted_by, reviewed_by,
              submitted_at, reviewed_at
       FROM diagnostic_problem_blueprints
       WHERE status = 'approved' AND graph_node_id IN (
         SELECT n.id FROM learning_graph_nodes n
         JOIN learning_graphs g ON g.id = n.graph_id WHERE g.status = 'active'
       )
       ORDER BY graph_node_id, slot`,
    ).all<DiagnosticBlueprintRow>(),
    c.env.DB.prepare(
      `SELECT id, blueprint_id, problem_id, problem_node_id, graph_problem_link_id,
              problem_label, statement_text, answer_text, explanation_text,
              scoring_examples_json, adversarial_checks_json, originality_note,
              content_fingerprint, status, revision, review_note, created_by,
              submitted_by, reviewed_by, submitted_at, reviewed_at, materialized_at,
              verification_cases_json, verification_status, verification_revision,
              verified_by, verified_at
       FROM diagnostic_problem_contents
       ORDER BY created_at, id`,
    ).all<DiagnosticProblemContentRow>(),
    c.env.DB.prepare(
      `SELECT id, content_id, content_revision, verifier_id, outcome,
              contract_json, results_json, note, created_at
       FROM diagnostic_problem_verification_runs
       ORDER BY created_at DESC, id DESC`,
    ).all<DiagnosticProblemVerificationRunRow>(),
  ]);
  const blueprints = blueprintRows.results.flatMap((row) => {
    const context = diagnosticProblemBlueprintContext(diagnosticBlueprintFromRow(row));
    return context ? [context] : [];
  });
  const runs = verificationRows.results.map(diagnosticProblemVerificationRunFromRow);
  return c.json({ authoring_queue: buildDiagnosticProblemAuthoringQueue(blueprints, contentRows.results, runs) });
});

app.post("/api/admin/diagnostic-content/original-problems", async (c) => {
  const user = c.get("user");
  requireRole(user, "editor");
  const body = await readJson<{ blueprint_id?: unknown }>(c.req.raw);
  const blueprintId = typeof body.blueprint_id === "string" ? body.blueprint_id.trim() : "";
  if (!blueprintId || blueprintId.length > 160) fail(400, "An approved blueprint_id is required");
  const blueprint = await loadDiagnosticProblemBlueprint(c.env.DB, blueprintId);
  if (!blueprint) fail(404, "Approved diagnostic blueprint not found");
  const defaults = defaultDiagnosticProblemContent(blueprint);
  const id = ulid("dpc");
  const problemId = ulid("prob");
  const problemNodeId = ulid("node");
  const graphProblemLinkId = ulid("lgpl");
  const result = await c.env.DB.prepare(
    `INSERT OR IGNORE INTO diagnostic_problem_contents (
       id, blueprint_id, problem_id, problem_node_id, graph_problem_link_id,
       problem_label, statement_text, answer_text, explanation_text,
       scoring_examples_json, adversarial_checks_json, verification_cases_json,
       originality_note, status, created_by
     ) VALUES (?, ?, ?, ?, ?, ?, '', '', '', ?, ?, ?, '', 'draft', ?)`,
  ).bind(
    id, blueprint.id, problemId, problemNodeId, graphProblemLinkId, defaults.problem_label,
    JSON.stringify(defaults.scoring_examples), JSON.stringify(defaults.adversarial_checks),
    JSON.stringify(defaults.verification_cases), user.id,
  ).run();
  const created = Number(result.meta.changes ?? 0) === 1;
  const content = await c.env.DB.prepare("SELECT * FROM diagnostic_problem_contents WHERE blueprint_id = ?")
    .bind(blueprint.id).first();
  if (!content) fail(500, "Diagnostic problem draft could not be loaded");
  if (created) {
    await auditLog(c.env.DB, user, "diagnostic_problem_content.create", "diagnostic_problem_content", id, undefined, content);
    return c.json({ content, created: true }, 201);
  }
  return c.json({ content, created: false });
});

app.patch("/api/admin/diagnostic-content/original-problems/:id", async (c) => {
  const user = c.get("user");
  requireRole(user, "editor");
  const id = c.req.param("id");
  const body = await readJson<{ expected_revision?: unknown; content?: unknown }>(c.req.raw);
  const expectedRevision = typeof body.expected_revision === "number" && Number.isInteger(body.expected_revision) ? body.expected_revision : 0;
  const before = await c.env.DB.prepare("SELECT * FROM diagnostic_problem_contents WHERE id = ?").bind(id).first<Record<string, unknown>>();
  if (!before) fail(404, "Diagnostic problem content not found");
  if (before.status !== "draft" && before.status !== "rejected") fail(409, "Only draft or rejected content can be edited");
  const blueprint = await loadDiagnosticProblemBlueprint(c.env.DB, String(before.blueprint_id));
  if (!blueprint) fail(409, "The approved blueprint is no longer available");
  const validation = validateDiagnosticProblemContent(body.content, blueprint);
  if (!validation.data) fail(400, validation.issues.join(" / "));
  const input = validation.data;
  const result = await c.env.DB.prepare(
    `UPDATE diagnostic_problem_contents SET
       problem_label = ?, statement_text = ?, answer_text = ?, explanation_text = ?,
       scoring_examples_json = ?, adversarial_checks_json = ?, verification_cases_json = ?, originality_note = ?,
       content_fingerprint = NULL, status = 'draft', revision = revision + 1,
       review_note = NULL, submitted_by = NULL, reviewed_by = NULL,
       verification_status = 'unverified', verification_revision = NULL,
       verified_by = NULL, verified_at = NULL,
       submitted_at = NULL, reviewed_at = NULL, updated_at = datetime('now')
     WHERE id = ? AND revision = ? AND status IN ('draft', 'rejected')`,
  ).bind(
    input.problem_label, input.statement_text, input.answer_text, input.explanation_text,
    JSON.stringify(input.scoring_examples), JSON.stringify(input.adversarial_checks),
    JSON.stringify(input.verification_cases), input.originality_note,
    id, expectedRevision,
  ).run();
  if (Number(result.meta.changes ?? 0) !== 1) fail(409, "Diagnostic problem content changed before save; reload and try again");
  const after = await c.env.DB.prepare("SELECT * FROM diagnostic_problem_contents WHERE id = ?").bind(id).first();
  await auditLog(c.env.DB, user, "diagnostic_problem_content.update", "diagnostic_problem_content", id, before, after);
  return c.json({ content: after });
});

app.patch("/api/admin/diagnostic-content/original-problems/:id/submit", async (c) => {
  const user = c.get("user");
  requireRole(user, "editor");
  const id = c.req.param("id");
  const body = await readJson<{
    expected_revision?: unknown;
    answer_verified?: unknown;
    rubric_calibrated?: unknown;
    originality_attested?: unknown;
  }>(c.req.raw);
  const expectedRevision = typeof body.expected_revision === "number" && Number.isInteger(body.expected_revision) ? body.expected_revision : 0;
  if (body.answer_verified !== true || body.rubric_calibrated !== true || body.originality_attested !== true) {
    fail(400, "Answer verification, rubric calibration, and originality attestations are required");
  }
  const before = await c.env.DB.prepare("SELECT * FROM diagnostic_problem_contents WHERE id = ?").bind(id).first<Record<string, unknown>>();
  if (!before) fail(404, "Diagnostic problem content not found");
  const blueprint = await loadDiagnosticProblemBlueprint(c.env.DB, String(before.blueprint_id));
  if (!blueprint) fail(409, "The approved blueprint is no longer available");
  const validation = diagnosticProblemContentRowValidation(before, blueprint);
  if (!validation.data) fail(400, validation.issues.join(" / "));
  const fingerprint = await fingerprintDiagnosticProblemContent(validation.data);
  const duplicate = await c.env.DB.prepare(
    `SELECT id FROM diagnostic_problem_contents
     WHERE content_fingerprint = ? AND id <> ? AND status IN ('candidate', 'approved') LIMIT 1`,
  ).bind(fingerprint, id).first<{ id: string }>();
  if (duplicate) fail(409, "An identical diagnostic problem is already under review or approved");
  const result = await c.env.DB.prepare(
    `UPDATE diagnostic_problem_contents
     SET status = 'candidate', revision = revision + 1, content_fingerprint = ?,
         submitted_by = ?, submitted_at = datetime('now'), review_note = NULL,
         reviewed_by = NULL, reviewed_at = NULL, verification_status = 'unverified',
         verification_revision = NULL, verified_by = NULL, verified_at = NULL,
         updated_at = datetime('now')
     WHERE id = ? AND revision = ? AND status IN ('draft', 'rejected')`,
  ).bind(fingerprint, user.id, id, expectedRevision).run();
  if (Number(result.meta.changes ?? 0) !== 1) fail(409, "Diagnostic problem content changed before submission; reload and try again");
  const after = await c.env.DB.prepare("SELECT * FROM diagnostic_problem_contents WHERE id = ?").bind(id).first();
  await auditLog(c.env.DB, user, "diagnostic_problem_content.submit", "diagnostic_problem_content", id, before, after);
  return c.json({ content: after });
});

app.patch("/api/admin/diagnostic-content/original-problems/:id/verify", async (c) => {
  const user = c.get("user");
  requireRole(user, "reviewer");
  const id = c.req.param("id");
  const body = await readJson<{ expected_revision?: unknown; results?: unknown; note?: unknown }>(c.req.raw);
  const expectedRevision = typeof body.expected_revision === "number" && Number.isInteger(body.expected_revision) ? body.expected_revision : 0;
  const note = typeof body.note === "string" ? body.note.trim() : "";
  if (note.length > 500) fail(400, "Verification note must be at most 500 characters");
  const before = await c.env.DB.prepare("SELECT * FROM diagnostic_problem_contents WHERE id = ?").bind(id).first<Record<string, unknown>>();
  if (!before) fail(404, "Diagnostic problem content not found");
  if (before.status !== "candidate") fail(409, "Only submitted diagnostic problem content can be verified");
  if (String(before.created_by) === user.id || String(before.submitted_by) === user.id) {
    fail(403, "A verifier different from the author and submitter is required");
  }
  if (before.verification_status === "passed") fail(409, "The current revision already has a passed verification");
  const blueprint = await loadDiagnosticProblemBlueprint(c.env.DB, String(before.blueprint_id));
  if (!blueprint) fail(409, "The approved blueprint is no longer available");
  const contentValidation = diagnosticProblemContentRowValidation(before, blueprint);
  if (!contentValidation.data) fail(400, contentValidation.issues.join(" / "));
  const resultsValidation = validateDiagnosticVerificationResults(body.results, contentValidation.data.verification_cases);
  if (!resultsValidation.data) fail(400, resultsValidation.issues.join(" / "));
  const outcome = resultsValidation.data.every((result) => result.passed) ? "passed" : "failed";
  if (outcome === "failed" && note.length < 10) fail(400, "A failed verification requires a note of 10..500 characters");
  const nextRevision = expectedRevision + 1;
  const runId = ulid("dpv");
  const batchResults = await c.env.DB.batch([
    c.env.DB.prepare(
      `UPDATE diagnostic_problem_contents
       SET status = ?, revision = revision + 1,
           content_fingerprint = CASE WHEN ? = 'failed' THEN NULL ELSE content_fingerprint END,
           verification_status = ?, verification_revision = ?, verified_by = ?, verified_at = datetime('now'),
           review_note = CASE WHEN ? = 'failed' THEN ? ELSE review_note END,
           updated_at = datetime('now')
       WHERE id = ? AND revision = ? AND status = 'candidate' AND verification_status = 'unverified'`,
    ).bind(outcome === "passed" ? "candidate" : "rejected", outcome, outcome, nextRevision, user.id, outcome, note || null, id, expectedRevision),
    c.env.DB.prepare(
      `INSERT INTO diagnostic_problem_verification_runs (
         id, content_id, content_revision, verifier_id, outcome, contract_json, results_json, note
       ) SELECT ?, ?, ?, ?, ?, ?, ?, ?
       WHERE EXISTS (
         SELECT 1 FROM diagnostic_problem_contents
         WHERE id = ? AND revision = ? AND verification_status = ? AND verified_by = ?
       )`,
    ).bind(
      runId, id, expectedRevision, user.id, outcome,
      JSON.stringify(contentValidation.data.verification_cases), JSON.stringify(resultsValidation.data), note || null,
      id, nextRevision, outcome, user.id,
    ),
  ]);
  if (Number(batchResults[0].meta.changes ?? 0) !== 1) fail(409, "Diagnostic problem content changed before verification; reload and try again");
  const after = await c.env.DB.prepare("SELECT * FROM diagnostic_problem_contents WHERE id = ?").bind(id).first();
  await auditLog(c.env.DB, user, "diagnostic_problem_content.verify", "diagnostic_problem_content", id, before, { content: after, run_id: runId, outcome });
  return c.json({ content: after, verification: { id: runId, outcome } });
});

app.patch("/api/admin/diagnostic-content/original-problems/:id/review", async (c) => {
  const user = c.get("user");
  requireRole(user, "reviewer");
  const id = c.req.param("id");
  const body = await readJson<{
    expected_revision?: unknown;
    status?: unknown;
    review_note?: unknown;
    checks?: {
      statement_matches_blueprint?: unknown;
      scoring_calibrated?: unknown;
      originality_confirmed?: unknown;
    };
  }>(c.req.raw);
  const expectedRevision = typeof body.expected_revision === "number" && Number.isInteger(body.expected_revision) ? body.expected_revision : 0;
  if (body.status !== "approved" && body.status !== "rejected") fail(400, "status must be approved or rejected");
  const reviewNote = typeof body.review_note === "string" ? body.review_note.trim() : "";
  if (reviewNote.length > 500 || (body.status === "rejected" && reviewNote.length < 10)) {
    fail(400, "A rejection note of 10..500 characters is required");
  }
  const before = await c.env.DB.prepare("SELECT * FROM diagnostic_problem_contents WHERE id = ?").bind(id).first<Record<string, unknown>>();
  if (!before) fail(404, "Diagnostic problem content not found");
  if (String(before.created_by) === user.id || String(before.submitted_by) === user.id) {
    fail(403, "A reviewer different from the author and submitter is required");
  }
  if (body.status === "approved" && String(before.verified_by ?? "") === user.id) {
    fail(403, "A final approver different from the independent verifier is required");
  }
  const blueprint = await loadDiagnosticProblemBlueprint(c.env.DB, String(before.blueprint_id));
  if (!blueprint) fail(409, "The approved blueprint is no longer available");
  const validation = diagnosticProblemContentRowValidation(before, blueprint);
  if (!validation.data) fail(400, validation.issues.join(" / "));
  const reviewFingerprint = await fingerprintDiagnosticProblemContent(validation.data);
  if (String(before.content_fingerprint ?? "") !== reviewFingerprint) {
    fail(409, "Diagnostic problem content fingerprint changed after submission");
  }

  if (body.status === "rejected") {
    const result = await c.env.DB.prepare(
      `UPDATE diagnostic_problem_contents
       SET status = 'rejected', revision = revision + 1, content_fingerprint = NULL, review_note = ?,
           reviewed_by = ?, reviewed_at = datetime('now'), verification_status = 'unverified',
           verification_revision = NULL, verified_by = NULL, verified_at = NULL, updated_at = datetime('now')
       WHERE id = ? AND revision = ? AND status = 'candidate'`,
    ).bind(reviewNote, user.id, id, expectedRevision).run();
    if (Number(result.meta.changes ?? 0) !== 1) fail(409, "Diagnostic problem content changed before review; reload and try again");
    const after = await c.env.DB.prepare("SELECT * FROM diagnostic_problem_contents WHERE id = ?").bind(id).first();
    await auditLog(c.env.DB, user, "diagnostic_problem_content.review", "diagnostic_problem_content", id, before, after);
    return c.json({ content: after });
  }

  if (before.verification_status !== "passed" || Number(before.verification_revision) !== expectedRevision || !before.verified_by) {
    fail(409, "A passed independent verification for the current revision is required before approval");
  }
  if (body.checks?.statement_matches_blueprint !== true
    || body.checks?.scoring_calibrated !== true || body.checks?.originality_confirmed !== true) {
    fail(400, "All content review checks are required for approval");
  }
  const currentYear = new Date().getUTCFullYear();
  const sourceId = "src_original_diagnostic_v1";
  const nodeRationale = `承認済み設計仕様「${blueprint.title}」に基づくオリジナル診断問題`;
  const batchResults = await c.env.DB.batch([
    c.env.DB.prepare(
      `UPDATE diagnostic_problem_contents
       SET status = 'approved', revision = revision + 1, review_note = ?,
           reviewed_by = ?, reviewed_at = datetime('now'), materialized_at = datetime('now'),
           updated_at = datetime('now')
       WHERE id = ? AND revision = ? AND status = 'candidate'`,
    ).bind(reviewNote || null, user.id, id, expectedRevision),
    c.env.DB.prepare(
      `INSERT OR IGNORE INTO source_documents (
         id, source_type, title, university, graduate_school, department, exam_year,
         exam_category, source_url, file_hash, storage_path, access_scope,
         extraction_status, created_by, publisher_page_url, pdf_display_mode,
         source_status, source_checked_at
       )
       SELECT ?, 'manual_input', '院試演習帳 オリジナル診断問題', '院試演習帳', NULL, NULL, ?,
              'オリジナル教材', NULL, 'original-diagnostic-v1', 'original://diagnostic/v1',
              'public_ready', 'reviewed', ?, NULL, 'external_only', 'active', datetime('now')
       WHERE EXISTS (
         SELECT 1 FROM diagnostic_problem_contents WHERE id = ? AND status = 'approved'
       )`,
    ).bind(sourceId, currentYear, user.id, id),
    c.env.DB.prepare(
      `INSERT OR IGNORE INTO problems (
         id, source_document_id, problem_label, statement_text, answer_text, explanation_text,
         subject_raw, difficulty, estimated_minutes, answer_format, status, created_by, reviewed_by
       ) SELECT dpc.problem_id, ?, dpc.problem_label, dpc.statement_text, dpc.answer_text,
                dpc.explanation_text, ?, ?, ?, ?, 'reviewed', dpc.created_by, ?
         FROM diagnostic_problem_contents dpc
         WHERE dpc.id = ? AND dpc.status = 'approved'`,
    ).bind(sourceId, "オリジナル診断", blueprint.difficulty, blueprint.estimated_minutes, blueprint.answer_format, user.id, id),
    c.env.DB.prepare(
      `INSERT OR IGNORE INTO node_registry (node_id, entity_type, entity_id, display_name)
       SELECT problem_node_id, 'problem', problem_id, problem_label
       FROM diagnostic_problem_contents WHERE id = ? AND status = 'approved'`,
    ).bind(id),
    c.env.DB.prepare(
      `INSERT OR IGNORE INTO knowledge_edges (
         id, from_node_id, edge_type, to_node_id, weight, confidence,
         evidence_type, status, created_by, reviewed_by
       )
       SELECT 'ke_' || dpc.id || '_' || l.concept_id, dpc.problem_node_id, 'tests', nr.node_id,
              1.0, 1.0, 'manual', 'approved', dpc.created_by, ?
       FROM diagnostic_problem_contents dpc
       JOIN diagnostic_problem_blueprints dpb ON dpb.id = dpc.blueprint_id AND dpb.status = 'approved'
       JOIN learning_graph_concept_links l ON l.graph_node_id = dpb.graph_node_id AND l.status = 'approved'
       JOIN node_registry nr ON nr.entity_type = 'concept' AND nr.entity_id = l.concept_id
       WHERE dpc.id = ? AND dpc.status = 'approved'`,
    ).bind(user.id, id),
    c.env.DB.prepare(
      `INSERT OR IGNORE INTO learning_graph_problem_links (
         id, graph_node_id, problem_id, relation_type, confidence, evidence_type,
         rationale, status, created_by, reviewed_by, reviewed_at
       ) SELECT dpc.graph_problem_link_id, dpb.graph_node_id, dpc.problem_id, 'direct',
                1.0, 'manual', ?, 'approved', dpc.created_by, ?, datetime('now')
         FROM diagnostic_problem_contents dpc
         JOIN diagnostic_problem_blueprints dpb ON dpb.id = dpc.blueprint_id AND dpb.status = 'approved'
         WHERE dpc.id = ? AND dpc.status = 'approved'`,
    ).bind(nodeRationale, user.id, id),
  ]);
  if (Number(batchResults[0].meta.changes ?? 0) !== 1) fail(409, "Diagnostic problem content changed before review; reload and try again");
  const after = await c.env.DB.prepare("SELECT * FROM diagnostic_problem_contents WHERE id = ?").bind(id).first();
  await auditLog(c.env.DB, user, "diagnostic_problem_content.review", "diagnostic_problem_content", id, before, after);
  return c.json({ content: after });
});

function normalizeProblemChatMessages(value: unknown): ProblemChatMessage[] {
  if (!Array.isArray(value)) return [];
  const messages: ProblemChatMessage[] = [];
  for (const item of value.slice(-12)) {
    if (!item || typeof item !== "object") continue;
    const candidate = item as { role?: unknown; content?: unknown };
    if (candidate.role !== "user" && candidate.role !== "assistant") continue;
    if (typeof candidate.content !== "string") continue;
    const content = compactForPrompt(candidate.content, 1_200);
    if (content) messages.push({ role: candidate.role, content });
  }
  return messages;
}

function compactForPrompt(value: string | null | undefined, limit: number): string {
  const compacted = (value ?? "").replace(/\s+/g, " ").trim();
  if (compacted.length <= limit) return compacted;
  return `${compacted.slice(0, limit)}...`;
}

function buildProblemChatContext(problem: NonNullable<Awaited<ReturnType<typeof getProblem>>>): string {
  const concepts = problem.concepts
    .map((concept) => concept.name_ja)
    .filter(Boolean)
    .slice(0, 8)
    .join(", ");
  const similar = problem.similar
    .slice(0, 4)
    .map((item) => `${item.university} ${item.exam_year} ${item.problem_label}`)
    .join("; ");
  const pageStart = problem.page_start ?? 1;
  const pageEnd = problem.page_end ?? pageStart;
  return [
    `大学: ${problem.university}`,
    `研究科/部局: ${problem.graduate_school ?? "不明"}`,
    `年度: ${problem.exam_year}`,
    `問題: ${problem.problem_label}`,
    `科目/分類: ${problem.subject_raw ?? "不明"}`,
    `PDFページ: ${pageStart === pageEnd ? `${pageStart}` : `${pageStart}-${pageEnd}`}`,
    `難易度: ${problem.difficulty}/5`,
    `想定時間: ${problem.estimated_minutes}分`,
    `解答形式: ${problem.answer_format}`,
    `関連概念: ${concepts || "未登録"}`,
    `類題: ${similar || "未登録"}`,
    `抽出済み問題文: ${compactForPrompt(problem.statement_text, 3_500) || "未登録。PDF表示内容を参照する必要があります。"}`,
  ].join("\n");
}

function extractAiText(response: unknown): string {
  if (typeof response === "string") return response;
  if (!response || typeof response !== "object") return "回答を生成できませんでした。";
  const record = response as {
    response?: unknown;
    choices?: Array<{ message?: { content?: unknown }; text?: unknown }>;
  };
  if (typeof record.response === "string" && record.response.trim()) return record.response;
  const firstChoice = record.choices?.[0];
  if (typeof firstChoice?.message?.content === "string" && firstChoice.message.content.trim()) {
    return firstChoice.message.content;
  }
  if (typeof firstChoice?.text === "string" && firstChoice.text.trim()) return firstChoice.text;
  return "回答を生成できませんでした。";
}

function externalHttpsUrl(value: string, field: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    fail(400, `${field} must be a valid URL`);
  }
  if (url.protocol !== "https:" || url.username || url.password) fail(400, `${field} must be a public HTTPS URL`);
  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host === "0.0.0.0" || host === "127.0.0.1" || host === "::1") {
    fail(400, `${field} must be a public HTTPS URL`);
  }
  url.hash = "";
  return url.toString();
}

function assertPublishableSource(sourceUrl: string, accessScope: string): void {
  if (!sourceUrl) fail(400, "an active source requires a public PDF URL");
  if (!['source_link_only', 'public_ready'].includes(accessScope)) {
    fail(400, "an active source must be approved for public linking");
  }
  if (new URL(sourceUrl).hostname.toLowerCase() === "raw.githubusercontent.com") {
    fail(400, "repository mirror URLs cannot be published as official sources");
  }
}

async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function ensureNode(db: D1Database, entityType: string, entityId: string): Promise<string> {
  const existing = await db
    .prepare("SELECT node_id FROM node_registry WHERE entity_type = ? AND entity_id = ?")
    .bind(entityType, entityId)
    .first<{ node_id: string }>();
  if (!existing) fail(404, `Node not found: ${entityType}:${entityId}`);
  return existing.node_id;
}

async function diagnosticLinkEvidence(db: D1Database, graphNodeId: string, problemId: string): Promise<{
  node_label: string;
  problem_label: string;
  concept_overlap: number;
  concept_names: string;
}> {
  const row = await db.prepare(
    `SELECT n.label AS node_label, p.problem_label,
            COUNT(DISTINCT c.id) AS concept_overlap,
            GROUP_CONCAT(DISTINCT c.name_ja) AS concept_names
     FROM learning_graph_nodes n
     JOIN learning_graphs g ON g.id = n.graph_id AND g.status = 'active'
     JOIN learning_graph_concept_links l
       ON l.graph_node_id = n.id AND l.status = 'approved'
     JOIN concepts c ON c.id = l.concept_id AND c.status = 'active'
     JOIN node_registry nr_concept
       ON nr_concept.entity_type = 'concept' AND nr_concept.entity_id = c.id
     JOIN knowledge_edges ke
       ON ke.to_node_id = nr_concept.node_id AND ke.edge_type = 'tests' AND ke.status = 'approved'
     JOIN node_registry nr_problem
       ON nr_problem.node_id = ke.from_node_id AND nr_problem.entity_type = 'problem'
     JOIN problems p ON p.id = nr_problem.entity_id AND p.status = 'reviewed'
     JOIN source_documents sd
       ON sd.id = p.source_document_id AND sd.source_status = 'active'
      AND (
        (sd.source_url IS NOT NULL AND sd.source_url <> '' AND LOWER(sd.source_url) LIKE 'https://%')
        OR EXISTS (
          SELECT 1 FROM diagnostic_problem_contents dpc
          WHERE dpc.problem_id = p.id AND dpc.status = 'approved' AND dpc.materialized_at IS NOT NULL
        )
      )
      AND sd.access_scope IN ('source_link_only', 'public_ready')
     WHERE n.id = ? AND p.id = ?
     GROUP BY n.id, n.label, p.id, p.problem_label`,
  ).bind(graphNodeId, problemId).first<{
    node_label: string;
    problem_label: string;
    concept_overlap: number;
    concept_names: string | null;
  }>();
  if (!row || Number(row.concept_overlap) < 1) {
    fail(400, "A reviewed public problem must share an approved tests concept with the active graph node");
  }
  return {
    node_label: row.node_label,
    problem_label: row.problem_label,
    concept_overlap: Number(row.concept_overlap),
    concept_names: row.concept_names ?? "概念名未設定",
  };
}

async function loadDiagnosticContentSnapshot(db: D1Database): Promise<DiagnosticContentNodeRow[]> {
  const [nodeRows, candidateRows] = await Promise.all([
    db.prepare(
      `WITH active_graphs AS (
         SELECT id, subject_key, topic FROM learning_graphs WHERE status = 'active'
       )
       SELECT g.id AS graph_id, g.subject_key, g.topic,
              n.id AS graph_node_id, n.label AS node_label, n.node_type, n.layer,
              COUNT(DISTINCT c.id) AS mapped_concept_count,
              COALESCE((
                SELECT SUM(lge.weight) FROM learning_graph_edges lge
                WHERE lge.graph_id = g.id AND lge.source_node_id = n.id
              ), 0.0) AS downstream_weight
       FROM active_graphs g
       JOIN learning_graph_nodes n ON n.graph_id = g.id
       LEFT JOIN learning_graph_concept_links l
         ON l.graph_node_id = n.id AND l.status = 'approved'
       LEFT JOIN concepts c ON c.id = l.concept_id AND c.status = 'active'
       GROUP BY g.id, g.subject_key, g.topic, n.id, n.label, n.node_type, n.layer
       ORDER BY g.subject_key, n.layer, n.sort_index, n.id`,
    ).all<DiagnosticContentNodeInventoryRow>(),
    db.prepare(
      `SELECT n.id AS graph_node_id, p.id AS problem_id, p.problem_label, ke.edge_type,
              EXISTS(
                SELECT 1 FROM learning_graph_problem_links lgpl
                WHERE lgpl.graph_node_id = n.id AND lgpl.problem_id = p.id
                  AND lgpl.relation_type = 'direct' AND lgpl.status = 'approved'
              ) AS explicit_direct
       FROM learning_graphs g
       JOIN learning_graph_nodes n ON n.graph_id = g.id
       JOIN learning_graph_concept_links l ON l.graph_node_id = n.id AND l.status = 'approved'
       JOIN concepts c ON c.id = l.concept_id AND c.status = 'active'
       JOIN node_registry nr_concept
         ON nr_concept.entity_type = 'concept' AND nr_concept.entity_id = c.id
       JOIN knowledge_edges ke
         ON ke.to_node_id = nr_concept.node_id AND ke.status = 'approved'
        AND ke.edge_type IN ('tests', 'requires')
       JOIN node_registry nr_problem
         ON nr_problem.node_id = ke.from_node_id AND nr_problem.entity_type = 'problem'
       JOIN problems p ON p.id = nr_problem.entity_id AND p.status = 'reviewed'
       JOIN source_documents sd
         ON sd.id = p.source_document_id AND sd.source_status = 'active'
        AND (
          (sd.source_url IS NOT NULL AND sd.source_url <> '' AND LOWER(sd.source_url) LIKE 'https://%')
          OR EXISTS (
            SELECT 1 FROM diagnostic_problem_contents dpc
            WHERE dpc.problem_id = p.id AND dpc.status = 'approved' AND dpc.materialized_at IS NOT NULL
          )
        )
        AND sd.access_scope IN ('source_link_only', 'public_ready')
       WHERE g.status = 'active'
       ORDER BY n.id, p.id, ke.edge_type`,
    ).all<DiagnosticContentCandidateRow>(),
  ]);
  return mergeDiagnosticContentInventory(
    nodeRows.results.map((row) => ({
      ...row,
      layer: Number(row.layer),
      mapped_concept_count: Number(row.mapped_concept_count),
      downstream_weight: Number(row.downstream_weight),
    })),
    candidateRows.results.map((row) => ({ ...row, explicit_direct: Number(row.explicit_direct ?? 0) })),
    studyPlanProblemMatchesNode,
  );
}

function diagnosticBlueprintRowValidation(row: Record<string, unknown>) {
  let rubric: unknown = [];
  let misconceptions: unknown = [];
  try { rubric = JSON.parse(String(row.rubric_json ?? "[]")); } catch { rubric = []; }
  try { misconceptions = JSON.parse(String(row.misconception_targets_json ?? "[]")); } catch { misconceptions = []; }
  return validateDiagnosticBlueprintInput({
    title: row.title,
    assessment_objective: row.assessment_objective,
    evidence_expectation: row.evidence_expectation,
    cognitive_demand: row.cognitive_demand,
    answer_format: row.answer_format,
    difficulty: Number(row.difficulty),
    estimated_minutes: Number(row.estimated_minutes),
    rubric,
    misconception_targets: misconceptions,
    originality_policy: row.originality_policy,
  });
}

async function loadDiagnosticProblemBlueprint(db: D1Database, id: string): Promise<DiagnosticProblemBlueprintContext | null> {
  const row = await db.prepare(
    `SELECT id, graph_node_id, slot, title, assessment_objective, evidence_expectation,
            cognitive_demand, answer_format, difficulty, estimated_minutes,
            rubric_json, misconception_targets_json, originality_policy, status,
            revision, review_note, created_by, submitted_by, reviewed_by,
            submitted_at, reviewed_at
     FROM diagnostic_problem_blueprints
     WHERE id = ? AND status = 'approved' AND graph_node_id IN (
       SELECT n.id FROM learning_graph_nodes n
       JOIN learning_graphs g ON g.id = n.graph_id WHERE g.status = 'active'
     )`,
  ).bind(id).first<DiagnosticBlueprintRow>();
  return row ? diagnosticProblemBlueprintContext(diagnosticBlueprintFromRow(row)) : null;
}

function diagnosticProblemContentRowValidation(
  row: Record<string, unknown>,
  blueprint: DiagnosticProblemBlueprintContext,
) {
  let scoringExamples: unknown = [];
  let adversarialChecks: unknown = [];
  let verificationCases: unknown = [];
  try { scoringExamples = JSON.parse(String(row.scoring_examples_json ?? "[]")); } catch { scoringExamples = []; }
  try { adversarialChecks = JSON.parse(String(row.adversarial_checks_json ?? "[]")); } catch { adversarialChecks = []; }
  try { verificationCases = JSON.parse(String(row.verification_cases_json ?? "[]")); } catch { verificationCases = []; }
  return validateDiagnosticProblemContent({
    problem_label: row.problem_label,
    statement_text: row.statement_text,
    answer_text: row.answer_text,
    explanation_text: row.explanation_text,
    scoring_examples: scoringExamples,
    adversarial_checks: adversarialChecks,
    verification_cases: verificationCases,
    originality_note: row.originality_note,
  }, blueprint);
}

function validateEdgeShape(fromType: string, edgeType: string, toType: string): void {
  const problemConcept = ["tests", "requires", "uses_formula", "solved_by", "commonly_missed_by"];
  const problemProblem = ["similar_to", "same_template_as", "variant_of", "easier_version_of", "prerequisite_problem_of"];
  const conceptConcept = ["prerequisite_of", "broader_than", "related_to", "contrast_with", "part_of"];
  if (problemConcept.includes(edgeType) && fromType === "problem" && toType === "concept") return;
  if (problemProblem.includes(edgeType) && fromType === "problem" && toType === "problem") return;
  if (conceptConcept.includes(edgeType) && fromType === "concept" && toType === "concept") return;
  fail(400, `Invalid edge shape: ${fromType} ${edgeType} ${toType}`);
}

async function assertReviewable(db: D1Database, problemId: string): Promise<void> {
  const problem = await db
    .prepare(
      `SELECT p.id, p.problem_label, p.statement_text, p.statement_asset_ids, p.difficulty, p.estimated_minutes,
              p.duplicate_of, sd.access_scope
       FROM problems p
       JOIN source_documents sd ON sd.id = p.source_document_id
       WHERE p.id = ?`,
    )
    .bind(problemId)
    .first<Record<string, unknown>>();
  if (!problem) fail(404, "Problem not found");
  if (!problem.problem_label) fail(400, "problem_label is required");
  if (!problem.difficulty || Number(problem.difficulty) < 1 || Number(problem.difficulty) > 5) fail(400, "difficulty must be 1..5");
  if (!problem.estimated_minutes || Number(problem.estimated_minutes) < 1 || Number(problem.estimated_minutes) > 180) {
    fail(400, "estimated_minutes must be 1..180");
  }
  if (problem.duplicate_of) fail(400, "duplicate problem cannot be reviewed");
  const assetIds = String(problem.statement_asset_ids ?? "[]");
  if (!problem.statement_text && assetIds === "[]") fail(400, "statement text or assets are required");

  const testsEdge = await db
    .prepare(
      `SELECT 1
       FROM knowledge_edges ke
       JOIN node_registry nr_problem ON nr_problem.node_id = ke.from_node_id
       JOIN node_registry nr_concept ON nr_concept.node_id = ke.to_node_id
       WHERE nr_problem.entity_type = 'problem'
         AND nr_problem.entity_id = ?
         AND nr_concept.entity_type = 'concept'
         AND ke.edge_type = 'tests'
         AND ke.status = 'approved'
       LIMIT 1`,
    )
    .bind(problemId)
    .first();
  if (!testsEdge) fail(400, "at least one approved tests Concept is required");
}

export default {
  fetch: app.fetch,
  async queue(batch, env): Promise<void> {
    for (const message of batch.messages) {
      try {
        const body = message.body as RecommendationQueueMessage;
        await buildRecommendations(env.DB, body.userId, "normal");
        await buildRecommendations(env.DB, body.userId, "review");
        await buildRecommendations(env.DB, body.userId, "foundation");
        await buildRecommendations(env.DB, body.userId, "challenge");
        const user = await env.DB.prepare("SELECT * FROM users WHERE id = ? AND status = 'active'").bind(body.userId).first<AppUser>();
        const goal = user ? await getActiveStudyGoal(env.DB, user.id) : null;
        if (user && goal && await hasActiveLearningGraph(env.DB, goal.subject_key)) {
          await generateStudyPlan(env.DB, user);
        }
        message.ack();
      } catch (error) {
        console.error(JSON.stringify({ level: "error", message: "Learning update failed", error: String(error) }));
        message.retry({ delaySeconds: 60 });
      }
    }
  },
} satisfies ExportedHandler<Env, RecommendationQueueMessage>;
