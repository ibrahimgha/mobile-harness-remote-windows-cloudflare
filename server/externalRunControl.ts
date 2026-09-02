import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const chatIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ExternalRunStopResult = {
  matchedProcessIds: number[];
  stoppedProcessIds: number[];
};

function parseProcessIds(text: string): number[] {
  return [...new Set(text.split(/\r?\n/).map((value) => Number(value.trim())).filter((value) => Number.isInteger(value) && value > 0))];
}

async function stopWindowsRun(chatId: string): Promise<ExternalRunStopResult> {
  const discover = [
    "$chatId = '" + chatId + "'",
    "Get-CimInstance Win32_Process |",
    "Where-Object {",
    "  ($_.Name -ieq 'codex.exe' -or $_.Name -ieq 'node.exe') -and",
    "  $_.CommandLine -and $_.CommandLine.IndexOf($chatId, [StringComparison]::OrdinalIgnoreCase) -ge 0",
    "} | Select-Object -ExpandProperty ProcessId"
  ].join(" ");
  const { stdout } = await execFileAsync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", discover],
    { windowsHide: true, maxBuffer: 1024 * 1024 }
  );
  const matchedProcessIds = parseProcessIds(stdout);
  const stoppedProcessIds: number[] = [];

  for (const pid of matchedProcessIds) {
    try {
      await execFileAsync("taskkill.exe", ["/PID", String(pid), "/T", "/F"], { windowsHide: true });
      stoppedProcessIds.push(pid);
    } catch {
      // A parent tree may already have stopped another matched descendant.
    }
  }

  return { matchedProcessIds, stoppedProcessIds };
}

async function stopPosixRun(chatId: string): Promise<ExternalRunStopResult> {
  const { stdout } = await execFileAsync("ps", ["-eo", "pid=,args="], { maxBuffer: 4 * 1024 * 1024 });
  const matchedProcessIds = stdout
    .split(/\r?\n/)
    .map((line) => line.trim().match(/^(\d+)\s+(.+)$/))
    .filter((match): match is RegExpMatchArray => Boolean(match))
    .filter((match) => {
      const command = match[2].toLowerCase();
      return command.includes(chatId.toLowerCase()) && command.includes("codex") && command.includes("resume");
    })
    .map((match) => Number(match[1]))
    .filter((pid) => pid !== process.pid);
  const stoppedProcessIds: number[] = [];
  for (const pid of [...new Set(matchedProcessIds)]) {
    try {
      process.kill(pid, "SIGTERM");
      stoppedProcessIds.push(pid);
    } catch {
      // The process may have completed between discovery and termination.
    }
  }
  return { matchedProcessIds, stoppedProcessIds };
}

export async function stopExternalCodexRun(chatId: string): Promise<ExternalRunStopResult> {
  if (!chatIdPattern.test(chatId)) throw new Error("Invalid Codex task ID");
  return process.platform === "win32" ? stopWindowsRun(chatId) : stopPosixRun(chatId);
}
