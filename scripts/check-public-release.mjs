import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const tracked = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" }).split("\0").filter(Boolean);
const forbiddenPaths = [
  /^data\/(crawl|agent-review|open-inshi)(\/|$)/,
  /^data\/crawler-targets\.json$/,
  /^wrangler\.(production|noema)\.jsonc$/,
  /\.(pdf|pem|key|p12|sqlite|db)$/i,
];
const forbiddenContent = [
  { label: "personal email", pattern: new RegExp("mani" + "1261790@gmail\\.com", "i") },
  { label: "private deployment domain", pattern: new RegExp("graduate\\." + "noema-learn\\.uk", "i") },
  { label: "Cloudflare account or database identifier", pattern: /\b(?!0{32}\b)[0-9a-f]{32}\b|\b(?!00000000-0000-0000-0000-000000000000\b)[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i },
  { label: "private key", pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  { label: "GitHub token", pattern: /\b(?:ghp_|github_pat_)[A-Za-z0-9_]{20,}/ },
];

const failures = [];
for (const path of tracked) {
  if (forbiddenPaths.some((pattern) => pattern.test(path))) failures.push(`${path}: private path or binary is tracked`);
  if (path === "package-lock.json" || path === "worker-configuration.d.ts") continue;
  let content;
  try {
    content = readFileSync(path, "utf8");
  } catch {
    continue;
  }
  for (const check of forbiddenContent) {
    if (check.pattern.test(content)) failures.push(`${path}: contains ${check.label}`);
  }
}

for (const required of ["LICENSE", "SECURITY.md", "docs/data-policy.md", "wrangler.production.example.jsonc"]) {
  if (!tracked.includes(required)) failures.push(`${required}: required public-release file is missing`);
}

if (failures.length > 0) {
  console.error("Public release check failed:\n" + failures.map((failure) => `- ${failure}`).join("\n"));
  process.exit(1);
}
console.log(`Public release check passed (${tracked.length} tracked files inspected).`);
