import { readFile, writeFile } from "node:fs/promises";

const [templatePath = "wrangler.production.example.jsonc", outputPath = "wrangler.production.jsonc"] = process.argv.slice(2);
const replacements = {
  WORKER_NAME: process.env.WORKER_NAME,
  CUSTOM_DOMAIN: process.env.CUSTOM_DOMAIN,
  ZONE_NAME: process.env.ZONE_NAME,
  D1_DATABASE_NAME: process.env.D1_DATABASE_NAME,
  D1_DATABASE_ID: process.env.D1_DATABASE_ID,
  RECOMMENDATION_QUEUE: process.env.RECOMMENDATION_QUEUE,
};

const missing = Object.entries(replacements).filter(([, value]) => !value).map(([key]) => key);
if (missing.length > 0) {
  throw new Error(`Missing production configuration: ${missing.join(", ")}`);
}

let config = await readFile(templatePath, "utf8");
for (const [key, value] of Object.entries(replacements)) {
  config = config.replaceAll(`__${key}__`, value);
}
if (/__[A-Z0-9_]+__/.test(config)) throw new Error("Unresolved production configuration placeholder");
await writeFile(outputPath, config, { mode: 0o600 });
