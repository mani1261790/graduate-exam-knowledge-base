#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TARGETS_PATH = path.join(ROOT, "data", "crawler-targets.json");
const OUT_DIR = path.join(ROOT, "data", "crawl");
const PDF_DIR = path.join(OUT_DIR, "pdfs");
const RESULTS_PATH = path.join(OUT_DIR, "sources.json");
const SQL_PATH = path.join(OUT_DIR, "import_sources.sql");
const USER_AGENT = "Mozilla/5.0 (compatible; graduate-exam-knowledge-base-crawler/0.1; +https://noema-learn.uk)";
const MAX_PDF_BYTES = 40 * 1024 * 1024;
const GLOBAL_EXCLUDE = [
  "application",
  "answer",
  "answers",
  "template",
  "format",
  "form",
  "guideline",
  "pamphlet",
  "brochure",
  "kaitou",
  "syutsudai",
  "syutsudainoito",
  "shutsudai",
  "shutsudainoito",
  "purpose",
  "intent",
  "for-english",
  "koutoushimon",
  "oral",
  "interview",
  "解答",
  "回答",
  "出題の意図",
  "英語の勉強",
  "口頭試問",
  "募集要項",
  "入試案内",
  "案内書",
  "推薦書",
  "研究計画",
  "願書",
  "様式",
  "フォーマット",
  "説明会",
  "パンフレット",
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function parseArgs() {
  const args = new Set(process.argv.slice(2));
  return {
    download: !args.has("--metadata-only"),
    limit: Number([...args].find((arg) => arg.startsWith("--limit="))?.split("=")[1] ?? "120"),
  };
}

function normalizeUrl(href, baseUrl) {
  try {
    const url = new URL(href, baseUrl);
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function stripHtml(value) {
  return value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function extractLinks(html, baseUrl) {
  const links = [];
  const anchorPattern = /<a\b[^>]*href\s*=\s*["']?([^"'\s>]+)["']?[^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = anchorPattern.exec(html)) !== null) {
    const url = normalizeUrl(match[1], baseUrl);
    if (!url) continue;
    const contextStart = Math.max(0, match.index - 1600);
    const contextEnd = Math.min(html.length, match.index + match[0].length + 1600);
    links.push({
      url,
      label: stripHtml(match[2]),
      context: stripHtml(html.slice(contextStart, contextEnd)),
      rawHref: match[1],
    });
  }
  return links;
}

function includesAny(value, patterns) {
  if (!patterns || patterns.length === 0) return true;
  const lower = value.toLowerCase();
  return patterns.some((pattern) => lower.includes(String(pattern).toLowerCase()));
}

function excludesAny(value, patterns) {
  if (!patterns || patterns.length === 0) return false;
  const lower = value.toLowerCase();
  return patterns.some((pattern) => lower.includes(String(pattern).toLowerCase()));
}

function isPdfCandidate(link, target) {
  const url = new URL(link.url);
  if (!target.allowed_hosts.includes(url.host)) return false;
  const linkOnly = `${link.url} ${link.label}`;
  const includeSource = target.contextual_include ? `${linkOnly} ${link.context ?? ""}` : linkOnly;
  if (excludesAny(linkOnly, GLOBAL_EXCLUDE)) return false;
  if (excludesAny(linkOnly, target.exclude)) return false;
  const lowerUrl = link.url.toLowerCase();
  const pdfLike =
    lowerUrl.endsWith(".pdf") ||
    lowerUrl.includes(".pdf") ||
    (target.pdf_like_patterns ?? []).some((pattern) => lowerUrl.includes(String(pattern).toLowerCase()));
  return pdfLike && includesAny(includeSource, target.include);
}

function inferExamYear(text) {
  const academic = text.match(/(?:ay|年度|fy|r)((?:19|20)[0-9]{2}|[0-9]{2})(?![0-9])/i);
  if (academic) {
    const value = Number(academic[1]);
    return value < 100 ? 2000 + value : value;
  }

  const western = text.match(/(?:19|20)[0-9]{2}/);
  if (western) return Number(western[0]);

  const reiwa = text.match(/令和\s*([0-9０-９]+)\s*年度?/);
  if (reiwa) return 2018 + toHalfWidthNumber(reiwa[1]);

  const heisei = text.match(/平成\s*([0-9０-９]+)\s*年度?/);
  if (heisei) return 1988 + toHalfWidthNumber(heisei[1]);

  const compactReiwa = text.match(/R\s*([0-9]+)/i);
  if (compactReiwa) return 2018 + Number(compactReiwa[1]);

  return new Date().getFullYear();
}

function inferTargetExamYear(link, target) {
  if (target.prefer_label_exam_year) {
    return inferExamYear(link.label || link.rawHref || "");
  }
  return inferExamYear(`${link.label} ${link.url}`);
}

function toHalfWidthNumber(value) {
  return Number(
    value.replace(/[０-９]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0)),
  );
}

function inferExamCategory(text) {
  if (/博士|doctor/i.test(text)) return "博士";
  if (/修士|master/i.test(text)) return "修士";
  if (/夏|summer/i.test(text)) return "夏入試";
  if (/冬|winter/i.test(text)) return "冬入試";
  return "一般入試";
}

function slug(value) {
  return value
    .toLowerCase()
    .replace(/https?:\/\//g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

function sqlString(value) {
  if (value === null || value === undefined || value === "") return "NULL";
  return `'${String(value).replace(/'/g, "''")}'`;
}

function sourceId(record, fileHash, url) {
  return `src_${record.target_id.replace(/[^a-z0-9_]/gi, "_")}_${fileHash.slice(0, 12) || slug(url).slice(0, 12)}`;
}

function curlFetch(url, { accept, insecure = false } = {}) {
  const args = [
    "--location",
    "--fail",
    "--silent",
    "--show-error",
    "--max-time",
    "60",
    "--user-agent",
    USER_AGENT,
    "--header",
    `accept: ${accept ?? "*/*"}`,
  ];
  if (insecure) args.push("--insecure");
  args.push(url);
  const result = spawnSync("curl", args, { encoding: "buffer", maxBuffer: MAX_PDF_BYTES + 1024 * 1024 });
  if (result.status !== 0) {
    const stderr = result.stderr?.toString("utf8").trim();
    throw new Error(stderr || `curl exited with status ${result.status}`);
  }
  return result.stdout;
}

async function fetchText(url, target) {
  try {
    const response = await fetch(url, {
      headers: {
        "user-agent": USER_AGENT,
        accept: "text/html,application/xhtml+xml",
      },
    });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    return response.text();
  } catch (error) {
    if (!target?.curl_fallback && !target?.allow_insecure_tls) throw error;
    return curlFetch(url, {
      accept: "text/html,application/xhtml+xml",
      insecure: Boolean(target?.allow_insecure_tls),
    }).toString("utf8");
  }
}

async function fetchPdf(url, target) {
  try {
    const response = await fetch(url, {
      headers: {
        "user-agent": USER_AGENT,
        accept: "application/pdf,*/*;q=0.5",
      },
    });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    const contentLength = Number(response.headers.get("content-length") ?? "0");
    if (contentLength > MAX_PDF_BYTES) {
      throw new Error(`PDF is too large: ${contentLength} bytes`);
    }
    const arrayBuffer = await response.arrayBuffer();
    if (arrayBuffer.byteLength > MAX_PDF_BYTES) {
      throw new Error(`PDF is too large: ${arrayBuffer.byteLength} bytes`);
    }
    return Buffer.from(arrayBuffer);
  } catch (error) {
    if (!target?.curl_fallback && !target?.allow_insecure_tls) throw error;
    const pdf = curlFetch(url, {
      accept: "application/pdf,*/*;q=0.5",
      insecure: Boolean(target?.allow_insecure_tls),
    });
    if (pdf.byteLength > MAX_PDF_BYTES) throw new Error(`PDF is too large: ${pdf.byteLength} bytes`);
    return pdf;
  }
}

async function crawlTarget(target, options) {
  const html = await fetchText(target.page_url, target);
  const links = extractLinks(html, target.page_url).filter((link) => isPdfCandidate(link, target));
  const unique = new Map();
  for (const link of links) unique.set(link.url, link);
  const candidates = [...unique.values()].slice(0, options.limit);
  const records = [];

  for (const link of candidates) {
    const joined = `${link.label} ${link.url}`;
    const examYear = inferTargetExamYear(link, target);
    const record = {
      target_id: target.id,
      source_type: target.source_type,
      title: `${target.university} ${target.graduate_school ?? ""} ${examYear}年度 ${target.default_subject} ${link.label || path.basename(new URL(link.url).pathname)}`.replace(/\s+/g, " ").trim(),
      university: target.university,
      graduate_school: target.graduate_school,
      department: target.department,
      exam_year: examYear,
      exam_category: inferExamCategory(joined),
      source_url: link.url,
      source_page_url: target.page_url,
      access_scope: target.access_scope,
      extraction_status: "uploaded",
      password_required: Boolean(target.password_required),
      downloaded: false,
      file_hash: null,
      storage_path: `crawl/pdfs/${target.id}/${slug(link.url)}.pdf`,
      mime_type: "application/pdf",
      error: null,
    };

    if (!target.password_required && options.download) {
      try {
        const pdf = await fetchPdf(link.url, target);
        const hash = createHash("sha256").update(pdf).digest("hex");
        const relativePath = `crawl/pdfs/${target.id}/${hash.slice(0, 16)}-${slug(path.basename(new URL(link.url).pathname) || link.url)}.pdf`;
        const absolutePath = path.join(ROOT, "data", relativePath);
        await mkdir(path.dirname(absolutePath), { recursive: true });
        await writeFile(absolutePath, pdf);
        record.downloaded = true;
        record.file_hash = hash;
        record.storage_path = relativePath;
      } catch (error) {
        record.error = error instanceof Error ? error.message : String(error);
      }
      await sleep(350);
    }

    if (!record.file_hash) {
      record.file_hash = createHash("sha256").update(link.url).digest("hex");
    }
    records.push(record);
  }

  return records;
}

function buildSql(records) {
  const lines = [
    "-- Generated by scripts/crawl-official-sources.mjs",
    "INSERT OR IGNORE INTO users (id, display_name, email, role, status) VALUES ('usr_crawler', '公式PDF crawler', 'crawler@internal.local', 'editor', 'active');",
  ];
  for (const record of records) {
    const id = sourceId(record, record.file_hash, record.source_url);
    lines.push(
      `INSERT OR IGNORE INTO source_documents (` +
        `id, source_type, title, university, graduate_school, department, exam_year, exam_category, source_url, file_hash, storage_path, access_scope, extraction_status, created_by` +
        `) VALUES (` +
        [
          sqlString(id),
          sqlString(record.source_type),
          sqlString(record.title),
          sqlString(record.university),
          sqlString(record.graduate_school),
          sqlString(record.department),
          record.exam_year,
          sqlString(record.exam_category),
          sqlString(record.source_url),
          sqlString(record.file_hash),
          sqlString(record.storage_path),
          sqlString(record.access_scope),
          sqlString(record.extraction_status),
          sqlString("usr_crawler"),
        ].join(", ") +
        `);`,
    );
  }
  return `${lines.join("\n")}\n`;
}

async function main() {
  const options = parseArgs();
  await mkdir(PDF_DIR, { recursive: true });
  const targets = JSON.parse(await readFile(TARGETS_PATH, "utf8"));
  const recordMap = new Map();
  for (const target of targets) {
    console.log(`Crawling ${target.id}: ${target.page_url}`);
    try {
      const records = await crawlTarget(target, options);
      for (const record of records) {
        recordMap.set(`${record.target_id}:${record.file_hash || record.source_url}`, record);
      }
      console.log(`  found ${records.length} PDF candidate(s)`);
    } catch (error) {
      console.error(`  failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const allRecords = [...recordMap.values()];
  await writeFile(RESULTS_PATH, `${JSON.stringify(allRecords, null, 2)}\n`);
  await writeFile(SQL_PATH, buildSql(allRecords));
  console.log(`Wrote ${allRecords.length} records to ${RESULTS_PATH}`);
  console.log(`Wrote SQL import to ${SQL_PATH}`);
}

await main();
