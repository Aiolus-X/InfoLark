import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { parseEnv } from "node:util";

// Inspect tracked/staged content only; never print a matching credential value.
const files = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" }).split("\0").filter(Boolean);
const env = existsSync(".env") ? parseEnv(readFileSync(".env", "utf8")) : {};
const secrets = Object.entries(env).filter(([key, value]) => /SECRET|API_KEY$|BEARER_TOKEN$|APP_ID$|RECIPIENT_OPEN_ID$/.test(key) && value.length > 10).map(([, value]) => value);
const problems = [];
for (const file of files) {
  if (file !== ".env.example" && /^(?:\.env(?:\.|$)|data\/|\.local\/|node_modules\/|example\.txt$|question\.md$|PLAN\.md$|\.DS_Store$)/.test(file)) {
    problems.push(`${file}: private file`); continue;
  }
  const text = execFileSync("git", ["show", `:${file}`], { maxBuffer: 10 * 1024 * 1024 }).toString("utf8");
  if (secrets.some(secret => text.includes(secret))) problems.push(`${file}: known credential`);
  if (/\bsk-(?:audit-|proj-|ant-)?[A-Za-z0-9_-]{24,}\b|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(text)) problems.push(`${file}: credential pattern`);
  if (/(?:APP_SECRET|API_KEY|BEARER_TOKEN)[ \t]*[=:][ \t]*["']?[A-Za-z0-9_-]{20,}/.test(text)) problems.push(`${file}: credential assignment`);
  if (/\/Users\/(?!Shared\/|example\/|yourname\/)[A-Za-z0-9_.-]+\//.test(text)) problems.push(`${file}: personal path`);
  for (const match of text.matchAll(/https:\/\/([a-z0-9.-]+)\.feishu\.cn\/(?:wiki|docx|file)\/[A-Za-z0-9_-]+/g)) {
    if (!["example", "sample", "paperlark-test"].includes(match[1])) problems.push(`${file}: private document link`);
  }
  if (file === "package-lock.json") {
    for (const entry of Object.values(JSON.parse(text).packages)) if (entry.resolved && new URL(entry.resolved).hostname !== "registry.npmjs.org") problems.push(`${file}: non-public dependency registry`);
  }
}
if (problems.length) { console.error([...new Set(problems)].join("\n")); process.exitCode = 1; }
else console.log(`Checked ${files.length} files: no known credentials or private runtime files; dependency URLs use public npm.`);
