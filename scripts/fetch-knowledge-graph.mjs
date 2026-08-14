import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";

const REPOSITORY = "https://github.com/KTaisei/KnowledgeGraph.git";
const PINNED_COMMIT = "4bb8bfe73e50aadf12d3e9f896e057b291c177ed";
const root = path.resolve(import.meta.dirname, "..");
const destination = path.join(root, "tmp", "knowledge-graph-upstream");

function run(command, args, cwd = root) {
  const result = spawnSync(command, args, { cwd, stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

if (existsSync(destination)) rmSync(destination, { recursive: true, force: true });
mkdirSync(path.dirname(destination), { recursive: true });
run("git", ["clone", "--filter=blob:none", "--no-checkout", REPOSITORY, destination]);
run("git", ["sparse-checkout", "init", "--cone"], destination);
run("git", ["sparse-checkout", "set", "src", "requirements.txt", "LICENSE", "README.md"], destination);
run("git", ["checkout", "--detach", PINNED_COMMIT], destination);

const revision = spawnSync("git", ["rev-parse", "HEAD"], { cwd: destination, encoding: "utf8" });
if (revision.status !== 0 || revision.stdout.trim() !== PINNED_COMMIT) {
  throw new Error(`KnowledgeGraph revision mismatch: ${revision.stdout.trim()}`);
}
const example = spawnSync("git", ["show", `${PINNED_COMMIT}:output/knowledge_graph.json`], { cwd: destination, encoding: "utf8" });
if (example.status === 0 && example.stdout.trim()) {
  const outputDir = path.join(destination, "output");
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(path.join(outputDir, "upstream-example.json"), example.stdout, "utf8");
}
console.log(`KnowledgeGraph ${PINNED_COMMIT} is ready at ${destination}`);
