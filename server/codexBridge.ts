import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { BridgeMode, ControlResult } from "./types.js";

const execFileAsync = promisify(execFile);

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
        message: "Text is empty"
      };
    }

    if (trimmed.length > 8000) {
      return {
        ok: false,
        simulated: !this.enabled,
        message: "Text is longer than the 8000 character safety limit"
      };
    }

    const encodedText = Buffer.from(trimmed, "utf8").toString("base64");
    const submitLine = submit ? "Start-Sleep -Milliseconds 80; $shell.SendKeys('{ENTER}')" : "";

    return this.run(
      submit ? "Paste text and press Enter" : "Paste text",
      `
${this.focusScript()}
$text = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encodedText}'))
Set-Clipboard -Value $text
Start-Sleep -Milliseconds 80
$shell.SendKeys('^v')
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
        message: `Unsupported hotkey: ${key}`
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
    if (!this.enabled) {
      return {
        ok: true,
        simulated: true,
        message: `${label} queued in simulation mode`
      };
    }

    if (process.platform !== "win32") {
      return {
        ok: false,
        simulated: false,
        message: "Window control is only implemented for Windows"
      };
    }

    const encodedCommand = Buffer.from(script, "utf16le").toString("base64");

    try {
      await execFileAsync(
        "powershell.exe",
        ["-NoProfile", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encodedCommand],
        { timeout: 5000, windowsHide: true }
      );

      return {
        ok: true,
        simulated: false,
        message: `${label} sent to Codex`
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown PowerShell failure";

      return {
        ok: false,
        simulated: false,
        message
      };
    }
  }

  private focusScript(): string {
    const encodedTitle = Buffer.from(this.targetTitle, "utf8").toString("base64");

    return `
$title = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encodedTitle}'))
$shell = New-Object -ComObject WScript.Shell
$activated = $shell.AppActivate($title)
if (-not $activated) {
  throw "Could not find a window matching '$title'"
}
Start-Sleep -Milliseconds 120
`;
  }
}
