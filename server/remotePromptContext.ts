export type PromptInputSource = "typed" | "voice" | "mixed";
export type RemoteSkillContext = {
  name: string;
  path: string;
  connectionFile: string;
};

const opening = '<codex_remote_context version="1">\n';
const closing = '\n</codex_remote_context>\n\n';

export function promptInputSource(value: unknown): PromptInputSource {
  return value === "voice" || value === "mixed" ? value : "typed";
}

export function withRemotePromptContext(text: string, options: { chatId: string; inputSource?: PromptInputSource; skill?: RemoteSkillContext }): string {
  if (!options.skill) return text;
  const source = options.inputSource ?? "typed";
  const metadata = JSON.stringify({ chatId: options.chatId, inputSource: source, connectionFile: options.skill.connectionFile })
    .replace(/</g, "\\u003c").replace(/>/g, "\\u003e");
  const origin = source === "typed"
    ? "This is typed input."
    : "This prompt includes a voice recording transcribed to text. Interpret plausible transcription errors and names using the conversation and workspace while preserving the user's intended request.";
  return `${opening}Use $${options.skill.name} for this Codex Remote conversation.\n${origin}\n${metadata}${closing}${text}`;
}

/** Strip our exact transport preamble for display and original-prompt matching. */
export function stripRemotePromptContext(text: string): string {
  const normalized = text.replace(/\r\n/g, "\n");
  if (!normalized.startsWith(opening)) return text;
  const end = normalized.indexOf(closing, opening.length);
  return end >= 0 && end < 16_384 ? normalized.slice(end + closing.length) : text;
}
