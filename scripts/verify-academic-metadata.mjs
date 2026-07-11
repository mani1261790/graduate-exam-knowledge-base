#!/usr/bin/env node
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOURCES_PATHS = [
  path.join(ROOT, "data", "crawl", "sources.json"),
  path.join(ROOT, "data", "open-inshi", "sources.json"),
];
const REVIEWS_DIR = path.join(ROOT, "data", "agent-review", "reviews");

const KNOWN_UNIVERSITIES = new Set([
  "東京大学",
  "大阪大学",
  "北海道大学",
  "京都大学",
  "Science Tokyo",
  "電気通信大学",
  "九州工業大学",
  "静岡大学",
  "名古屋工業大学",
  "大阪工業大学",
  "立命館大学",
  "関西学院大学",
  "放送大学",
  "名古屋大学",
  "筑波大学",
  "東北大学",
  "一橋大学",
  "慶應義塾大学",
  "早稲田大学",
  "東京工業大学（現・東京科学大学）",
]);

const GRADUATE_SCHOOL_SUFFIX = /(研究科|科学院|研究院|学府|学院|学術院|研究群)$/;
const DEPARTMENT_SUFFIX = /(専攻|コース|プログラム|系)$/;

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function compactRecord(record) {
  return {
    source_document_key: record.source_document_key,
    target_id: record.target_id,
    title: record.title,
    university: record.university,
    graduate_school: record.graduate_school,
    department: record.department,
    source_url: record.source_url,
  };
}

function validateAcademicFields(record, location, errors) {
  const university = String(record.university ?? "").trim();
  const graduateSchool = String(record.graduate_school ?? "").trim();
  const department = record.department == null ? "" : String(record.department).trim();

  if (!university) {
    errors.push({ location, error: "university is required", record: compactRecord(record) });
  } else if (!KNOWN_UNIVERSITIES.has(university)) {
    errors.push({ location, error: "university is not in known university catalog", record: compactRecord(record) });
  }

  if (!graduateSchool) {
    errors.push({ location, error: "graduate_school is required", record: compactRecord(record) });
  } else if (!GRADUATE_SCHOOL_SUFFIX.test(graduateSchool)) {
    errors.push({ location, error: "graduate_school does not look like a graduate school name", record: compactRecord(record) });
  }

  if (university && graduateSchool && university === graduateSchool) {
    errors.push({ location, error: "university and graduate_school are identical", record: compactRecord(record) });
  }

  if (department && GRADUATE_SCHOOL_SUFFIX.test(department) && !DEPARTMENT_SUFFIX.test(department)) {
    errors.push({ location, error: "department appears to contain a graduate school name", record: compactRecord(record) });
  }
}

const errors = [];
const sources = SOURCES_PATHS.flatMap((sourcePath) => {
  try {
    return readJson(sourcePath).map((source) => ({ source, sourcePath: path.relative(ROOT, sourcePath) }));
  } catch (error) {
    if (sourcePath.includes("open-inshi")) return [];
    throw error;
  }
});

for (const [index, item] of sources.entries()) {
  validateAcademicFields(item.source, `${item.sourcePath}[${index}]`, errors);
}

for (const fileName of readdirSync(REVIEWS_DIR).filter((name) => name.endsWith(".json")).sort()) {
  const review = readJson(path.join(REVIEWS_DIR, fileName));
  for (const [index, document] of (review.documents ?? []).entries()) {
    const hasAcademicFields =
      document.university !== undefined || document.graduate_school !== undefined || document.department !== undefined;
    if (hasAcademicFields) validateAcademicFields(document, `data/agent-review/reviews/${fileName}.documents[${index}]`, errors);
  }
}

if (errors.length > 0) {
  console.error(JSON.stringify({ ok: false, errors }, null, 2));
  process.exit(1);
}

console.log(
  JSON.stringify(
    {
      ok: true,
      source_records: sources.length,
      source_documents: new Set(sources.map(({ source }) => source.file_hash)).size,
      review_files: readdirSync(REVIEWS_DIR).filter((name) => name.endsWith(".json")).length,
    },
    null,
    2,
  ),
);
