#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BATCH_DIR = path.join(ROOT, "data", "open-inshi", "agent-review", "batches");
const REVIEW_DIR = path.join(ROOT, "data", "open-inshi", "agent-review", "reviews");
const PDF_DIR = path.join(ROOT, "data", "open-inshi", "pdfs");
const ANSWER_FORMATS = new Set([
  "multiple_choice",
  "numeric",
  "short_text",
  "proof",
  "derivation",
  "programming",
  "essay",
  "mixed",
]);
const ENGLISH_CONCEPTS = /(英語|英文|和訳|英訳|読解|語彙|文法|essay|translation)/i;
const TECH_CONCEPTS = /(アルゴリズム|情報工学|人工知能|機械学習|AI|データ構造|信号処理)/i;

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function jsonFiles(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory).filter((name) => name.endsWith(".json")).sort();
}

function pdfPageCount(document) {
  const repositoryPath = new URL(document.source_url).pathname.split("/").slice(4).join("/");
  const pdfPath = path.join(PDF_DIR, repositoryPath);
  const output = execFileSync("pdfinfo", [pdfPath], { encoding: "utf8" });
  const match = output.match(/^Pages:\s+(\d+)$/m);
  if (!match) throw new Error(`Could not read page count: ${pdfPath}`);
  return Number(match[1]);
}

function addError(errors, file, message) {
  errors.push(`${file}: ${message}`);
}

const batches = jsonFiles(BATCH_DIR).map((name) => ({ name, value: readJson(path.join(BATCH_DIR, name)) }));
const reviews = new Map(
  jsonFiles(REVIEW_DIR).map((name) => [name.replace(/\.json$/, ""), { name, value: readJson(path.join(REVIEW_DIR, name)) }]),
);
const errors = [];
const warnings = [];
const seenProblemIds = new Set();
let expectedDocuments = 0;
let reviewedDocuments = 0;
let problemCount = 0;
let emptyDocuments = 0;

for (const batch of batches) {
  expectedDocuments += batch.value.documents.length;
  const stem = batch.name.replace(/\.json$/, "");
  const reviewEntry = reviews.get(stem);
  if (!reviewEntry) {
    addError(errors, batch.name, "review file is missing");
    continue;
  }
  const review = reviewEntry.value;
  if (review.batch_id !== batch.value.batch_id) addError(errors, reviewEntry.name, "batch_id does not match input");
  if (!Array.isArray(review.documents)) {
    addError(errors, reviewEntry.name, "documents must be an array");
    continue;
  }

  const expectedByKey = new Map(batch.value.documents.map((document) => [document.source_document_key, document]));
  const actualKeys = new Set();
  for (const document of review.documents) {
    reviewedDocuments += 1;
    const key = document.source_document_key;
    if (!expectedByKey.has(key)) {
      addError(errors, reviewEntry.name, `unexpected source_document_key ${key}`);
      continue;
    }
    if (actualKeys.has(key)) addError(errors, reviewEntry.name, `duplicate document ${key}`);
    actualKeys.add(key);
    const input = expectedByKey.get(key);
    if (document.source_url !== input.source_url) addError(errors, reviewEntry.name, `${key} source_url changed`);
    if (document.storage_path !== input.storage_path) addError(errors, reviewEntry.name, `${key} storage_path changed`);
    if (!Array.isArray(document.problems)) {
      addError(errors, reviewEntry.name, `${key} problems must be an array`);
      continue;
    }
    if (document.problems.length === 0) {
      emptyDocuments += 1;
      if (!Array.isArray(document.document_notes) || document.document_notes.length === 0) {
        warnings.push(`${reviewEntry.name}: ${key} has no problems and no explanation`);
      }
    }
    const pages = pdfPageCount(input);
    for (const [index, problem] of document.problems.entries()) {
      problemCount += 1;
      const label = `${key} problem ${index + 1}`;
      if (!problem.problem_id || seenProblemIds.has(problem.problem_id)) addError(errors, reviewEntry.name, `${label} problem_id is missing or duplicated`);
      seenProblemIds.add(problem.problem_id);
      if (!problem.problem_title?.trim()) addError(errors, reviewEntry.name, `${label} problem_title is empty`);
      if (!Array.isArray(problem.concepts) || problem.concepts.length === 0 || problem.concepts.some((item) => !String(item).trim())) {
        addError(errors, reviewEntry.name, `${label} concepts must be non-empty strings`);
      }
      if (!ANSWER_FORMATS.has(problem.answer_format)) addError(errors, reviewEntry.name, `${label} invalid answer_format ${problem.answer_format}`);
      if (!Number.isInteger(problem.difficulty) || problem.difficulty < 1 || problem.difficulty > 5) addError(errors, reviewEntry.name, `${label} difficulty must be 1-5`);
      if (typeof problem.confidence !== "number" || problem.confidence < 0 || problem.confidence > 1) addError(errors, reviewEntry.name, `${label} confidence must be 0-1`);
      if (!Array.isArray(problem.page_ranges) || problem.page_ranges.length === 0) {
        addError(errors, reviewEntry.name, `${label} page_ranges is empty`);
      } else {
        for (const range of problem.page_ranges) {
          if (!Number.isInteger(range.start_page) || !Number.isInteger(range.end_page) || range.start_page < 1 || range.end_page < range.start_page || range.end_page > pages) {
            addError(errors, reviewEntry.name, `${label} invalid page range ${JSON.stringify(range)} for ${pages}-page PDF`);
          }
        }
      }
      const concepts = problem.concepts?.join(" ") ?? "";
      if (ENGLISH_CONCEPTS.test(concepts) && TECH_CONCEPTS.test(concepts)) {
        warnings.push(`${reviewEntry.name}: ${label} mixes English-test and technical concepts: ${concepts}`);
      }
    }
  }
  for (const key of expectedByKey.keys()) {
    if (!actualKeys.has(key)) addError(errors, reviewEntry.name, `missing document ${key}`);
  }
  reviews.delete(stem);
}

for (const review of reviews.values()) warnings.push(`${review.name}: no matching input batch`);

const result = {
  batches: batches.length,
  expected_documents: expectedDocuments,
  reviewed_documents: reviewedDocuments,
  problems: problemCount,
  empty_documents: emptyDocuments,
  errors: errors.length,
  warnings: warnings.length,
};
console.log(JSON.stringify(result, null, 2));
for (const error of errors) console.error(`ERROR ${error}`);
for (const warning of warnings) console.error(`WARN ${warning}`);
process.exitCode = errors.length ? 1 : 0;
