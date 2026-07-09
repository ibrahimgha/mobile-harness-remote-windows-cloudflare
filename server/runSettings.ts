import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import type {
  CodexModelCapability,
  CodexReasoningEffort,
  CodexRunSettings,
  CodexRunSettingsOptions,
  CodexRunSpeed
} from "./types.js";

const runtimeDir = path.resolve(process.cwd(), ".runtime");
const settingsPath = path.resolve(process.env.CODEX_RUN_SETTINGS_PATH?.trim() || path.join(runtimeDir, "codex-run-settings.json"));
const reasoningEfforts: CodexReasoningEffort[] = ["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"];
const legacyReasoningEfforts: CodexReasoningEffort[] = ["none", "minimal", "low", "medium", "high", "xhigh"];
const speeds: CodexRunSpeed[] = ["default", "priority"];
const fallbackModelCapabilities: CodexModelCapability[] = [
  {
    model: "gpt-5.6-sol",
    label: "GPT-5.6-Sol",
    description: "Latest frontier agentic coding model.",
    reasoningEfforts: ["low", "medium", "high", "xhigh", "max", "ultra"],
    defaultReasoningEffort: "low",
    speeds
  },
  {
    model: "gpt-5.6-terra",
    label: "GPT-5.6-Terra",
    description: "Balanced agentic coding model for everyday work.",
    reasoningEfforts: ["low", "medium", "high", "xhigh", "max", "ultra"],
    defaultReasoningEffort: "medium",
    speeds
  },
  {
    model: "gpt-5.6-luna",
    label: "GPT-5.6-Luna",
    description: "Fast and affordable agentic coding model.",
    reasoningEfforts: ["low", "medium", "high", "xhigh", "max"],
    defaultReasoningEffort: "medium",
    speeds
  },
  {
    model: "gpt-5.5",
    label: "GPT-5.5",
    reasoningEfforts: ["low", "medium", "high", "xhigh"],
    defaultReasoningEffort: "medium",
    speeds
  },
  {
    model: "gpt-5.4",
    label: "GPT-5.4",
    reasoningEfforts: ["low", "medium", "high", "xhigh"],
    defaultReasoningEffort: "medium",
    speeds
  },
  {
    model: "gpt-5.4-mini",
    label: "GPT-5.4-Mini",
    reasoningEfforts: ["low", "medium", "high", "xhigh"],
    defaultReasoningEffort: "medium",
    speeds: ["default"]
  },
  {
    model: "gpt-5.3-codex-spark",
    label: "GPT-5.3-Codex-Spark",
    reasoningEfforts: ["low", "medium", "high", "xhigh"],
    defaultReasoningEffort: "high",
    speeds: ["default"]
  }
];
const legacyModelOptions = ["gpt-5.1", "o4-mini", "o3"];

type CachedReasoningLevel = { effort?: unknown };
type CachedServiceTier = { id?: unknown };
type CachedCodexModel = {
  slug?: unknown;
  display_name?: unknown;
  description?: unknown;
  visibility?: unknown;
  default_reasoning_level?: unknown;
  supported_reasoning_levels?: unknown;
  additional_speed_tiers?: unknown;
  service_tiers?: unknown;
};

let cachedRegistryPath = "";
let cachedRegistryMtimeMs = -1;
let cachedRegistryCapabilities: CodexModelCapability[] = [];

function nowIso(): string {
  return new Date().toISOString();
}

function isReasoningEffort(value: unknown): value is CodexReasoningEffort {
  return typeof value === "string" && reasoningEfforts.includes(value as CodexReasoningEffort);
}

function configuredModelOptions() {
  return (process.env.CODEX_MODEL_OPTIONS ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function modelsCachePath() {
  const codexHome = process.env.CODEX_HOME?.trim() || path.join(os.homedir(), ".codex");
  return path.resolve(process.env.CODEX_MODELS_CACHE_PATH?.trim() || path.join(codexHome, "models_cache.json"));
}

function cachedModelReasoningEfforts(model: CachedCodexModel) {
  if (!Array.isArray(model.supported_reasoning_levels)) {
    return [];
  }

  return model.supported_reasoning_levels
    .map((level) => (level && typeof level === "object" ? (level as CachedReasoningLevel).effort : level))
    .filter(isReasoningEffort);
}

function cachedModelSpeeds(model: CachedCodexModel): CodexRunSpeed[] {
  const serviceTiers = Array.isArray(model.service_tiers)
    ? model.service_tiers
    : model.service_tiers && typeof model.service_tiers === "object"
      ? [model.service_tiers]
      : [];
  const additionalSpeeds = Array.isArray(model.additional_speed_tiers) ? model.additional_speed_tiers : [];
  const supportsPriority =
    serviceTiers.some((tier) => tier && typeof tier === "object" && (tier as CachedServiceTier).id === "priority") ||
    additionalSpeeds.includes("fast");

  return supportsPriority ? [...speeds] : ["default"];
}

function readCodexModelCapabilities(): CodexModelCapability[] {
  const filePath = modelsCachePath();

  try {
    const stat = fs.statSync(filePath);
    if (filePath === cachedRegistryPath && stat.mtimeMs === cachedRegistryMtimeMs) {
      return cachedRegistryCapabilities;
    }

    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as { models?: CachedCodexModel[] };
    const capabilities = (parsed.models ?? [])
      .filter((model) => model.visibility === "list" && typeof model.slug === "string" && model.slug.trim())
      .map((model): CodexModelCapability | null => {
        const modelName = String(model.slug).trim();
        const supportedReasoning = cachedModelReasoningEfforts(model);
        const defaultReasoning = isReasoningEffort(model.default_reasoning_level)
          ? model.default_reasoning_level
          : supportedReasoning[0] ?? "medium";

        if (!supportedReasoning.length) {
          return null;
        }

        return {
          model: modelName,
          label: typeof model.display_name === "string" && model.display_name.trim() ? model.display_name.trim() : modelName,
          description: typeof model.description === "string" && model.description.trim() ? model.description.trim() : undefined,
          reasoningEfforts: supportedReasoning,
          defaultReasoningEffort: supportedReasoning.includes(defaultReasoning) ? defaultReasoning : supportedReasoning[0],
          speeds: cachedModelSpeeds(model)
        };
      })
      .filter((capability): capability is CodexModelCapability => Boolean(capability));

    cachedRegistryPath = filePath;
    cachedRegistryMtimeMs = stat.mtimeMs;
    cachedRegistryCapabilities = capabilities;
    return capabilities;
  } catch {
    cachedRegistryPath = filePath;
    cachedRegistryMtimeMs = -1;
    cachedRegistryCapabilities = [];
    return [];
  }
}

function genericModelCapability(model: string): CodexModelCapability {
  return {
    model,
    label: model,
    reasoningEfforts: [...legacyReasoningEfforts],
    defaultReasoningEffort: "xhigh",
    speeds: [...speeds]
  };
}

function modelCapabilities(): CodexModelCapability[] {
  const capabilities = new Map<string, CodexModelCapability>();
  const add = (capability: CodexModelCapability) => capabilities.set(capability.model, capability);

  add({
    model: "default",
    label: "Default",
    reasoningEfforts: [...reasoningEfforts],
    defaultReasoningEffort: "xhigh",
    speeds: [...speeds]
  });

  for (const model of configuredModelOptions()) {
    add(genericModelCapability(model));
  }

  for (const capability of readCodexModelCapabilities()) {
    add(capability);
  }

  for (const capability of fallbackModelCapabilities) {
    if (!capabilities.has(capability.model)) {
      add(capability);
    }
  }

  for (const model of legacyModelOptions) {
    if (!capabilities.has(model)) {
      add(genericModelCapability(model));
    }
  }

  return [...capabilities.values()];
}

function normalizeRunSettings(input: Partial<CodexRunSettings>): CodexRunSettings {
  const capabilities = modelCapabilities();
  const byModel = new Map(capabilities.map((capability) => [capability.model, capability]));
  const requestedModel = typeof input.model === "string" ? input.model.trim() : "";
  const model = requestedModel && byModel.has(requestedModel) ? requestedModel : "default";
  const capability = byModel.get(model) ?? byModel.get("default")!;
  const reasoningEffort =
    input.reasoningEffort && capability.reasoningEfforts.includes(input.reasoningEffort)
      ? input.reasoningEffort
      : capability.defaultReasoningEffort;
  const speed = input.speed && capability.speeds.includes(input.speed) ? input.speed : "default";

  return {
    model,
    reasoningEffort,
    speed,
    updatedAt: typeof input.updatedAt === "string" && input.updatedAt ? input.updatedAt : nowIso()
  };
}

function defaultSettings(): CodexRunSettings {
  return normalizeRunSettings({
    model: process.env.CODEX_RUN_MODEL?.trim() || "default",
    reasoningEffort: (process.env.CODEX_RUN_REASONING_EFFORT?.trim() as CodexReasoningEffort) || "xhigh",
    speed: (process.env.CODEX_RUN_SPEED?.trim() as CodexRunSpeed) || "default",
    updatedAt: nowIso()
  });
}

function loadSettings(): CodexRunSettings {
  try {
    if (!fs.existsSync(settingsPath)) {
      return defaultSettings();
    }

    return normalizeRunSettings(JSON.parse(fs.readFileSync(settingsPath, "utf8")) as Partial<CodexRunSettings>);
  } catch {
    return defaultSettings();
  }
}

let cachedSettings = loadSettings();

function saveSettings(settings: CodexRunSettings): void {
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  fs.writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
}

export function getRunSettings(): CodexRunSettings {
  cachedSettings = normalizeRunSettings(cachedSettings);
  return { ...cachedSettings };
}

export function getRunSettingsOptions(): CodexRunSettingsOptions {
  const capabilities = modelCapabilities();

  if (cachedSettings.model && !capabilities.some((capability) => capability.model === cachedSettings.model)) {
    capabilities.push(genericModelCapability(cachedSettings.model));
  }

  return {
    models: capabilities.map((capability) => capability.model),
    reasoningEfforts: [...reasoningEfforts],
    speeds: [...speeds],
    modelCapabilities: Object.fromEntries(capabilities.map((capability) => [capability.model, capability]))
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
