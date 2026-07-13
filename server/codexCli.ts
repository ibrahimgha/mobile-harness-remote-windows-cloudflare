import { existsSync, readdirSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export function resolveCodexCliPath(): string {
  const configured = process.env.CODEX_CLI_PATH?.trim();
  if (configured) {
    return configured;
  }

  const executableName = process.platform === "win32" ? "codex.exe" : "codex";
  const localAppDataCandidates =
    process.platform === "win32"
      ? [
          process.env.LOCALAPPDATA,
          process.env.USERPROFILE ? path.join(process.env.USERPROFILE, "AppData", "Local") : undefined,
          path.join(os.homedir(), "AppData", "Local")
        ]
      : [process.env.LOCALAPPDATA];

  for (const localAppData of localAppDataCandidates) {
    if (!localAppData) {
      continue;
    }

    const binDir = path.join(localAppData, "OpenAI", "Codex", "bin");
    const directCli = path.join(binDir, executableName);
    if (existsSync(directCli)) {
      return directCli;
    }

    try {
      const nestedCli = readdirSync(binDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => path.join(binDir, entry.name, executableName))
        .filter((filePath) => existsSync(filePath))
        .map((filePath) => ({ filePath, mtimeMs: statSync(filePath).mtimeMs }))
        .sort((a, b) => b.mtimeMs - a.mtimeMs)[0]?.filePath;
      if (nestedCli) {
        return nestedCli;
      }
    } catch {
      continue;
    }
  }

  return executableName;
}
