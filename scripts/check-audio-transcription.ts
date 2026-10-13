import assert from "node:assert/strict";
import "./check-screen-wake-lock.js";
import fs from "node:fs";
import { createHash } from "node:crypto";
import { buildAudioTranscriptionPrompt, transcriptEchoesAssistantResponse } from "../server/audioTranscription.js";
import type { ChatDetail } from "../server/types.js";
import { isVoiceOrbTheme, resolveVoiceOrbTheme, voiceOrbThemes, voiceOrbThemeStorageKey } from "../src/voiceOrbThemes.js";
import { applySystemSurface } from "../src/systemSurface.js";

const chat: ChatDetail = {
  id: "voice-test",
  title: "Voice work with Ibrahim Hassan",
  projectName: "Codex Control Room",
  projectPath: "C:/projects/control-room",
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
  lastPrompt: null,
  lastResponse: null,
  hasResponse: true,
  messagePage: { visibleTurns: 2, totalTurns: 2, hasMore: false },
  messages: [
    { id: "1", role: "user", text: "Ask Sarah El Masry to check TC10 and the Cloudflare tunnel.", createdAt: new Date(0).toISOString() },
    { id: "2", role: "assistant", text: "The Codex Remote on TC10 is connected.", createdAt: new Date(0).toISOString() }
  ]
};

const built = buildAudioTranscriptionPrompt({
  chat,
  draftContext: "Continue the change in audioTranscription.ts",
  configuredHumanNames: "Mariam Abdelrahman, Youssef Ali"
});

assert.match(built.prompt, /Ibrahim Hassan/);
assert.match(built.prompt, /Sarah El Masry/);
assert.match(built.prompt, /Mariam Abdelrahman/);
assert.doesNotMatch(built.prompt, /Recent conversation context/);
assert.doesNotMatch(built.prompt, /The Codex Remote on TC10 is connected/);
assert.doesNotMatch(built.prompt, /Continue the change in audioTranscription\.ts/);
assert.match(built.prompt, /Conversation text is intentionally omitted/);
assert.ok(built.prompt.length <= 15_000);
assert.equal(
  transcriptEchoesAssistantResponse("The Codex Remote on TC10 is connected.", chat),
  true,
  "an exact copy of the latest response must never become a prompt"
);
assert.equal(
  transcriptEchoesAssistantResponse("The Codex remote on TC10 is connected and ready.", chat),
  true,
  "a near-copy of the latest response must never become a prompt"
);
assert.equal(
  transcriptEchoesAssistantResponse("Please restart the tunnel on TC10 and verify the health endpoint.", chat),
  false,
  "new dictated instructions must remain sendable"
);

const appSource = fs.readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const recordingOverlaySource = fs.readFileSync(new URL("../src/DictationRecordingOverlay.tsx", import.meta.url), "utf8");
const voiceOrbSource = fs.readFileSync(new URL("../src/VoiceOrb.tsx", import.meta.url), "utf8");
const voiceOrbThemesSource = fs.readFileSync(new URL("../src/voiceOrbThemes.ts", import.meta.url), "utf8");
const stylesSource = fs.readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
const voiceOrbGif = fs.readFileSync(new URL("../public/voice-orb-video.gif", import.meta.url));
const voiceOrbPoster = fs.readFileSync(new URL("../public/voice-orb-poster.png", import.meta.url));
const waterOrbGif = fs.readFileSync(new URL("../public/voice-orb-water-test.gif", import.meta.url));
const waterOrbPoster = fs.readFileSync(new URL("../public/voice-orb-water-test-poster.png", import.meta.url));
const style = () => {
  const values = new Map<string, { value: string; priority: string }>();
  return {
    getPropertyValue: (property: string) => values.get(property)?.value ?? "",
    getPropertyPriority: (property: string) => values.get(property)?.priority ?? "",
    setProperty: (property: string, value: string, priority = "") => { values.set(property, { value, priority }); },
    removeProperty: (property: string) => { const value = values.get(property)?.value ?? ""; values.delete(property); return value; }
  };
};
const rootStyle = style();
const bodyStyle = style();
rootStyle.setProperty("background-color", "rgb(245, 246, 241)");
const themeAttributes = new Map([["content", "#f5f6f1"]]);
const theme = {
  getAttribute: (name: string) => themeAttributes.get(name) ?? null,
  setAttribute: (name: string, value: string) => { themeAttributes.set(name, value); },
  removeAttribute: (name: string) => { themeAttributes.delete(name); }
};
const restoreSurface = applySystemSurface({
  documentElement: { style: rootStyle }, body: { style: bodyStyle }, querySelector: () => theme
} as unknown as Document, "#ffffff");
assert.equal(rootStyle.getPropertyValue("background-color"), "#ffffff");
assert.equal(bodyStyle.getPropertyValue("background-color"), "#ffffff");
assert.equal(themeAttributes.get("content"), "#ffffff");
restoreSurface();
assert.equal(rootStyle.getPropertyValue("background-color"), "rgb(245, 246, 241)");
assert.equal(bodyStyle.getPropertyValue("background-color"), "");
assert.equal(themeAttributes.get("content"), "#f5f6f1");
assert.match(recordingOverlaySource, /applySystemSurface\(document, "#ffffff"\)/);
assert.doesNotMatch(appSource, /webkitSpeechRecognition|new SpeechRecognition/);
assert.doesNotMatch(appSource, /cleanDictatedPrompt|dictation\/clean/);
assert.match(appSource, /pendingDictationAudioRef/);
assert.match(appSource, /onSend=\{\(\) => stopDictation\("send"\)\}/);
assert.match(appSource, /onCancel=\{cancelDictation\}/);
assert.match(appSource, /dictationStarting \|\| dictationRecording \|\| dictationProcessing/);
assert.match(appSource, /phase=\{dictationProcessing \|\| dictationOverlayExitRequested \? "processing" : dictationRecording \? "recording" : "starting"\}/);
assert.match(appSource, /dictationAudioMetricsRef/);
assert.match(appSource, /getByteTimeDomainData/);
const audioPrimeIndex = appSource.indexOf("const primedAudioContext = primeDictationAudioContext()");
const microphoneRequestIndex = appSource.indexOf("navigator.mediaDevices.getUserMedia", audioPrimeIndex);
const overlayOpenIndex = appSource.indexOf("setDictationStarting(true)");
const paintYieldIndex = appSource.indexOf("window.requestAnimationFrame(() => window.requestAnimationFrame", overlayOpenIndex);
assert.ok(audioPrimeIndex >= 0 && microphoneRequestIndex > audioPrimeIndex, "Web Audio must be primed before awaiting microphone access");
assert.ok(
  overlayOpenIndex >= 0 && overlayOpenIndex < audioPrimeIndex && paintYieldIndex > audioPrimeIndex && paintYieldIndex < microphoneRequestIndex,
  "the overlay must open and paint before microphone access begins"
);
assert.match(appSource, /dictationStartingRef\.current/);
assert.match(appSource, /stream\.getTracks\(\)\.forEach\(\(track\) => track\.stop\(\)\)/);
assert.match(appSource, /const accepted = await sendPrompt/);
assert.match(appSource, /if \(!accepted\) throw new Error\("Prompt could not be sent"\)/);
assert.match(appSource, /pendingDictationAudioRef\.current = pending/);
assert.match(appSource, /const attachmentsSnapshot = \[\.\.\.pendingAttachments\]/,
  "recordings must retain the files selected when the microphone started");
assert.match(appSource, /attachments: attachmentsSnapshot/);
assert.match(appSource, /\}, \[[^\]\r\n]*dictationStarting, pendingAttachments, [^\]\r\n]*resolveScrollElement/,
  "the microphone keyboard shortcut must refresh after attachments change");
assert.match(appSource, /attachmentsOverride: pending\.attachments/,
  "transcription retries must use their original chat's attachments");
assert.match(appSource, /const outgoingAttachments = options\.attachmentsOverride \?\? pendingAttachments/);
assert.match(appSource, /await uploadAttachments\(targetChatId, outgoingAttachments\)/,
  "typed and voice prompts must upload the explicit outgoing file snapshot");
assert.doesNotMatch(appSource, /options\.voiceNote \? \[\] : pendingAttachments/);
const sendPromptSource = appSource.slice(appSource.indexOf("  async function sendPrompt("), appSource.indexOf("  function sendPromptFromPointer("));
assert.equal((sendPromptSource.match(/clearSubmittedAttachments\(\);/g) ?? []).length, 2,
  "both a normal acknowledgement and a reconciled lost response must clear submitted files");
assert.match(sendPromptSource, /current\.filter\(\(attachment\) => !submittedIds\.has\(attachment\.id\)\)/,
  "acknowledgement must not clear files added later or in another chat");
assert.doesNotMatch(sendPromptSource, /setPendingAttachments\(\[\]\)|setPendingAttachments\(previousAttachments\)/,
  "an asynchronous send must never overwrite the whole current attachment list");
assert.match(recordingOverlaySource, /dictation-recording-overlay/);
assert.match(recordingOverlaySource, /role="dialog"/);
assert.match(recordingOverlaySource, /aria-modal="true"/);
assert.match(recordingOverlaySource, /aria-label="Cancel voice recording"/);
assert.match(recordingOverlaySource, /aria-label="Send voice prompt"/);
assert.match(recordingOverlaySource, /disabled=\{displayPhase !== "recording" \|\| isClosing\}/);
assert.match(recordingOverlaySource, /event\.key === "Escape"/);
assert.match(recordingOverlaySource, /setClosing\(true\)/);
assert.match(recordingOverlaySource, /window\.setTimeout\(onCancel, 460\)/);
assert.match(recordingOverlaySource, /isClosing \? " is-closing"/);
assert.match(recordingOverlaySource, /const isClosing = closing \|\| exitRequested/);
assert.match(recordingOverlaySource, /<VoiceOrb audioMetricsRef=\{audioMetricsRef\} phase=\{displayPhase\} loadAnimatedAsset=\{loadAnimatedOrb\}/);
assert.match(recordingOverlaySource, /className="dictation-recording-timer"/);
assert.match(recordingOverlaySource, /aria-hidden=\{displayPhase !== "recording"\}/);
assert.match(recordingOverlaySource, /entered \? " is-entered"/);
assert.match(recordingOverlaySource, /setEntered\(true\)/);
assert.match(recordingOverlaySource, /setEntranceSettled\(true\)/);
assert.match(recordingOverlaySource, /entranceSettled \|\| displayPhase !== "recording"/);
assert.match(recordingOverlaySource, /timerVisible \? " is-timer-visible"/);
assert.match(recordingOverlaySource, /setLoadAnimatedOrb\(true\)/);
assert.match(recordingOverlaySource, /className="dictation-visually-hidden"/);
assert.doesNotMatch(recordingOverlaySource, /dictation-recording-context|dictation-recording-copy|dictation-processing-status/);
assert.match(voiceOrbSource, /LEGACY_ORB_ASSET = "\/voice-orb-video\.gif\?v=[a-f0-9]+"/);
assert.match(voiceOrbSource, /LEGACY_ORB_POSTER_ASSET = "\/voice-orb-poster\.png\?v=[a-f0-9]+"/);
assert.match(voiceOrbThemes.water.asset, /^\/voice-orb-water-test\.gif\?v=[a-f0-9]+$/);
assert.match(voiceOrbThemes.water.poster, /^\/voice-orb-water-test-poster\.png\?v=[a-f0-9]+$/);
assert.deepEqual(Object.keys(voiceOrbThemes), ["water", "beach", "trail", "dream", "mongolia", "mojave", "cappadocia", "powder"]);
assert.equal(isVoiceOrbTheme("cappadocia"), true);
assert.match(voiceOrbThemes.cappadocia.asset, /^\/voice-orb-cappadocia-ride\.gif\?v=da06e139c7fe$/);
assert.match(voiceOrbThemes.cappadocia.poster, /^\/voice-orb-cappadocia-ride-poster\.png\?v=39178ba3052b$/);
assert.equal(isVoiceOrbTheme("retro"), false);
assert.equal(isVoiceOrbTheme("beach"), true);
assert.equal(isVoiceOrbTheme("trail"), true);
assert.equal(isVoiceOrbTheme("dream"), true);
assert.equal(isVoiceOrbTheme("mongolia"), true);
assert.equal(isVoiceOrbTheme("mojave"), true, "approved playback animation is selectable");
assert.match(voiceOrbThemes.mojave.asset, /^\/voice-orb-mojave-ride-playback\.gif\?v=8f157ee8b176$/);
assert.equal(isVoiceOrbTheme("powder"), true, "new powder animation is selectable");
assert.match(voiceOrbThemes.powder.asset, /^\/voice-orb-powder-run\.gif\?v=[a-f0-9]+$/);
assert.match(voiceOrbThemes.powder.poster, /^\/voice-orb-powder-run-poster\.png\?v=[a-f0-9]+$/);
assert.equal(isVoiceOrbTheme("random"), true);
let previousRandom = resolveVoiceOrbTheme("random");
for (let i = 0; i < 100; i++) {
  const next = resolveVoiceOrbTheme("random");
  assert.ok(next in voiceOrbThemes);
  assert.notEqual(next, previousRandom, "consecutive recordings get different GIFs");
  previousRandom = next;
}
assert.equal(resolveVoiceOrbTheme("powder"), "powder");
assert.match(voiceOrbThemes.mojave.poster, /^\/voice-orb-mojave-ride-playback-poster\.png\?v=dcccb4a3f1ce$/);
assert.equal(isVoiceOrbTheme("constructor"), false);
assert.equal(isVoiceOrbTheme(null), false);
assert.notEqual(voiceOrbThemeStorageKey("room1-square1"), voiceOrbThemeStorageKey("room2-square1"));
assert.equal(voiceOrbThemeStorageKey(""), "codex-voice-orb-theme-v1:default");
assert.equal(voiceOrbThemeStorageKey("room:1"), "codex-voice-orb-theme-v1:room%3A1");
assert.match(voiceOrbThemesSource, /localStorage\.setItem\(key, next\)/);
assert.match(voiceOrbThemesSource, /isVoiceOrbTheme\(value\) \? value : "random"/,
  "random is the default while explicit saved choices are retained");
assert.match(appSource, /useVoiceOrbTheme\(controlRoomSlotId\)/);
assert.match(appSource, /aria-label="Voice animation"/);
assert.match(appSource, /orbTheme=\{voiceOrbTheme\}/);
assert.match(recordingOverlaySource, /theme=\{orbTheme\}/);
assert.match(voiceOrbSource, /const animation = voiceOrbThemes\[theme === "random" \? randomTheme : theme\]/);
assert.match(voiceOrbSource, /loadAnimatedAsset && loadedAsset === animation\.asset/,
  "a previous GIF's load event must not hide the newly selected animation's poster");
assert.match(voiceOrbSource, /key=\{animation\.asset\}/);
for (const [themeName, width, expectedBytes] of [["beach", 576, 46_874_544], ["trail", 720, 75_533_641], ["dream", 718, 108_730_438], ["mongolia", 720, 115_158_484]] as const) {
  const theme = voiceOrbThemes[themeName];
  for (const kind of ["asset", "poster"] as const) {
    const url = new URL(theme[kind], "https://local.invalid");
    const asset = fs.readFileSync(new URL(`../public${url.pathname}`, import.meta.url));
    assert.equal(createHash("sha256").update(asset).digest("hex").slice(0, 12), url.searchParams.get("v"),
      `${theme.label} ${kind} has a content-based cache version`);
    if (kind === "asset") {
      assert.equal(asset.subarray(0, 6).toString("ascii"), "GIF89a");
      assert.equal(asset.readUInt16LE(6), width, `${theme.label} keeps its source width`);
      assert.equal(asset.readUInt16LE(8), width, `${theme.label} keeps its source height`);
      assert.equal(asset.length, expectedBytes, `${theme.label} retains the full-resolution clip`);
    } else {
      assert.equal(asset.subarray(1, 4).toString("ascii"), "PNG");
      assert.ok(asset.length < 1_000_000, `${theme.label} has a lightweight first-paint poster`);
    }
  }
}
assert.match(voiceOrbSource, /loadAnimatedAsset \?/);
assert.match(voiceOrbSource, /className=\{`voice-orb-image is-circle-crop\$\{assetLoaded/);
assert.match(voiceOrbSource, /assetLoaded \? " is-loaded"/);
assert.match(voiceOrbSource, /onLoad=\{\(\) => setLoadedAsset\(animation\.asset\)\}/);
assert.match(voiceOrbSource, /metrics\.amplitude/);
assert.match(voiceOrbSource, /metrics\.peak/);
assert.match(voiceOrbSource, /--voice-mic-scale/);
assert.match(voiceOrbSource, /\(1 \+ target \* 0\.42\)/);
assert.doesNotMatch(voiceOrbSource, /0\.94 \+ target/);
assert.doesNotMatch(voiceOrbSource, /smoothedLevel|const easing = target/);
assert.match(voiceOrbSource, /if \(phase !== "recording"\) return/);
assert.match(voiceOrbSource, /cancelAnimationFrame\(animationFrame\)/);
assert.doesNotMatch(voiceOrbSource, /three|WebGL|ShaderMaterial|UnrealBloomPass/i);
assert.equal(voiceOrbGif.subarray(0, 6).toString("ascii"), "GIF89a");
assert.ok(voiceOrbGif.length > 100_000_000, "the video-derived orb must retain its full-quality encode");
assert.equal(voiceOrbPoster.subarray(1, 4).toString("ascii"), "PNG");
assert.ok(voiceOrbPoster.length < 1_000_000, "the first-paint poster must remain lightweight");
assert.equal(waterOrbGif.subarray(0, 6).toString("ascii"), "GIF89a");
assert.equal(waterOrbGif.length, 21_666_578, "the test orb must retain the complete source animation");
assert.equal(waterOrbGif.readUInt16LE(6), 640);
assert.equal(waterOrbGif.readUInt16LE(8), 360);
assert.equal(waterOrbPoster.subarray(1, 4).toString("ascii"), "PNG");
assert.match(stylesSource, /\.voice-orb-poster\.is-circle-crop,[\s\S]*?border-radius:\s*50%;[\s\S]*?object-fit:\s*cover;/);
assert.match(stylesSource, /\.dictation-recording-overlay\s*\{[\s\S]*?position:\s*fixed;[\s\S]*?inset:\s*0;[\s\S]*?opacity:\s*0;[\s\S]*?transition:\s*opacity 440ms/);
assert.match(stylesSource, /\.voice-orb-reactor/);
assert.match(stylesSource, /\.voice-orb-image/);
assert.match(stylesSource, /@keyframes dictationOrbOpacityPulse/);
assert.match(stylesSource, /@keyframes dictationOrbStartingOpacityPulse/);
assert.match(stylesSource, /\.is-starting \.voice-orb-reactor\s*\{[\s\S]*?dictationOrbStartingOpacityPulse/);
assert.match(stylesSource, /\.is-processing \.voice-orb-reactor\s*\{[\s\S]*?dictationOrbOpacityPulse/);
assert.match(stylesSource, /\.dictation-recording-timer\s*\{[\s\S]*?position:\s*absolute;[\s\S]*?opacity:\s*0;/);
assert.match(stylesSource, /\.is-timer-visible \.dictation-recording-timer\s*\{[\s\S]*?opacity:\s*1;/);
assert.doesNotMatch(stylesSource, /\.dictation-recording-timer\s*\{[\s\S]*?translate\(-50%,\s*8px\)/);
assert.match(stylesSource, /\.dictation-recording-overlay\.is-entered\s*\{[\s\S]*?opacity:\s*1;/);
assert.match(stylesSource, /dictationOrbStartingOpacityPulse 1s ease-in-out infinite/);
assert.match(stylesSource, /dictationOrbOpacityPulse 1s ease-in-out infinite/);
assert.match(stylesSource, /@keyframes dictationOrbOpacityPulse[\s\S]*?opacity:\s*0\.08;[\s\S]*?opacity:\s*1;/);
assert.match(stylesSource, /\.dictation-recording-overlay\.is-processing/);
assert.match(stylesSource, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.dictation-recording-overlay/);
assert.match(stylesSource, /\.dictation-recording-overlay\.is-starting \.voice-orb-reactor\s*\{\s*animation: dictationOrbStartingOpacityPulse 1s ease-in-out infinite !important;/);
assert.match(stylesSource, /\.dictation-recording-overlay\.is-processing \.voice-orb-reactor\s*\{\s*animation: dictationOrbOpacityPulse 1s ease-in-out infinite !important;/);
assert.match(stylesSource, /\.dictation-recording-timer\s*\{\s*transition-duration: 320ms !important;/);
assert.match(stylesSource, /\.dictation-recording-overlay\.is-closing\s*\{[\s\S]*?opacity:\s*0;/);
assert.match(appSource, /setDictationOverlayExitRequested\(true\)[\s\S]*?setDictationProcessing\(false\)/);
assert.match(appSource, /phase=\{dictationProcessing \|\| dictationOverlayExitRequested \? "processing"/);
assert.match(appSource, /exitRequested=\{dictationOverlayExitRequested\}/);
assert.match(appSource, /metrics\.amplitude = easeMetric\(metrics\.amplitude, amplitudeTarget, 0\.4, 0\.4\)/);
assert.match(appSource, /metrics\.peak = easeMetric\(metrics\.peak, Math\.min\(1, waveformPeak \* 1\.45\), 0\.4, 0\.4\)/);
assert.match(appSource, /remainingStartingVisualMs = Math\.max\(0, 1_000 - \(performance\.now\(\) - dictationStartingVisualAt\)\)/);
assert.ok(
  appSource.indexOf("remainingStartingVisualMs") < appSource.indexOf("recorder.start()"),
  "the visible starting pulse window must complete before recording begins"
);
assert.doesNotMatch(appSource, /<audio\s+controls/);
assert.match(appSource, /className="voice-note-play-button"/);
assert.match(appSource, /className="voice-note-progress"/);
assert.match(appSource, /const attachedVoiceNote =/);
assert.match(appSource, /attachedVoiceNote \? <VoiceNotePlayer message=\{attachedVoiceNote\}/);

console.log("Audio-first contextual transcription checks passed.");
