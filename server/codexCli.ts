import { existsSync, readdirSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

type CliCandidate = {
  filePath: string;
  mtimeMs: number;
  version: number[];
};

let cachedCliPath: string | undefined;

function readCliVersion(filePath: string): number[] {
  const result = spawnSync(filePath, ["--version"], {
    encoding: "utf8",
    timeout: 5_000,
    windowsHide: true
  });
  if (result.error || result.status !== 0) {
    return [];
  }
  const version = `${result.stdout ?? ""}\n${result.stderr ?? ""}`.match(/\b(\d+)\.(\d+)\.(\d+)(?:[-+.][^\s]+)?/);
  return version ? version.slice(1).map(Number) : [];
}

function compareVersions(left: number[], right: number[]): number {
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) {
      return difference;
    }
  }
  return 0;
}

function addCandidate(candidates: Map<string, CliCandidate>, filePath: string) {
  if (!existsSync(filePath) || candidates.has(filePath)) {
    return;
  }
  try {
    candidates.set(filePath, {
      filePath,
      mtimeMs: statSync(filePath).mtimeMs,
      version: readCliVersion(filePath)
    });
  } catch {
    // Ignore incomplete installations and continue checking healthy candidates.
  }
}

export function resolveCodexCliPath(): string {
  const configured = process.env.CODEX_CLI_PATH?.trim();
  if (configured) {
    return configured;
  }

  if (cachedCliPath) {
    return cachedCliPath;
  }

  const executableName = process.platform === "win32" ? "codex.exe" : "codex";
  const candidates = new Map<string, CliCandidate>();

  if (process.platform === "win32" && process.env.APPDATA) {
    const packageRoot = path.join(process.env.APPDATA, "npm", "node_modules", "@openai", "codex", "node_modules", "@openai");
    try {
      for (const platformPackage of readdirSync(packageRoot, { withFileTypes: true })) {
        if (!platformPackage.isDirectory() || !platformPackage.name.startsWith("codex-win32-")) {
          continue;
        }
        const vendorRoot = path.join(packageRoot, platformPackage.name, "vendor");
        for (const target of readdirSync(vendorRoot, { withFileTypes: true })) {
          if (target.isDirectory()) {
            addCandidate(candidates, path.join(vendorRoot, target.name, "bin", executableName));
          }
        }
      }
    } catch {
      // The npm CLI is optional; desktop installations are checked below.
    }
  }

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
    addCandidate(candidates, directCli);

    try {
      for (const nestedCli of readdirSync(binDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => path.join(binDir, entry.name, executableName))) {
        addCandidate(candidates, nestedCli);
      }
    } catch {
      continue;
    }
  }

  const selected = [...candidates.values()].sort((left, right) =>
    compareVersions(right.version, left.version) || right.mtimeMs - left.mtimeMs
  )[0]?.filePath;
  cachedCliPath = selected ?? executableName;
  return cachedCliPath;
}
