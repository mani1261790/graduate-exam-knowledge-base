#!/usr/bin/env node
import { createHash } from "node:crypto";
import { cp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = new Map(process.argv.slice(2).map((arg) => {
  const [key, ...rest] = arg.split("=");
  return [key, rest.join("=")];
}));
const sourceRoot = path.resolve(ROOT, args.get("--source") || "tmp/open-inshi-upstream/open_inshi-master");
const commit = args.get("--commit") || "19cd891d761108052f38a2f50929cadc158aba2a";
const outputRoot = path.join(ROOT, "data", "open-inshi");
const pdfOutputRoot = path.join(outputRoot, "pdfs");
const manifestPath = path.join(outputRoot, "sources.json");
const sqlPath = path.join(outputRoot, "import_sources.sql");
const crawlManifestPath = path.join(ROOT, "data", "crawl", "sources.json");

const UNIVERSITY_NAMES = {
  hitotsubashi_university: "一橋大学",
  hokkaido_university: "北海道大学",
  keio_university: "慶應義塾大学",
  kyoto_university: "京都大学",
  osaka_university: "大阪大学",
  the_university_of_tokyo: "東京大学",
  tokyo_institute_of_technology: "東京工業大学（現・東京科学大学）",
  university_of_tsukuba: "筑波大学",
  waseda_university: "早稲田大学",
};

const GRADUATE_SCHOOL_NAMES = {
  graduate_school_of_arts_and_sciences: "大学院総合文化研究科",
  graduate_school_of_economics: "大学院経済学研究科",
  graduate_school_of_economics_and_business: "大学院経済学研究科",
  graduate_school_of_engineering: "大学院工学系研究科",
  graduate_school_of_fundamental_science_and_engineering: "大学院基幹理工学研究科",
  graduate_school_of_informatics: "大学院情報学研究科",
  graduate_school_of_information_science_and_engineering: "大学院情報理工学院",
  graduate_school_of_information_science_and_technology: "大学院情報理工学系研究科",
  graduate_school_of_interdisciplinary_information_studies: "大学院学際情報学府",
  graduate_school_of_science_and_technology: "大学院システム情報工学研究科",
};

const DEPARTMENT_NAMES = {
  applied_computer_science_course: "総合分析情報学コース",
  computer_science: "コンピュータ科学専攻",
  creative_informatics: "創造情報学専攻",
  department_of_applied_mathematics_and_physics: "数理工学専攻",
  department_of_communications_and_computer_engineering: "情報理工・情報通信専攻",
  department_of_communications_and_information_engineering: "通信情報システム専攻",
  department_of_computer_science: "情報工学系",
  department_of_general_systems_studies: "広域科学専攻相関基礎科学系",
  department_of_information_and_physical_sciences: "情報基礎数学専攻",
  department_of_intelligence_science_and_technology: "知能情報学専攻",
  department_of_mathematical_and_computing_science: "数理・計算科学系",
  department_of_pure_and_applied_mathematics: "情報数理学専攻",
  eeis: "電気系工学専攻",
  information_and_communication_engineering: "電子情報学専攻",
  math: "一般教育科目（数学）",
  mathematical_informatics: "数理情報学専攻",
  others: "情報系専門科目",
};

const SESSION_NAMES = {
  s: "夏・春・通常入試",
  w: "冬入試",
  f: "秋入試",
  r1: "第1回入試",
  r2: "第2回入試",
};

const TOKEN_NAMES = {
  en: "英語版",
  ja: "日本語版",
  info: "情報系",
  math: "数学",
  program: "プログラミング",
  specialized: "専門科目",
  economics: "経済学",
  report: "レポート",
};

function graduateSchoolName(universityKey, graduateSchoolKey) {
  if (graduateSchoolKey === "graduate_school_of_information_science_and_technology" && universityKey === "osaka_university") {
    return "大学院情報科学研究科";
  }
  return GRADUATE_SCHOOL_NAMES[graduateSchoolKey];
}

function departmentName(universityKey, departmentKey) {
  if (!departmentKey) return null;
  if (departmentKey === "department_of_computer_science" && universityKey === "university_of_tsukuba") {
    return "コンピュータサイエンス専攻";
  }
  if (departmentKey === "department_of_pure_and_applied_mathematics" && universityKey === "waseda_university") {
    return "数学応用数理専攻";
  }
  return DEPARTMENT_NAMES[departmentKey] || departmentKey;
}

function sqlString(value) {
  if (value === null || value === undefined || value === "") return "NULL";
  return `'${String(value).replaceAll("'", "''")}'`;
}

function rawUrl(relativePath) {
  return `https://raw.githubusercontent.com/diohabara/open_inshi/${commit}/${relativePath.split("/").map(encodeURIComponent).join("/")}`;
}

function crawlSourceId(record) {
  const prefix = String(record.target_id).replace(/[^a-zA-Z0-9_]/g, "_");
  return `src_${prefix}_${String(record.file_hash).slice(0, 12)}`;
}

async function listPdfs(directory, prefix = "") {
  const found = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) found.push(...await listPdfs(absolute, relative));
    else if (entry.isFile() && entry.name.toLowerCase().endsWith(".pdf")) found.push(relative);
  }
  return found;
}

function parseFilename(filename) {
  const tokens = filename.replace(/\.pdf$/i, "").split("_");
  const yearMatch = tokens.shift()?.match(/^fy(\d{4})$/);
  if (!yearMatch) throw new Error(`Invalid open_inshi filename: ${filename}`);
  const sessionToken = SESSION_NAMES[tokens[0]] ? tokens.shift() : null;
  return {
    examYear: Number(yearMatch[1]),
    examCategory: sessionToken ? SESSION_NAMES[sessionToken] : "実施回不明",
    details: tokens.map((token) => TOKEN_NAMES[token] || token.toUpperCase()),
  };
}

async function main() {
  const existingRecords = JSON.parse(await readFile(crawlManifestPath, "utf8"));
  const existingByHash = new Map(existingRecords.filter((record) => record.file_hash).map((record) => [record.file_hash, record]));
  const paths = (await listPdfs(sourceRoot)).sort();
  const records = [];
  const seenHashes = new Set();
  let duplicateExisting = 0;
  let duplicateArchive = 0;
  let totalBytes = 0;

  await mkdir(pdfOutputRoot, { recursive: true });
  for (const relativePath of paths) {
    const sourcePath = path.join(sourceRoot, relativePath);
    const bytes = await readFile(sourcePath);
    if (bytes.subarray(0, 5).toString("ascii") !== "%PDF-") throw new Error(`Invalid PDF signature: ${relativePath}`);
    const fileHash = createHash("sha256").update(bytes).digest("hex");
    totalBytes += bytes.length;
    if (seenHashes.has(fileHash)) duplicateArchive += 1;
    seenHashes.add(fileHash);

    const parts = relativePath.split("/");
    const filename = parts.at(-1);
    const universityKey = parts[0];
    const university = UNIVERSITY_NAMES[universityKey];
    const graduateSchool = graduateSchoolName(universityKey, parts[1]);
    const department = departmentName(universityKey, parts.length > 3 ? parts[2] : null);
    if (!university || !graduateSchool || !filename) throw new Error(`Unknown academic path: ${relativePath}`);
    const parsed = parseFilename(filename);
    const archivePath = `open-inshi/pdfs/${relativePath}`;
    const outputPath = path.join(ROOT, "data", archivePath);
    await mkdir(path.dirname(outputPath), { recursive: true });
    await cp(sourcePath, outputPath);

    const existing = existingByHash.get(fileHash);
    if (existing) duplicateExisting += 1;
    records.push({
      source_type: "official_pdf",
      title: [university, graduateSchool, department, `${parsed.examYear}年度`, parsed.examCategory, ...parsed.details].filter(Boolean).join(" "),
      university,
      graduate_school: graduateSchool,
      department,
      exam_year: parsed.examYear,
      exam_category: parsed.examCategory,
      source_url: rawUrl(relativePath),
      source_repository: "https://github.com/diohabara/open_inshi",
      source_commit: commit,
      source_repository_path: relativePath,
      access_scope: "internal_only",
      extraction_status: "uploaded",
      downloaded: true,
      file_hash: fileHash,
      source_document_id: existing ? crawlSourceId(existing) : `src_open_inshi_${fileHash.slice(0, 20)}`,
      storage_path: existing?.storage_path || archivePath,
      archive_path: archivePath,
      duplicate_existing: Boolean(existing),
      mime_type: "application/pdf",
      byte_size: bytes.length,
    });
  }

  const lines = [
    "-- Generated by scripts/import-open-inshi.mjs",
    "-- Source: https://github.com/diohabara/open_inshi",
    `-- Commit: ${commit}`,
    "INSERT OR IGNORE INTO users (id, display_name, email, role, status) VALUES ('usr_open_inshi', 'open_inshi importer', 'open-inshi@internal.local', 'editor', 'active');",
  ];
  for (const record of records) {
    if (record.duplicate_existing) continue;
    const id = record.source_document_id;
    lines.push(
      `INSERT OR IGNORE INTO source_documents (` +
        `id, source_type, title, university, graduate_school, department, exam_year, exam_category, source_url, file_hash, storage_path, access_scope, extraction_status, created_by` +
      `) VALUES (` + [
        sqlString(id), sqlString(record.source_type), sqlString(record.title), sqlString(record.university),
        sqlString(record.graduate_school), sqlString(record.department), record.exam_year, sqlString(record.exam_category),
        sqlString(record.source_url), sqlString(record.file_hash), sqlString(record.storage_path), sqlString(record.access_scope),
        sqlString(record.extraction_status), sqlString("usr_open_inshi"),
      ].join(", ") + `);`,
    );
  }

  await mkdir(outputRoot, { recursive: true });
  await writeFile(manifestPath, `${JSON.stringify(records, null, 2)}\n`);
  await writeFile(sqlPath, `${lines.join("\n")}\n`);
  console.log(JSON.stringify({
    source: "diohabara/open_inshi", commit, pdfs: records.length, unique_hashes: seenHashes.size,
    duplicate_archive: duplicateArchive, duplicate_existing: duplicateExisting,
    new_source_documents: records.length - duplicateExisting, total_bytes: totalBytes,
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
