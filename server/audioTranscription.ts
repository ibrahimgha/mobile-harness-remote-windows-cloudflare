import type { ChatDetail } from "./types.js";

const defaultModel = "gpt-4o-transcribe";
const maxContextCharacters = 12_000;
const maxPromptCharacters = 15_000;
const maxHumanNames = 80;
const minimumEchoComparisonCharacters = 24;

export type AudioTranscriptionContext = {
  chat: ChatDetail;
  draftContext?: string;
  configuredHumanNames?: string;
};

export type AudioTranscriptionRequest = AudioTranscriptionContext & {
  audio: Buffer;
  mimeType: string;
  language?: string;
  apiKey?: string;
  model?: string;
  timeoutMs?: number;
};

function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function truncateFromEnd(value: string, maximum: number) {
  if (value.length <= maximum) return value;
  return `[Earlier context omitted]\n${value.slice(value.length - maximum)}`;
}

function configuredNames(value = "") {
  return value
    .split(/[,;\n]+/)
    .map(normalizeWhitespace)
    .filter((name) => name.length >= 2 && name.length <= 80);
}

function inferredNames(value: string) {
  const names = new Set<string>();
  const matches = value.matchAll(/\b(?:[A-Z][\p{L}'’-]{1,30})(?:\s+[A-Z][\p{L}'’-]{1,30}){0,3}\b/gu);
  const ignored = new Set([
    "Codex", "OpenAI", "Windows", "Control Room", "ChatGPT", "GitHub", "Cloudflare", "TypeScript", "JavaScript"
  ]);

  for (const match of matches) {
    const candidate = normalizeWhitespace(match[0]);
    if (!ignored.has(candidate) && !/^(The|This|That|Please|When|Also|Make|Give|Use|Current|Recent|Running)$/i.test(candidate)) {
      names.add(candidate);
    }
    if (names.size >= maxHumanNames) break;
  }

  return [...names];
}

function normalizeComparisonText(value: string) {
  return normalizeWhitespace(value)
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function wordOverlap(left: string, right: string) {
  const leftWords = left.split(" ").filter(Boolean);
  const rightWords = right.split(" ").filter(Boolean);
  if (!leftWords.length || !rightWords.length) return 0;
  const rightCounts = new Map<string, number>();
  for (const word of rightWords) rightCounts.set(word, (rightCounts.get(word) ?? 0) + 1);
  let shared = 0;
  for (const word of leftWords) {
    const remaining = rightCounts.get(word) ?? 0;
    if (remaining > 0) {
      shared += 1;
      rightCounts.set(word, remaining - 1);
    }
  }
  return shared / Math.min(leftWords.length, rightWords.length);
}

export function transcriptEchoesAssistantResponse(text: string, chat: ChatDetail) {
  const transcript = normalizeComparisonText(text);
  if (transcript.length < minimumEchoComparisonCharacters) return false;

  return chat.messages
    .filter((message) => message.role === "assistant")
    .slice(-4)
    .some((message) => {
      const response = normalizeComparisonText(message.text);
      if (response.length < minimumEchoComparisonCharacters) return false;
      if (transcript === response) return true;
      const shorter = transcript.length <= response.length ? transcript : response;
      const longer = transcript.length > response.length ? transcript : response;
      if (shorter.length >= 48 && longer.includes(shorter) && shorter.length / longer.length >= 0.72) return true;
      return wordOverlap(transcript, response) >= 0.88;
    });
}

export function buildAudioTranscriptionPrompt(input: AudioTranscriptionContext) {
  const recentMessages = input.chat.messages
    .filter((message) => message.role === "user" || message.role === "assistant")
    .slice(-14)
    .map((message) => `${message.role === "user" ? "Human" : "Codex"}: ${normalizeWhitespace(message.text)}`)
    .join("\n");
  const boundedContext = truncateFromEnd(recentMessages, maxContextCharacters);
  const nameSource = [
    input.chat.projectName,
    input.chat.title,
    input.draftContext ?? "",
    boundedContext
  ].join("\n");
  const humanNames = [...new Set([
    ...configuredNames(input.configuredHumanNames),
    ...inferredNames(nameSource)
  ])].slice(0, maxHumanNames);
  const prompt = [
    "Transcribe this software-development dictation accurately and verbatim, adding normal punctuation and paragraph breaks.",
    "Preserve commands, URLs, file paths, identifiers, acronyms, model names, product names, and spoken human names exactly when context disambiguates them.",
    "Do not answer the speaker, summarize, censor, or add commentary. Return only the transcript.",
    humanNames.length ? `Human names and name-like terms that may be spoken: ${humanNames.join(", ")}` : "",
    `Project: ${input.chat.projectName}`,
    `Chat: ${input.chat.title}`,
    input.draftContext?.trim() ? "An unsent draft exists; preserve technical vocabulary and do not repeat or complete the draft." : "",
    "Conversation text is intentionally omitted. Never reconstruct or repeat a previous response when speech is unclear."
  ].filter(Boolean).join("\n\n");

  return {
    prompt: prompt.slice(0, maxPromptCharacters),
    humanNames
  };
}

function extensionForMimeType(mimeType: string) {
  if (/mp4|aac|m4a/i.test(mimeType)) return "m4a";
  if (/mpeg|mp3/i.test(mimeType)) return "mp3";
  if (/ogg/i.test(mimeType)) return "ogg";
  if (/wav/i.test(mimeType)) return "wav";
  return "webm";
}

export async function transcribeAudioWithOpenAI(input: AudioTranscriptionRequest) {
  const apiKey = input.apiKey?.trim() || process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured");
  if (!input.audio.byteLength) throw new Error("Audio recording is empty");

  const { prompt, humanNames } = buildAudioTranscriptionPrompt({
    chat: input.chat,
    draftContext: input.draftContext,
    configuredHumanNames: input.configuredHumanNames ?? process.env.DICTATION_HUMAN_NAMES
  });
  const form = new FormData();
  const normalizedMimeType = input.mimeType.split(";")[0]?.trim() || "audio/webm";
  form.append("file", new Blob([Uint8Array.from(input.audio)], { type: normalizedMimeType }), `dictation.${extensionForMimeType(normalizedMimeType)}`);
  form.append("model", input.model?.trim() || process.env.OPENAI_TRANSCRIPTION_MODEL?.trim() || defaultModel);
  form.append("response_format", "json");
  form.append("prompt", prompt);
  const language = input.language?.trim().toLowerCase().split(/[-_]/)[0];
  if (language && /^[a-z]{2,3}$/.test(language)) form.append("language", language);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), input.timeoutMs ?? 90_000);
  try {
    const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
      signal: controller.signal
    });
    const payload = await response.json().catch(() => null) as { text?: unknown; error?: { message?: unknown } } | null;
    if (!response.ok) {
      const message = typeof payload?.error?.message === "string" ? payload.error.message : `Transcription failed (${response.status})`;
      throw new Error(message);
    }
    const text = typeof payload?.text === "string" ? payload.text.trim() : "";
    if (!text) throw new Error("The transcription service returned no speech");
    if (transcriptEchoesAssistantResponse(text, input.chat)) {
      throw new Error("The recording was mistaken for a previous Codex response, so nothing was sent. Please record again");
    }
    return { text, humanNameCount: humanNames.length, contextLength: prompt.length };
  } finally {
    clearTimeout(timeout);
  }
}
