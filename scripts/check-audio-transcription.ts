import assert from "node:assert/strict";
import fs from "node:fs";
import { buildAudioTranscriptionPrompt, transcriptEchoesAssistantResponse } from "../server/audioTranscription.js";
import type { ChatDetail } from "../server/types.js";

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
const stylesSource = fs.readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
const voiceOrbGif = fs.readFileSync(new URL("../public/voice-orb-video.gif", import.meta.url));
const voiceOrbPoster = fs.readFileSync(new URL("../public/voice-orb-poster.png", import.meta.url));
const waterOrbGif = fs.readFileSync(new URL("../public/voice-orb-water-test.gif", import.meta.url));
const waterOrbPoster = fs.readFileSync(new URL("../public/voice-orb-water-test-poster.png", import.meta.url));
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
assert.match(voiceOrbSource, /ORB_ASSET = "\/voice-orb-water-test\.gif\?v=[a-f0-9]+"/);
assert.match(voiceOrbSource, /ORB_POSTER_ASSET = "\/voice-orb-water-test-poster\.png\?v=[a-f0-9]+"/);
assert.match(voiceOrbSource, /loadAnimatedAsset \?/);
assert.match(voiceOrbSource, /className=\{`voice-orb-image is-circle-crop\$\{assetLoaded/);
assert.match(voiceOrbSource, /assetLoaded \? " is-loaded"/);
assert.match(voiceOrbSource, /onLoad=\{\(\) => setAssetLoaded\(true\)\}/);
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
