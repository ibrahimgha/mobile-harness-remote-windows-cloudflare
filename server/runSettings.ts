import fs from "node:fs";
import path from "node:path";

import type { CodexRunSettings, CodexRunSettingsOptions } from "./types.js";

const runtimeDir = path.resolve(process.cwd(), ".runtime");
const settingsPath = path.join(runtimeDir, "codex-run-settings.json");
const defaultModelOptions = ["default", "gpt-5.5", "gpt-5.4", "gpt-5.1", "o4-mini", "o3"];
const reasoningEfforts: CodexRunSettingsOptions["reasoningEfforts"] = ["none", "minimal", "low", "medium", "high", "xhigh"];
const speeds: CodexRunSettingsOptions["speeds"] = ["default", "priority"];

function nowIso(): string {
  return new Date().toISOString();
}

function modelOptions(): string[] {
  const configured = (process.env.CODEX_MODEL_OPTIONS ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return Array.from(new Set(["default", ...configured, ...defaultModelOptions]));
}

function normalizeRunSettings(input: Partial<CodexRunSettings>): CodexRunSettings {
  const models = modelOptions();
  const model = typeof input.model === "string" ? input.model.trim() : "";
  const reasoningEffort = input.reasoningEffort;
  const speed = input.speed;

  return {
    model: model && models.includes(model) ? model : "default",
    reasoningEffort: reasoningEffort && reasoningEfforts.includes(reasoningEffort) ? reasoningEffort : "xhigh",
    speed: speed && speeds.includes(speed) ? speed : "default",
    updatedAt: typeof input.updatedAt === "string" && input.updatedAt ? input.updatedAt : nowIso()
  };
}

function defaultSettings(): CodexRunSettings {
  return normalizeRunSettings({
    model: process.env.CODEX_RUN_MODEL?.trim() || "default",
    reasoningEffort: (process.env.CODEX_RUN_REASONING_EFFORT?.trim() as CodexRunSettings["reasoningEffort"]) || "xhigh",
    speed: (process.env.CODEX_RUN_SPEED?.trim() as CodexRunSettings["speed"]) || "default",
    updatedAt: nowIso()
  });
}

function loadSettings(): CodexRunSettings {
  try {
    if (!fs.existsSync(settingsPath)) {
      return defaultSettings();
    }

    const raw = fs.readFileSync(settingsPath, "utf8");
    return normalizeRunSettings(JSON.parse(raw) as Partial<CodexRunSettings>);
  } catch {
    return defaultSettings();
  }
}

let cachedSettings = loadSettings();

function saveSettings(settings: CodexRunSettings): void {
  fs.mkdirSync(runtimeDir, { recursive: true });
  fs.writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
}

export function getRunSettings(): CodexRunSettings {
  return { ...cachedSettings };
}

export function getRunSettingsOptions(): CodexRunSettingsOptions {
  const models = modelOptions();

  if (cachedSettings?.model && !models.includes(cachedSettings.model)) {
    models.push(cachedSettings.model);
  }

  return {
    models,
    reasoningEfforts,
    speeds
  };
}

export function updateRunSettings(patch: Partial<CodexRunSettings>): CodexRunSettings {
  cachedSettings = normalizeRunSettings({
    ...cachedSettings,
    ...patch,
    updatedAt: nowIso()
  });
  saveSettings(cachedSettings);
  return getRunSettings();
}
