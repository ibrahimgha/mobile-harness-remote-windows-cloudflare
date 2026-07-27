import { createHash, randomBytes, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

function valueFor(name, fallback = "") {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? String(process.argv[index + 1] ?? "") : fallback;
}

const chatId = valueFor("chat-id");
const chatTitle = valueFor("chat-title");
const projectName = valueFor("project-name");
const projectPath = valueFor("project-path");
const model = valueFor("model");
const reasoningEffort = valueFor("reasoning", "medium");
const speed = valueFor("speed", "default");

if (![chatId, chatTitle, projectName, projectPath, model].every(Boolean)) {
  console.error(
    "Required: --chat-id --chat-title --project-name --project-path --model [--reasoning medium] [--speed default]"
  );
  process.exit(1);
}

const configPath = path.resolve(
  process.env.CODEX_REMOTE_ACCESS_TOKENS_PATH ?? path.join(process.cwd(), ".runtime", "access-tokens.json")
);
const token = `crs_${randomBytes(32).toString("base64url")}`;
const tokenHash = createHash("sha256").update(token).digest("hex");
let config = { version: 1, tokens: [] };

try {
  config = JSON.parse(fs.readFileSync(configPath, "utf8"));
} catch {
  // The first scoped token creates the runtime-only configuration.
}

config.version = 1;
config.tokens = Array.isArray(config.tokens) ? config.tokens : [];
config.tokens.push({
  id: randomUUID(),
  tokenHash,
  chatId,
  chatTitle,
  projectName,
  projectPath,
  model,
  reasoningEffort,
  speed
});

fs.mkdirSync(path.dirname(configPath), { recursive: true });
fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
console.log(token);
