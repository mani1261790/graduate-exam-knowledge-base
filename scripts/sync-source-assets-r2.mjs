#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOURCES_PATHS = [
  path.join(ROOT, "data", "crawl", "sources.json"),
  path.join(ROOT, "data", "open-inshi", "sources.json"),
];
const STATE_DIR = path.join(ROOT, "tmp", "r2-sync");
const STATE_PATH = path.join(STATE_DIR, "uploaded.json");
const bucket = process.env.R2_BUCKET || "graduate-exam-assets";
const config = process.env.WRANGLER_CONFIG || "wrangler.production.jsonc";
const concurrency = Math.max(1, Number(process.env.R2_SYNC_CONCURRENCY || "4"));
const dryRun = process.argv.includes("--dry-run");
const recoverMissing = process.argv.includes("--recover-missing");
const applyRemote = process.argv.includes("--apply-remote");

function sqlString(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(stderr.trim() || stdout.trim() || `${command} exited with ${code}`));
    });
  });
}

async function sha256(filePath) {
  const buffer = await readFile(filePath);
  return createHash("sha256").update(buffer).digest("hex");
}

async function loadState() {
  try {
    const parsed = JSON.parse(await readFile(STATE_PATH, "utf8"));
    return new Set(Array.isArray(parsed) ? parsed : []);
  } catch {
    return new Set();
  }
}

async function main() {
  const records = [];
  for (const sourcePath of SOURCES_PATHS) {
    try {
      records.push(...JSON.parse(await readFile(sourcePath, "utf8")));
    } catch (error) {
      if (!sourcePath.includes("open-inshi")) throw error;
    }
  }
  if (recoverMissing) {
    const missingRecords = [];
    for (const record of records) {
      if (!record.storage_path) continue;
      try {
        await stat(path.join(ROOT, "data", record.storage_path));
      } catch {
        missingRecords.push(record);
      }
    }

    const recovered = [];
    const unavailable = [];
    let recoveryIndex = 0;
    async function recoveryWorker() {
      while (recoveryIndex < missingRecords.length) {
        const record = missingRecords[recoveryIndex++];
        try {
          const response = await fetch(record.source_url, {
            redirect: "follow",
            headers: {
              accept: "application/pdf,*/*;q=0.5",
              "user-agent": "graduate-exam-knowledge-base/0.1",
            },
          });
          if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
          const buffer = Buffer.from(await response.arrayBuffer());
          if (buffer.subarray(0, 5).toString("ascii") !== "%PDF-") throw new Error("invalid PDF signature");
          const filePath = path.join(ROOT, "data", record.storage_path);
          await mkdir(path.dirname(filePath), { recursive: true });
          await writeFile(filePath, buffer);
          record.file_hash = createHash("sha256").update(buffer).digest("hex");
          record.downloaded = true;
          record.error = null;
          recovered.push(record);
          console.log(`Recovered ${record.storage_path} (${buffer.length} bytes)`);
        } catch (error) {
          unavailable.push({ source_url: record.source_url, error: error instanceof Error ? error.message : String(error) });
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(concurrency, 6) }, () => recoveryWorker()));
    const crawlRecords = records.filter((record) => !record.source_repository_path);
    await writeFile(SOURCES_PATHS[0], `${JSON.stringify(crawlRecords, null, 2)}\n`);

    if (recovered.length > 0) {
      await mkdir(STATE_DIR, { recursive: true });
      const sqlPath = path.join(STATE_DIR, "recovered_sources.sql");
      const sql = recovered.map((record) =>
        `UPDATE source_documents SET file_hash = ${sqlString(record.file_hash)} WHERE source_url = ${sqlString(record.source_url)};`,
      ).join("\n");
      await writeFile(sqlPath, `${sql}\n`);
      if (applyRemote) {
        await run("npx", [
          "wrangler", "d1", "execute", "graduate_exam_db", "--remote",
          "--file", sqlPath,
          "--config", config,
        ]);
      }
    }
    console.log(JSON.stringify({ recovered: recovered.length, unavailable: unavailable.length, unavailable_sources: unavailable }, null, 2));
  }

  const byPath = new Map();
  for (const record of records) {
    if (record.storage_path && !byPath.has(record.storage_path)) byPath.set(record.storage_path, record);
  }

  const uploaded = await loadState();
  const ready = [];
  const missing = [];
  const invalid = [];
  let totalBytes = 0;

  for (const record of byPath.values()) {
    const filePath = path.join(ROOT, "data", record.storage_path);
    let fileStat;
    try {
      fileStat = await stat(filePath);
    } catch {
      missing.push({ storage_path: record.storage_path, source_url: record.source_url });
      continue;
    }
    const signature = (await readFile(filePath)).subarray(0, 5).toString("ascii");
    if (signature !== "%PDF-") {
      invalid.push({ storage_path: record.storage_path, reason: "invalid PDF signature" });
      continue;
    }
    if (record.file_hash) {
      const actualHash = await sha256(filePath);
      if (actualHash !== record.file_hash) {
        invalid.push({ storage_path: record.storage_path, reason: "SHA-256 mismatch" });
        continue;
      }
    }
    totalBytes += fileStat.size;
    if (!uploaded.has(record.storage_path)) ready.push({ record, filePath, size: fileStat.size });
  }

  console.log(JSON.stringify({
    bucket,
    source_records: records.length,
    unique_paths: byPath.size,
    already_uploaded: uploaded.size,
    ready: ready.length,
    missing: missing.length,
    invalid: invalid.length,
    verified_bytes: totalBytes,
  }, null, 2));

  if (missing.length > 0) {
    console.warn(`Missing local originals: ${missing.length}. Their official URLs remain available as fallback.`);
  }
  if (invalid.length > 0) {
    console.error(JSON.stringify(invalid.slice(0, 20), null, 2));
    throw new Error(`${invalid.length} local PDF files failed validation`);
  }
  if (dryRun) return;

  await mkdir(STATE_DIR, { recursive: true });
  let index = 0;
  let completed = 0;
  async function uploadWorker() {
    while (index < ready.length) {
      const item = ready[index++];
      const objectPath = `${bucket}/${item.record.storage_path}`;
      await run("npx", [
        "wrangler", "r2", "object", "put", objectPath,
        "--file", item.filePath,
        "--content-type", "application/pdf",
        "--cache-control", "private, max-age=3600",
        "--remote",
        "--config", config,
      ]);
      uploaded.add(item.record.storage_path);
      completed += 1;
      await writeFile(STATE_PATH, `${JSON.stringify([...uploaded].sort(), null, 2)}\n`);
      console.log(`[${completed}/${ready.length}] ${item.record.storage_path} (${item.size} bytes)`);
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => uploadWorker()));
  console.log(`Uploaded ${completed} PDF originals to ${bucket}.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
