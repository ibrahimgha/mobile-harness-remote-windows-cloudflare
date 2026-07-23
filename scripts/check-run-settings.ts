import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-remote-settings-"));
const modelsCachePath = path.join(tempDir, "models_cache.json");
const settingsPath = path.join(tempDir, "run-settings.json");
const appSource = fs.readFileSync(path.join(process.cwd(), "src", "App.tsx"), "utf8");
const serverSource = fs.readFileSync(path.join(process.cwd(), "server", "index.ts"), "utf8");

assert.match(
  appSource,
  /label === "Weekly"[\s\S]{0,180}weekday: "short"/,
  "weekly usage reset dates include the weekday"
);
assert.match(
  appSource,
  /const usedPercent = Math\.min\(100, Math\.max\(0, usage\?\.usedPercent \?\? 0\)\)/,
  "usage meters always render Codex's measured percentage"
);
assert.match(appSource, /resetExpired\s*\? "Last reported"/, "expired reset timestamps are labeled without inventing usage");
assert.match(appSource, /aria-label=\{refreshing \? `Refreshing \$\{label\} usage` : `Refresh \$\{label\} usage`\}/, "five-hour usage is an explicit refresh control");
assert.match(appSource, /data-testid="usage-refresh-button"/, "usage refresh keeps a stable control identity while loading");
assert.match(appSource, /<span>Refreshing\.\.\.<\/span>/, "usage refresh exposes visible loading text");
assert.match(appSource, /Measuring with Codex\.\.\./, "usage refresh describes the live account measurement");
assert.match(appSource, /Not provided by Codex/, "an omitted five-hour bucket is shown honestly");
assert.match(
  appSource,
  /gpt-5\.6-luna", reasoningEffort: "medium", modelLabel: "Luna"[\s\S]*gpt-5\.6-terra", reasoningEffort: "medium", modelLabel: "Terra"[\s\S]*gpt-5\.5", reasoningEffort: "xhigh", modelLabel: "5\.5"[\s\S]*gpt-5\.6-sol", reasoningEffort: "medium", modelLabel: "Sol"[\s\S]*gpt-5\.6-sol", reasoningEffort: "high", modelLabel: "Sol"[\s\S]*gpt-5\.6-sol", reasoningEffort: "ultra", modelLabel: "Sol"/,
  "the shared power slider keeps the requested preset order in both settings surfaces"
);
assert.match(appSource, /new Promise\(\(resolve\) => window\.setTimeout\(resolve, 800\)\)/, "usage loading feedback remains visible long enough to perceive");
assert.match(appSource, /catch\(\(\) => apiFetch<BridgeState>\("\/api\/state"\)/, "tap refresh falls back while an older backend waits to restart");
assert.match(
  appSource,
  /\{advancedVisible \? \([\s\S]{0,2600}<div className="run-settings-grid">[\s\S]{0,2600}\) : null\}\s*<div className="usage-meters"/,
  "usage meters remain outside the Advanced-only settings content"
);
assert.match(serverSource, /const usageRefreshIntervalMs = 60_000;/, "usage refreshes once per minute");
assert.match(serverSource, /refreshCodexUsage\(\{ force: true \}\)/, "tap refresh forces a fresh Codex account measurement");
assert.match(serverSource, /app\.post\("\/api\/usage\/refresh", requireControlAuth/, "tap refresh uses an authenticated server endpoint");
assert.match(
  serverSource,
  /setInterval\(\(\) => void refreshUsageAndPushState\(\), usageRefreshIntervalMs\)/,
  "each usage refresh pushes the new limits to connected clients"
);

fs.writeFileSync(
  modelsCachePath,
  JSON.stringify({
    models: [
      {
        slug: "gpt-5.6-sol",
        display_name: "GPT-5.6-Sol",
        description: "Frontier model",
        visibility: "list",
        default_reasoning_level: "low",
        supported_reasoning_levels: ["low", "medium", "high", "xhigh", "max", "ultra"].map((effort) => ({ effort })),
        additional_speed_tiers: ["fast"],
        service_tiers: { id: "priority" }
      },
      {
        slug: "gpt-5.6-luna",
        display_name: "GPT-5.6-Luna",
        visibility: "list",
        default_reasoning_level: "medium",
        supported_reasoning_levels: ["low", "medium", "high", "xhigh", "max"].map((effort) => ({ effort })),
        additional_speed_tiers: ["fast"]
      }
    ]
  }),
  "utf8"
);
fs.writeFileSync(
  settingsPath,
  JSON.stringify({ model: "gpt-5.6-luna", reasoningEffort: "ultra", speed: "priority", updatedAt: "2026-07-10T00:00:00.000Z" }),
  "utf8"
);

process.env.CODEX_MODELS_CACHE_PATH = modelsCachePath;
process.env.CODEX_RUN_SETTINGS_PATH = settingsPath;

try {
  const { getRunSettings, getRunSettingsOptions, updateRunSettings } = await import("../server/runSettings.js");
  const options = getRunSettingsOptions();

  assert(options.models.includes("gpt-5.6-sol"));
  assert(options.models.includes("gpt-5.6-terra"), "fallback models remain available when the local cache is incomplete");
  assert.deepEqual(options.modelCapabilities["gpt-5.6-sol"]?.reasoningEfforts, ["low", "medium", "high", "xhigh", "max", "ultra"]);
  assert.deepEqual(options.modelCapabilities["gpt-5.6-luna"]?.reasoningEfforts, ["low", "medium", "high", "xhigh", "max"]);
  assert.deepEqual(options.modelCapabilities["gpt-5.6-sol"]?.speeds, ["default", "priority"]);

  assert.equal(getRunSettings().reasoningEffort, "medium", "unsupported persisted effort falls back to the model default");
  assert.equal(updateRunSettings({ model: "gpt-5.6-sol", reasoningEffort: "ultra" }).reasoningEffort, "ultra");
  assert.deepEqual(
    updateRunSettings({ model: "gpt-5.4-mini", speed: "priority" }),
    {
      model: "gpt-5.4-mini",
      reasoningEffort: "medium",
      speed: "default",
      updatedAt: getRunSettings().updatedAt
    },
    "model changes normalize both reasoning and speed"
  );
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}
