#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sqlPath = path.join(ROOT, "data", "crawl", "import_problems.sql");
const remote = process.argv.includes("--remote");
const args = ["wrangler", "d1", "execute", "graduate_exam_db", remote ? "--remote" : "--local", `--file=${sqlPath}`];
if (process.env.WRANGLER_CONFIG) args.push("--config", process.env.WRANGLER_CONFIG);
if (process.env.WRANGLER_ENV) args.push("--env", process.env.WRANGLER_ENV);

const result = spawnSync("npx", args, {
  cwd: ROOT,
  stdio: "inherit",
  shell: false,
});

process.exit(result.status ?? 1);
