import { Hono } from "hono";
import type { Context } from "hono";
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
import { effectiveScore, nextMastery, reviewDueIso } from "./scoring";

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

async function serveProblemPdf(c: Context<{ Bindings: Env; Variables: Variables }>, problemId: string) {
  const user = c.get("user");
  const row = await c.env.DB
    .prepare(
      `SELECT p.status, p.problem_label, sd.source_url, sd.storage_path
       FROM problems p
       JOIN source_documents sd ON sd.id = p.source_document_id
       WHERE p.id = ?`,
    )
    .bind(problemId)
    .first<{ status: string; problem_label: string; source_url: string | null; storage_path: string | null }>();
  if (!row) fail(404, "Problem not found");
  if (user.role === "member" && row.status !== "reviewed") fail(404, "Problem not found");

  const sourceAssets = (c.env as Env & { SOURCE_ASSETS?: R2Bucket }).SOURCE_ASSETS;
  if (sourceAssets && row.storage_path) {
    const object = await sourceAssets.get(row.storage_path, { range: c.req.raw.headers });
    if (object) {
      const headers = new Headers();
      object.writeHttpMetadata(headers);
      headers.set("content-type", object.httpMetadata?.contentType || "application/pdf");
      headers.set("content-disposition", `inline; filename="${encodeURIComponent(row.problem_label)}.pdf"`);
      headers.set("cache-control", "private, max-age=3600");
      headers.set("accept-ranges", "bytes");
      headers.set("etag", object.httpEtag);
      let status = 200;
      if (object.range) {
        let offset: number;
        let length: number;
        if ("suffix" in object.range) {
          length = object.range.suffix;
          offset = Math.max(0, object.size - length);
        } else {
          offset = object.range.offset ?? 0;
          length = object.range.length ?? object.size - offset;
        }
        headers.set("content-range", `bytes ${offset}-${offset + length - 1}/${object.size}`);
        headers.set("content-length", String(length));
        status = 206;
      } else {
        headers.set("content-length", String(object.size));
      }
      return new Response(object.body, { status, headers });
    }
  }

  if (!row.source_url) fail(404, "PDF source is not registered");

  const requestHeaders = new Headers({
    accept: "application/pdf,*/*;q=0.5",
    "user-agent": "graduate-exam-knowledge-base/0.1",
  });
  const range = c.req.header("range");
  if (range) requestHeaders.set("range", range);

  const upstream = await fetch(row.source_url, {
    headers: requestHeaders,
    cache: "no-store",
  });
  if (!upstream.ok) fail(502, "PDF source could not be loaded");

  const headers = new Headers(upstream.headers);
  const contentType = upstream.headers.get("content-type") ?? "";
  if (contentType.includes("text/html")) fail(502, "PDF source returned HTML instead of a PDF");
  headers.set("content-type", contentType || "application/pdf");
  headers.set("content-disposition", `inline; filename="${encodeURIComponent(row.problem_label)}.pdf"`);
  headers.set("cache-control", "private, no-store");
  headers.set("accept-ranges", upstream.headers.get("accept-ranges") || "bytes");
  headers.delete("x-frame-options");
  headers.delete("content-security-policy");
  return new Response(upstream.body, { status: upstream.status, headers });
}

app.get("/api/problem-pdf", async (c) => {
  const problemId = c.req.query("id");
  if (!problemId) fail(400, "problem id is required");
  return serveProblemPdf(c, problemId);
});

app.get("/api/problems/:id/pdf", async (c) => {
  return serveProblemPdf(c, c.req.param("id"));
});

app.get("/api/problems/:id", async (c) => {
  const problem = await getProblem(c.env.DB, c.get("user"), c.req.param("id"));
  if (!problem) fail(404, "Problem not found");
  return c.json({ problem });
});

app.get("/api/problems/:id/workspace", async (c) => {
  const problemId = c.req.param("id");
  const user = c.get("user");
  const problem = await c.env.DB
    .prepare("SELECT status FROM problems WHERE id = ?")
    .bind(problemId)
    .first<{ status: string }>();
  if (!problem || (user.role === "member" && problem.status !== "reviewed")) fail(404, "Problem not found");

  const workspace = await c.env.DB
    .prepare(
      `SELECT strokes_json, revision, updated_at
       FROM problem_workspaces
       WHERE user_id = ? AND problem_id = ?`,
    )
    .bind(user.id, problemId)
    .first<{ strokes_json: string; revision: number; updated_at: string }>();

  return c.json({
    workspace: workspace
      ? {
          strokes: JSON.parse(workspace.strokes_json) as unknown[],
          revision: workspace.revision,
          updated_at: workspace.updated_at,
        }
      : null,
  });
});

app.put("/api/problems/:id/workspace", async (c) => {
  const problemId = c.req.param("id");
  const user = c.get("user");
  const body = await readJson<{ strokes: unknown[] }>(c.req.raw);
  if (!Array.isArray(body.strokes)) fail(400, "strokes must be an array");
  const strokesJson = JSON.stringify(body.strokes);
  if (new TextEncoder().encode(strokesJson).byteLength > 1_500_000) {
    fail(413, "Canvas data is too large");
  }

  const problem = await c.env.DB
    .prepare("SELECT status FROM problems WHERE id = ?")
    .bind(problemId)
    .first<{ status: string }>();
  if (!problem || (user.role === "member" && problem.status !== "reviewed")) fail(404, "Problem not found");

  const updatedAt = new Date().toISOString();
  await c.env.DB
    .prepare(
      `INSERT INTO problem_workspaces (user_id, problem_id, strokes_json, revision, updated_at)
       VALUES (?, ?, ?, 1, ?)
       ON CONFLICT(user_id, problem_id) DO UPDATE SET
         strokes_json = excluded.strokes_json,
         revision = problem_workspaces.revision + 1,
         updated_at = excluded.updated_at`,
    )
    .bind(user.id, problemId, strokesJson, updatedAt)
    .run();
  const saved = await c.env.DB
    .prepare("SELECT revision FROM problem_workspaces WHERE user_id = ? AND problem_id = ?")
    .bind(user.id, problemId)
    .first<{ revision: number }>();

  return c.json({ revision: saved?.revision ?? 1, updated_at: updatedAt });
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
  const limit = boundedIntegerParam(c.req.query("limit"), { defaultValue: 100, min: 1, max: 500 });
  const university = c.req.query("university");
  const where = university ? "WHERE university = ?" : "";
  const bind = university ? [university, limit] : [limit];
  const { results } = await c.env.DB
    .prepare(
      `SELECT id, source_type, title, university, graduate_school, department, exam_year, exam_category,
              source_url, file_hash, storage_path, access_scope, extraction_status, created_at
       FROM source_documents
       ${where}
       ORDER BY exam_year DESC, university ASC
       LIMIT ?`,
    )
    .bind(...bind)
    .all();
  return c.json({ sources: results });
});

app.get("/api/source-stats", async (c) => {
  const [total, byUniversity, byScope] = await Promise.all([
    c.env.DB.prepare("SELECT COUNT(*) AS count FROM source_documents").first<{ count: number }>(),
    c.env.DB
      .prepare("SELECT university, COUNT(*) AS count FROM source_documents GROUP BY university ORDER BY count DESC, university ASC")
      .all(),
    c.env.DB.prepare("SELECT access_scope, COUNT(*) AS count FROM source_documents GROUP BY access_scope ORDER BY count DESC").all(),
  ]);
  return c.json({
    total: total?.count ?? 0,
    byUniversity: byUniversity.results,
    byScope: byScope.results,
  });
});

app.post("/api/sources", async (c) => {
  const user = c.get("user");
  requireRole(user, "editor");
  const contentType = c.req.header("content-type") ?? "";
  const id = ulid("src");
  let source: {
    source_type: string;
    title: string;
    university: string;
    graduate_school?: string;
    department?: string;
    exam_year: number;
    exam_category?: string;
    source_url?: string;
    access_scope: string;
    file_hash: string;
    storage_path: string;
  };

  if (contentType.includes("multipart/form-data")) {
    const form = await c.req.raw.formData();
    const file = form.get("file");
    if (!(file instanceof File)) fail(400, "file is required");
    const buffer = await file.arrayBuffer();
    const fileHash = await sha256Hex(buffer);
    const existing = await c.env.DB.prepare("SELECT id FROM source_documents WHERE file_hash = ?").bind(fileHash).first();
    if (existing) fail(409, "SourceDocument with the same file_hash already exists");
    if (!c.env.SOURCE_ASSETS) fail(503, "Source asset uploads are not configured for this environment");
    const storagePath = `sources/${id}/${file.name}`;
    await c.env.SOURCE_ASSETS.put(storagePath, buffer, { httpMetadata: { contentType: file.type || "application/octet-stream" } });
    source = {
      source_type: String(form.get("source_type") ?? "official_pdf"),
      title: String(form.get("title") ?? file.name),
      university: String(form.get("university") ?? ""),
      graduate_school: String(form.get("graduate_school") ?? ""),
      department: String(form.get("department") ?? ""),
      exam_year: Number(form.get("exam_year")),
      exam_category: String(form.get("exam_category") ?? ""),
      source_url: String(form.get("source_url") ?? ""),
      access_scope: String(form.get("access_scope") ?? "internal_only"),
      file_hash: fileHash,
      storage_path: storagePath,
    };
  } else {
    const body = await readJson<typeof source>(c.req.raw);
    const existing = await c.env.DB.prepare("SELECT id FROM source_documents WHERE file_hash = ?").bind(body.file_hash).first();
    if (existing) fail(409, "SourceDocument with the same file_hash already exists");
    source = body;
  }

  if (!source.university || !source.exam_year) fail(400, "university and exam_year are required");
  await c.env.DB
    .prepare(
      `INSERT INTO source_documents (
        id, source_type, title, university, graduate_school, department, exam_year, exam_category,
        source_url, file_hash, storage_path, access_scope, extraction_status, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'uploaded', ?)`,
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
      source.source_url ?? null,
      source.file_hash,
      source.storage_path,
      source.access_scope,
      user.id,
    )
    .run();
  await auditLog(c.env.DB, user, "source.create", "source_document", id, undefined, source);
  return c.json({ id, file_hash: source.file_hash }, 201);
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
  const body = await readJson<AttemptInput>(c.req.raw);
  if (body.result === "not_checked") fail(400, "Result must be selected before saving an attempt");
  const problem = await c.env.DB
    .prepare("SELECT id, estimated_minutes FROM problems WHERE id = ? AND status = 'reviewed'")
    .bind(body.problem_id)
    .first<{ id: string; estimated_minutes: number }>();
  if (!problem) fail(404, "Reviewed problem not found");

  const id = ulid("att");
  const submittedAt = new Date().toISOString();
  const startedAt = body.started_at && Number.isFinite(Date.parse(body.started_at))
    ? new Date(body.started_at).toISOString()
    : submittedAt;
  const conceptRows = await c.env.DB
    .prepare(
      `SELECT c.id
       FROM knowledge_edges ke
       JOIN node_registry nr_problem ON nr_problem.node_id = ke.from_node_id
       JOIN node_registry nr_concept ON nr_concept.node_id = ke.to_node_id
       JOIN concepts c ON c.id = nr_concept.entity_id
       WHERE nr_problem.entity_type = 'problem'
         AND nr_concept.entity_type = 'concept'
         AND nr_problem.entity_id = ?
         AND ke.edge_type IN ('tests', 'requires')
         AND ke.status = 'approved'`,
    )
    .bind(problem.id)
    .all<{ id: string }>();

  const mistakeCounts = new Map<string, number>();
  for (const mistake of body.mistakes ?? []) {
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

  await c.env.DB.batch(statements);

  for (const row of conceptRows.results) {
    const previous = await c.env.DB
      .prepare("SELECT mastery_score, evidence_count FROM user_concept_states WHERE user_id = ? AND concept_id = ?")
      .bind(user.id, row.id)
      .first<{ mastery_score: number; evidence_count: number }>();
    const evidence = effectiveScore({
      result: body.result,
      scoreRate: body.score_rate,
      usedHint: Boolean(body.used_hint),
      lookedSolution: Boolean(body.looked_solution),
      timeSpentMinutes: body.time_spent_minutes,
      estimatedMinutes: problem.estimated_minutes,
      previousMastery: previous?.mastery_score,
      mistakePenaltyCount: mistakeCounts.get(row.id) ?? 0,
    });
    const mastery = nextMastery(previous?.mastery_score, evidence);
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
  }

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
  return c.json({ id, score_rate: score }, 201);
});

app.get("/api/recommendations", async (c) => {
  const mode = (c.req.query("mode") ?? "normal") as RecommendationMode;
  if (!["normal", "review", "foundation", "challenge"].includes(mode)) fail(400, "Unknown recommendation mode");
  const limit = boundedIntegerParam(c.req.query("limit"), { defaultValue: 20, min: 1, max: 100 });
  const recommendations = await listRecommendations(c.env.DB, c.get("user"), mode, limit);
  return c.json({ recommendations });
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
      const body = message.body as RecommendationQueueMessage;
      await buildRecommendations(env.DB, body.userId, "normal");
      await buildRecommendations(env.DB, body.userId, "review");
      await buildRecommendations(env.DB, body.userId, "foundation");
      await buildRecommendations(env.DB, body.userId, "challenge");
      message.ack();
    }
  },
} satisfies ExportedHandler<Env, RecommendationQueueMessage>;
