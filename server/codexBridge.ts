import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { BridgeMode, ControlDiagnostics, ControlResult } from "./types.js";

const execFileAsync = promisify(execFile);
const maxDiagnosticTextLength = 4000;

const hotkeyMap = new Map<string, string>([
  ["enter", "{ENTER}"],
  ["escape", "{ESC}"],
  ["ctrl-c", "^c"],
  ["ctrl-v", "^v"],
  ["ctrl-a", "^a"],
  ["ctrl-l", "^l"],
  ["page-up", "{PGUP}"],
  ["page-down", "{PGDN}"]
]);

type BridgeOptions = {
  enabled: boolean;
  targetTitle: string;
};

type ExecFailure = Error & {
  stdout?: string;
  stderr?: string;
  code?: number | string;
  signal?: string;
};

function clampDiagnosticText(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.replace(/\r\n/g, "\n").trim();
  if (!normalized) {
    return undefined;
  }

  if (normalized.length <= maxDiagnosticTextLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxDiagnosticTextLength)}... [truncated]`;
}

export class CodexBridge {
  private readonly enabled: boolean;
  private readonly targetTitle: string;

  constructor(options: BridgeOptions) {
    this.enabled = options.enabled;
    this.targetTitle = options.targetTitle;
  }

  get mode(): BridgeMode {
    return this.enabled ? "window-control" : "simulation";
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  get title(): string {
    return this.targetTitle;
  }

  async focus(): Promise<ControlResult> {
    return this.run("Focus Codex window", this.focusScript());
  }

  async sendText(text: string, submit: boolean): Promise<ControlResult> {
    const trimmed = text.trimEnd();

    if (!trimmed) {
      return {
        ok: false,
        simulated: !this.enabled,
        message: "Text is empty",
        diagnostics: this.makeDiagnostics("Validate text", Date.now())
      };
    }

    if (trimmed.length > 8000) {
      return {
        ok: false,
        simulated: !this.enabled,
        message: "Text is longer than the 8000 character safety limit",
        diagnostics: this.makeDiagnostics("Validate text", Date.now())
      };
    }

    const encodedText = Buffer.from(trimmed, "utf8").toString("base64");
    const submitLine = submit
      ? `
Start-Sleep -Milliseconds 80
$shell.SendKeys('{ENTER}')
Write-Output 'sendkeys=enter'
`
      : "";

    return this.run(
      submit ? "Paste text and press Enter" : "Paste text",
      `
${this.focusScript()}
$text = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encodedText}'))
Set-Clipboard -Value $text
Write-Output ("clipboard=set chars=" + $text.Length)
Start-Sleep -Milliseconds 80
$shell.SendKeys('^v')
Write-Output 'sendkeys=paste'
${submitLine}
`
    );
  }

  async hotkey(key: string): Promise<ControlResult> {
    const normalized = key.toLowerCase();
    const sendKeysValue = hotkeyMap.get(normalized);

    if (!sendKeysValue) {
      return {
        ok: false,
        simulated: !this.enabled,
        message: `Unsupported hotkey: ${key}`,
        diagnostics: this.makeDiagnostics("Validate hotkey", Date.now())
      };
    }

    return this.run(
      `Send ${normalized}`,
      `
${this.focusScript()}
Start-Sleep -Milliseconds 80
$shell.SendKeys('${sendKeysValue}')
`
    );
  }

  private async run(label: string, script: string): Promise<ControlResult> {
    const startedAt = Date.now();

    if (!this.enabled) {
      return {
        ok: true,
        simulated: true,
        message: `${label} queued in simulation mode`,
        diagnostics: this.makeDiagnostics(label, startedAt)
      };
    }

    if (process.platform !== "win32") {
      return {
        ok: false,
        simulated: false,
        message: "Window control is only implemented for Windows",
        diagnostics: this.makeDiagnostics(label, startedAt)
      };
    }

    const encodedCommand = Buffer.from(script, "utf16le").toString("base64");

    try {
      const { stdout, stderr } = await execFileAsync(
        "powershell.exe",
        ["-NoProfile", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encodedCommand],
        { timeout: 5000, windowsHide: true }
      );

      return {
        ok: true,
        simulated: false,
        message: `${label} sent to Codex`,
        diagnostics: this.makeDiagnostics(label, startedAt, {
          stdout: clampDiagnosticText(stdout),
          stderr: clampDiagnosticText(stderr)
        })
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown PowerShell failure";
      const failure = error as ExecFailure;

      return {
        ok: false,
        simulated: false,
        message,
        diagnostics: this.makeDiagnostics(label, startedAt, {
          stdout: clampDiagnosticText(failure.stdout),
          stderr: clampDiagnosticText(failure.stderr),
          errorName: error instanceof Error ? error.name : undefined,
          exitCode: failure.code,
          signal: failure.signal
        })
      };
    }
  }

  private makeDiagnostics(label: string, startedAt: number, extras: Partial<ControlDiagnostics> = {}): ControlDiagnostics {
    return {
      label,
      elapsedMs: Math.max(0, Date.now() - startedAt),
      targetTitle: this.targetTitle,
      platform: process.platform,
      enabled: this.enabled,
      ...extras
    };
  }

  private focusScript(): string {
    const encodedTitle = Buffer.from(this.targetTitle, "utf8").toString("base64");

    return `
$title = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encodedTitle}'))
$shell = New-Object -ComObject WScript.Shell
Write-Output ("target-title=" + $title)
$activated = $shell.AppActivate($title)
Write-Output ("appactivate=" + $activated)
if (-not $activated) {
  throw "Could not find a window matching '$title'"
}
Start-Sleep -Milliseconds 120
Write-Output 'focus=ready'
`;
  }
}
