#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_SOURCE = path.join(ROOT, "data", "crawl", "sources.json");
const DEFAULT_OUT_DIR = path.join(ROOT, "data", "agent-review", "batches");
const DEFAULT_BATCH_SIZE = 20;

const REVIEW_INSTRUCTIONS = [
  "Review each official PDF and split it into individual exam problems.",
  "Return JSON only, following data/agent-review/README.md.",
  "For every problem, include page_ranges, problem_title, concepts, answer_format, difficulty, and confidence.",
  "Use 1-based inclusive page numbers. If a boundary is uncertain, choose the narrowest likely range and lower confidence.",
  "Do not transcribe copyrighted problem text; summarize titles and concepts in your own words.",
];

function parseArgs(argv) {
  const options = {
    source: DEFAULT_SOURCE,
    outDir: DEFAULT_OUT_DIR,
    batchSize: DEFAULT_BATCH_SIZE,
    prefix: "agent-review-batch",
    limit: null,
    dryRun: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => {
      index += 1;
      if (index >= argv.length || argv[index].startsWith("--")) {
        throw new Error(`${arg} requires a value`);
      }
      return argv[index];
    };

    if (arg === "--source") {
      options.source = path.resolve(ROOT, next());
    } else if (arg === "--out-dir") {
      options.outDir = path.resolve(ROOT, next());
    } else if (arg === "--batch-size") {
      options.batchSize = parsePositiveInteger(next(), "--batch-size");
    } else if (arg === "--prefix") {
      options.prefix = next();
    } else if (arg === "--limit") {
      options.limit = parsePositiveInteger(next(), "--limit");
    } else if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

function parsePositiveInteger(value, label) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0 || String(parsed) !== String(value)) {
    throw new Error(`${label} must be a positive integer`);
  }
  return parsed;
}

function printHelp() {
  console.log(`Usage: node scripts/build-agent-review-batches.mjs [options]

Options:
  --source <path>       Input crawl source JSON. Default: data/crawl/sources.json
  --out-dir <path>      Output directory. Default: data/agent-review/batches
  --batch-size <n>      Documents per batch. Default: ${DEFAULT_BATCH_SIZE}
  --prefix <name>       Output file prefix. Default: agent-review-batch
  --limit <n>           Emit only the first n reviewable documents.
  --dry-run             Print the plan without writing files.
  -h, --help            Show this help.
`);
}

function readSources(sourcePath) {
  const raw = fs.readFileSync(sourcePath, "utf8");
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error(`${sourcePath} must contain a JSON array`);
  }
  return parsed;
}

function isReviewableOfficialPdf(source) {
  if (source?.source_type !== "official_pdf") return false;
  if (!source.source_url || typeof source.source_url !== "string") return false;

  const url = source.source_url.toLowerCase();
  return source.mime_type === "application/pdf" || url.includes(".pdf") || Boolean(source.storage_path);
}

function sourceDocumentKey(source) {
  if (source.document_key) return source.document_key;
  if (source.source_document_key) return source.source_document_key;
  if (source.file_hash && source.target_id) return `${source.target_id}:${source.file_hash.slice(0, 16)}`;
  if (source.file_hash) return `sha256:${source.file_hash.slice(0, 16)}`;
  if (source.target_id && source.exam_year && source.title) {
    return `${source.target_id}:${source.exam_year}:${slugify(source.title).slice(0, 48)}`;
  }
  return null;
}

function slugify(value) {
  return String(value)
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function toReviewDocument(source, index) {
  return {
    source_document_key: sourceDocumentKey(source),
    source_index: index,
    target_id: source.target_id ?? null,
    university: source.university ?? null,
    graduate_school: source.graduate_school ?? null,
    department: source.department ?? null,
    exam_year: source.exam_year ?? null,
    exam_category: source.exam_category ?? null,
    title: source.title ?? null,
    subject: inferSubject(source),
    source_url: source.source_url,
    source_page_url: source.source_page_url ?? null,
    storage_path: source.storage_path ?? null,
    access_scope: source.access_scope ?? null,
    password_required: source.password_required ?? null,
    file_hash: source.file_hash ?? null,
    reviewer_return_fields: [
      "page_ranges",
      "problem_title",
      "concepts",
      "answer_format",
      "difficulty",
      "confidence",
    ],
    notes: [],
  };
}

function inferSubject(source) {
  const title = source.title;
  if (typeof title !== "string") return null;

  const subjectPatterns = [
    /(?:一般教育科目|専門科目|科目|subject)[（(]([^）)]+)[）)]/i,
    /(?:^|[\s/])(?:math|mathematics|数学)(?:$|[\s/])/i,
    /(?:^|[\s/])(?:english|英語)(?:$|[\s/])/i,
    /(?:^|[\s/])(?:physics|物理)(?:$|[\s/])/i,
    /(?:^|[\s/])(?:chemistry|化学)(?:$|[\s/])/i,
  ];

  const bracketMatch = title.match(subjectPatterns[0]);
  if (bracketMatch) return bracketMatch[1];
  if (subjectPatterns[1].test(title)) return "数学";
  if (subjectPatterns[2].test(title)) return "英語";
  if (subjectPatterns[3].test(title)) return "物理";
  if (subjectPatterns[4].test(title)) return "化学";
  return null;
}

function chunk(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function batchPayload(documents, batchIndex, totalBatches, sourcePath) {
  return {
    batch_id: `agent-review-${String(batchIndex + 1).padStart(3, "0")}`,
    batch_index: batchIndex + 1,
    total_batches: totalBatches,
    generated_at: new Date().toISOString(),
    source_file: path.relative(ROOT, sourcePath),
    instructions: REVIEW_INSTRUCTIONS,
    expected_output_schema: "data/agent-review/README.md",
    documents,
  };
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const sources = readSources(options.source);
  const documents = sources
    .map((source, index) => ({ source, index }))
    .filter(({ source }) => isReviewableOfficialPdf(source))
    .map(({ source, index }) => toReviewDocument(source, index));

  const selectedDocuments = options.limit ? documents.slice(0, options.limit) : documents;
  const batches = chunk(selectedDocuments, options.batchSize);

  if (options.dryRun) {
    console.log(
      JSON.stringify(
        {
          source_file: path.relative(ROOT, options.source),
          output_directory: path.relative(ROOT, options.outDir),
          reviewable_documents: documents.length,
          selected_documents: selectedDocuments.length,
          batch_size: options.batchSize,
          batches: batches.length,
        },
        null,
        2,
      ),
    );
    return;
  }

  fs.mkdirSync(options.outDir, { recursive: true });
  for (const [index, documentsInBatch] of batches.entries()) {
    const name = `${options.prefix}-${String(index + 1).padStart(3, "0")}.json`;
    writeJson(path.join(options.outDir, name), batchPayload(documentsInBatch, index, batches.length, options.source));
  }

  console.log(`Wrote ${batches.length} batch file(s) for ${selectedDocuments.length} document(s) to ${path.relative(ROOT, options.outDir)}`);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
