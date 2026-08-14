import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import process from "node:process";

const SOURCE_REPOSITORY = "https://github.com/KTaisei/KnowledgeGraph";
const SOURCE_COMMIT = "4bb8bfe73e50aadf12d3e9f896e057b291c177ed";
const args = process.argv.slice(2);
const value = (name, fallback = "") => {
  const prefix = `--${name}=`;
  return args.find((arg) => arg.startsWith(prefix))?.slice(prefix.length) ?? fallback;
};
const has = (name) => args.includes(`--${name}`);

const inputPath = value("input", "tmp/knowledge-graph-upstream/output/knowledge_graph.json");
const subjectKey = value("subject");
const status = value("status", "draft");
const mappingPath = value("concept-map");
const createdBy = value("created-by", "usr_admin");
if (!subjectKey) throw new Error("--subject=<subject-key> is required");
if (!['draft', 'active'].includes(status)) throw new Error("--status must be draft or active");

const raw = readFileSync(inputPath, "utf8");
const payload = JSON.parse(raw);
if (!payload || !Array.isArray(payload.nodes) || !Array.isArray(payload.edges)) throw new Error("Invalid KnowledgeGraph payload");
if (payload.nodes.length === 0 || payload.nodes.length > 100) throw new Error("KnowledgeGraph nodes must contain 1..100 entries");
const model = value(
  "model",
  String(payload.meta?.generation_model ?? (String(payload.meta?.source ?? "").includes("Curated") ? "curated:manual-review" : "gemma4:latest")),
);

const hash = createHash("sha256").update(raw).digest("hex");
const graphId = `lgr_${hash.slice(0, 20)}`;
const sqlString = (input) => input == null ? "NULL" : `'${String(input).replaceAll("'", "''")}'`;
const clamp = (input, min, max, fallback) => {
  const numeric = Number(input);
  return Number.isFinite(numeric) ? Math.min(max, Math.max(min, numeric)) : fallback;
};
const normalizeType = (input) => ['FOUNDATIONAL', 'BASIC', 'CORE', 'APPLICATION'].includes(String(input).toUpperCase())
  ? String(input).toUpperCase() : 'CORE';
const safeId = (input, index) => String(input || `N${index}`).replace(/[^0-9A-Za-z_]+/g, "_").replace(/^_+|_+$/g, "") || `N${index}`;

const nodes = [];
const upstreamToLocal = new Map();
for (const [index, item] of payload.nodes.entries()) {
  if (!item || typeof item !== "object") continue;
  const upstreamId = safeId(item.node_id || item.label, index + 1);
  if (upstreamToLocal.has(upstreamId)) throw new Error(`Duplicate node_id: ${upstreamId}`);
  const id = `${graphId}_n_${String(index + 1).padStart(3, "0")}`;
  upstreamToLocal.set(upstreamId, id);
  nodes.push({
    id,
    upstreamId,
    label: String(item.label || upstreamId).trim(),
    type: normalizeType(item.type),
    layer: Math.trunc(clamp(item.layer, 0, 3, 0)),
    description: String(item.description || "").slice(0, 500),
    prerequisites: Array.isArray(item.prerequisites) ? item.prerequisites.map((entry) => safeId(entry, 0)) : [],
    sortIndex: index,
  });
}
if (nodes.length === 0) throw new Error("No valid nodes found");

const edgeMap = new Map();
function addEdge(sourceUpstream, targetUpstream, edge, inferredFrom) {
  const source = upstreamToLocal.get(safeId(sourceUpstream, 0));
  const target = upstreamToLocal.get(safeId(targetUpstream, 0));
  if (!source || !target || source === target) return;
  const key = `${source}->${target}`;
  const current = edgeMap.get(key);
  edgeMap.set(key, {
    source,
    target,
    relationship: String(edge.relationship || current?.relationship || "prerequisite").slice(0, 120),
    weight: Math.max(current?.weight ?? 0, clamp(edge.weight, 0, 1, inferredFrom === "prerequisites" ? 1 : 0.6)),
    description: String(edge.description || current?.description || "").slice(0, 500),
    inferredFrom: current && current.inferredFrom !== inferredFrom ? "both" : current?.inferredFrom ?? inferredFrom,
  });
}
for (const edge of payload.edges) addEdge(edge.source_id ?? edge.from, edge.target_id ?? edge.to, edge, "edge");
for (const node of nodes) for (const prerequisite of node.prerequisites) addEdge(prerequisite, node.upstreamId, {}, "prerequisites");
const edges = [...edgeMap.values()];

const indegree = new Map(nodes.map((node) => [node.id, 0]));
const outgoing = new Map(nodes.map((node) => [node.id, []]));
for (const edge of edges) {
  indegree.set(edge.target, (indegree.get(edge.target) ?? 0) + 1);
  outgoing.get(edge.source)?.push(edge.target);
}
const queue = nodes.filter((node) => indegree.get(node.id) === 0).map((node) => node.id);
let visited = 0;
while (queue.length) {
  const id = queue.shift();
  visited += 1;
  for (const target of outgoing.get(id) ?? []) {
    indegree.set(target, (indegree.get(target) ?? 1) - 1);
    if (indegree.get(target) === 0) queue.push(target);
  }
}
if (visited !== nodes.length) throw new Error("KnowledgeGraph contains a cycle and cannot be activated");

const rawMappings = mappingPath ? JSON.parse(readFileSync(mappingPath, "utf8")) : {};
const conceptIdsForNode = (node) => {
  const rawConceptIds = rawMappings[node.upstreamId] ?? rawMappings[node.label] ?? [];
  return (Array.isArray(rawConceptIds) ? rawConceptIds : [rawConceptIds])
    .map((conceptId) => String(conceptId).trim())
    .filter(Boolean);
};
const mappedConceptCount = nodes.reduce((count, node) => count + conceptIdsForNode(node).length, 0);
const warnings = [];
const unmappedNodes = nodes.filter((node) => conceptIdsForNode(node).length === 0);
if (status === "active" && mappedConceptCount === 0) {
  throw new Error("An active KnowledgeGraph requires at least one explicit concept mapping");
}
if (status === "active" && unmappedNodes.length > 0) {
  throw new Error(`An active KnowledgeGraph requires an explicit concept mapping for every node: ${unmappedNodes.map((node) => node.label).join(", ")}`);
}
if (unmappedNodes.length > 0) warnings.push(`Unmapped nodes: ${unmappedNodes.map((node) => node.upstreamId).join(", ")}`);
for (const node of nodes) {
  const hasDeclared = node.prerequisites.length;
  const edgeCount = edges.filter((edge) => edge.target === node.id).length;
  if (hasDeclared !== edgeCount) warnings.push(`${node.upstreamId}: prerequisites and edges were normalized`);
}

// Remote D1 SQL files reject explicit BEGIN/COMMIT statements. The import is
// idempotent (the graph ID is content-addressed and deleted before insertion),
// so retain a transaction for local SQLite while emitting D1-compatible SQL for
// production imports.
const remoteImport = has("apply-remote");
const lines = ["PRAGMA foreign_keys = ON;"];
if (!remoteImport) lines.push("BEGIN TRANSACTION;");
if (status === "active") lines.push(`UPDATE learning_graphs SET status = 'archived' WHERE subject_key = ${sqlString(subjectKey)} AND status = 'active';`);
lines.push(`DELETE FROM learning_graphs WHERE id = ${sqlString(graphId)};`);
lines.push(
  `INSERT INTO learning_graphs (id, topic, subject_key, source_repository, source_commit, source_model, payload_hash, status, warnings, generated_at, activated_at, created_by, reviewed_by) VALUES (`
  + [graphId, payload.topic || subjectKey, subjectKey, SOURCE_REPOSITORY, SOURCE_COMMIT, model, hash, status, JSON.stringify(warnings), payload.created_at || null, status === "active" ? new Date().toISOString() : null, createdBy, status === "active" ? createdBy : null].map(sqlString).join(", ") + ");",
);
for (const node of nodes) {
  lines.push(`INSERT INTO learning_graph_nodes (id, graph_id, upstream_node_id, label, node_type, layer, description, sort_index) VALUES (${[node.id, graphId, node.upstreamId, node.label, node.type].map(sqlString).join(", ")}, ${node.layer}, ${sqlString(node.description)}, ${node.sortIndex});`);
  for (const conceptId of conceptIdsForNode(node)) {
    lines.push(`INSERT INTO learning_graph_concept_links (graph_node_id, concept_id, confidence, status, reviewed_by) VALUES (${sqlString(node.id)}, ${sqlString(conceptId)}, 1.0, 'approved', ${sqlString(createdBy)});`);
  }
}
for (const edge of edges) lines.push(`INSERT INTO learning_graph_edges (graph_id, source_node_id, target_node_id, relationship, weight, description, inferred_from) VALUES (${sqlString(graphId)}, ${sqlString(edge.source)}, ${sqlString(edge.target)}, ${sqlString(edge.relationship)}, ${edge.weight}, ${sqlString(edge.description)}, ${sqlString(edge.inferredFrom)});`);
if (!remoteImport) lines.push("COMMIT;");
const sql = `${lines.join("\n")}\n`;

if (!has("apply-local") && !has("apply-remote")) {
  process.stdout.write(sql);
  process.stderr.write(`Validated ${nodes.length} nodes and ${edges.length} prerequisite edges (${warnings.length} warnings).\n`);
  process.exit(0);
}

const tempDir = mkdtempSync(path.join(os.tmpdir(), "graduate-kg-import-"));
const sqlPath = path.join(tempDir, "import.sql");
writeFileSync(sqlPath, sql, { mode: 0o600 });
try {
  const command = ["wrangler", "d1", "execute", "graduate_exam_db", has("apply-remote") ? "--remote" : "--local", `--file=${sqlPath}`];
  const config = value("config");
  if (config) command.push(`--config=${config}`);
  const result = spawnSync("npx", command, { stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
console.log(`Imported ${nodes.length} nodes and ${edges.length} edges as ${graphId}.`);
