import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-remote-settings-"));
const modelsCachePath = path.join(tempDir, "models_cache.json");
const settingsPath = path.join(tempDir, "run-settings.json");
const appSource = fs.readFileSync(path.join(process.cwd(), "src", "App.tsx"), "utf8");
const stylesSource = fs.readFileSync(path.join(process.cwd(), "src", "styles.css"), "utf8");
const serverSource = fs.readFileSync(path.join(process.cwd(), "server", "index.ts"), "utf8");

assert.match(
  appSource,
  /resetDate\.toLocaleString\(undefined, \{[\s\S]{0,220}weekday: "short",[\s\S]{0,220}hour: "numeric",[\s\S]{0,100}minute: "2-digit"/,
  "all usage reset labels include both the full date and time"
);
assert.match(appSource, /<span>Resets available<\/span>[\s\S]{0,100}resetCreditsAvailable/, "usage consumption shows the reset credits available");
assert.match(appSource, /formatDate\(message\.createdAt, true\)/, "phone message metadata renders a compact date without the year");
assert.match(appSource, /className="bubble-time-full"[\s\S]{0,180}className="bubble-time-compact"/, "message metadata provides desktop and phone date variants");
assert.match(stylesSource, /@media \(max-width: 640px\)[\s\S]*?\.bubble-meta\s*\{[\s\S]*?font-size:\s*0\.64rem;/, "phone message metadata uses a smaller font");
assert.match(stylesSource, /\.bubble-time-full\s*\{\s*display:\s*none;[\s\S]*?\.bubble-time-compact\s*\{\s*display:\s*inline;/, "phones hide the year-bearing date and show the compact date");
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
  /gpt-5\.6-luna", reasoningEffort: "medium", modelLabel: "Luna", effortLabel: "Medium"[\s\S]*gpt-5\.6-sol", reasoningEffort: "low", modelLabel: "Sol", effortLabel: "Low"[\s\S]*gpt-5\.6-sol", reasoningEffort: "medium", modelLabel: "Sol", effortLabel: "Medium"[\s\S]*gpt-5\.6-sol", reasoningEffort: "high", modelLabel: "Sol", effortLabel: "High"[\s\S]*gpt-6-astra", reasoningEffort: "medium", modelLabel: "Astra", effortLabel: "Medium"[\s\S]*gpt-6-astra", reasoningEffort: "max", modelLabel: "Astra", effortLabel: "Max"/,
  "the shared power slider keeps the requested preset order in both settings surfaces"
);
assert.match(appSource, /isControlRoomTile \? "is-control-room-tile"/, "embedded squares identify themselves for tile-specific composer layering");
assert.match(
  appSource,
  /className="composer-power-model" title=\{`\$\{powerSettingLabel\(previewPowerSetting\)\} reasoning`\}[\s\S]{0,100}\{powerSettingLabel\(previewPowerSetting\)\}/,
  "the compact in-chat slider shows both model and reasoning"
);
assert.match(
  appSource,
  /function jobRunSettingsLabel\(job: CodexRunJob[\s\S]{0,600}modelCapabilities/,
  "queued task settings resolve the friendly model label"
);
assert.match(appSource, /className="queue-settings">\{jobRunSettingsLabel\(job, state\?\.runner\.settingsOptions\)\}/, "queued task cards display their submission model and reasoning");
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
  assert(options.models.includes("gpt-6-astra"), "Astra remains available when the local cache is incomplete");
  assert(options.models.includes("gpt-5.6-terra"), "fallback models remain available when the local cache is incomplete");
  assert.deepEqual(options.modelCapabilities["gpt-6-astra"]?.reasoningEfforts, ["low", "medium", "high", "xhigh", "max"]);
  assert.deepEqual(options.modelCapabilities["gpt-5.6-sol"]?.reasoningEfforts, ["low", "medium", "high", "xhigh", "max", "ultra"]);
  assert.deepEqual(options.modelCapabilities["gpt-5.6-luna"]?.reasoningEfforts, ["low", "medium", "high", "xhigh", "max"]);
  assert.deepEqual(options.modelCapabilities["gpt-5.6-sol"]?.speeds, ["default", "priority"]);

  assert.equal(getRunSettings().reasoningEffort, "medium", "unsupported persisted effort falls back to the model default");
  assert.equal(updateRunSettings({ model: "gpt-5.6-sol", reasoningEffort: "ultra" }).reasoningEffort, "ultra");
  assert.equal(updateRunSettings({ model: "gpt-6-astra", reasoningEffort: "max" }).reasoningEffort, "max");
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
