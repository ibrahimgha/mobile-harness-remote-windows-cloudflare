import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import type { RemoteSkillContext } from "./remotePromptContext.js";

export const remoteSkillName = "codex-remote-mobile";
const bundleFiles = ["SKILL.md", "agents/openai.yaml", "references/handoffs.md", "scripts/remote-chat.mjs"];

function readJson(file: string): Record<string, unknown> {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return {}; }
}

function inferPublicUrl(projectRoot: string, port: number): string | undefined {
  const tunnelConfigs = ["/etc/cloudflared/config.yml", "/etc/cloudflared/config.yaml"];
  // This repository's bundled tunnel file belongs to the Windows installation.
  if (process.platform === "win32") tunnelConfigs.push(path.join(projectRoot, "ops", "cloudflared.yml"));
  for (const file of tunnelConfigs) {
    try {
      let hostname = "";
      for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
        const host = line.match(/^\s*-?\s*hostname:\s*["']?([a-z0-9.-]+)/i);
        if (host) hostname = host[1];
        if (hostname && new RegExp(`service:\\s*["']?https?://(?:localhost|127\\.0\\.0\\.1):${port}(?:[/\\s"']|$)`).test(line)) return `https://${hostname}`;
      }
    } catch { /* Explicit connection settings remain available for other installations. */ }
  }
}

export function ensureRemoteSkill(options: { projectRoot?: string; skillsRoot?: string; env?: NodeJS.ProcessEnv } = {}): RemoteSkillContext {
  const env = options.env ?? process.env;
  const projectRoot = path.resolve(options.projectRoot ?? process.cwd());
  const source = path.join(projectRoot, "skills", remoteSkillName);
  const target = path.join(options.skillsRoot ?? env.CODEX_REMOTE_SKILLS_DIR ?? path.join(os.homedir(), ".agents", "skills"), remoteSkillName);
  const digest = createHash("sha256");
  for (const file of bundleFiles) digest.update(file).update(fs.readFileSync(path.join(source, file)));
  const version = digest.digest("hex");
  for (const file of bundleFiles) {
    const bytes = fs.readFileSync(path.join(source, file));
    const destination = path.join(target, file);
    if (fs.existsSync(destination) && fs.readFileSync(destination).equals(bytes)) continue;
    if (fs.existsSync(destination)) {
      const previous = fs.readFileSync(destination);
      const oldHash = createHash("sha256").update(previous).digest("hex").slice(0, 16);
      const backup = path.join(projectRoot, ".runtime", "skill-backups", remoteSkillName, oldHash, file);
      fs.mkdirSync(path.dirname(backup), { recursive: true });
      if (!fs.existsSync(backup)) fs.writeFileSync(backup, previous);
    }
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(`${destination}.${process.pid}.tmp`, bytes);
    fs.renameSync(`${destination}.${process.pid}.tmp`, destination);
  }
  const port = Number(env.PORT || 8787);
  const overrides = readJson(path.join(projectRoot, ".runtime", "codex-remote-connection.json"));
  const publicUrl = env.CODEX_REMOTE_PUBLIC_URL || overrides.publicUrl || inferPublicUrl(projectRoot, port);
  const connectionFile = path.join(target, "connection.json");
  const connection = JSON.stringify({ projectRoot, baseUrl: `http://127.0.0.1:${port}`, publicUrl, envFile: path.join(projectRoot, ".env"), machine: env.REMOTE_SERVER_NAME || os.hostname(), bundleVersion: version }, null, 2) + "\n";
  if (!fs.existsSync(connectionFile) || fs.readFileSync(connectionFile, "utf8") !== connection) fs.writeFileSync(connectionFile, connection);
  return { name: remoteSkillName, path: path.join(target, "SKILL.md"), connectionFile };
}
