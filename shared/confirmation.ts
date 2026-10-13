export type ConfirmationHint = { reply: string; summary: string };
export type PendingConfirmation = ConfirmationHint & {
  id: string;
  model: string;
  reasoningEffort: string;
};

const allowedReply = /^[\p{L}\p{N}][\p{L}\p{N} ,.!'’-]{0,79}$/u;
const marker = /(?:^|\n)[ \t]*<!--\s*codex-confirmation:\s*(\{[^\r\n]{1,600}?\})\s*-->[ \t]*(?=\r?\n|$)/gi;

export function splitConfirmationMetadata(raw: string): { text: string; hint?: ConfirmationHint } {
  let hint: ConfirmationHint | undefined;
  const text = raw.replace(marker, (full, json: string, offset: number) => {
    // Fenced examples describe metadata; they are not requests to the user.
    if ((raw.slice(0, offset).match(/^\s*```/gm)?.length ?? 0) % 2) return full;
    try {
      const parsed = JSON.parse(json);
      if (typeof parsed.reply === "string" && allowedReply.test(parsed.reply.trim()) && typeof parsed.summary === "string") {
        hint = { reply: parsed.reply.trim(), summary: parsed.summary.replace(/\s+/g, " ").trim().slice(0, 180) };
      }
    } catch { /* Ignore malformed metadata. */ }
    return "";
  }).trimEnd();
  return { text, hint };
}

export function detectConfirmation(raw: string, explicit?: ConfirmationHint): ConfirmationHint | undefined {
  if (explicit) return explicit;
  const parsed = splitConfirmationMetadata(raw);
  if (parsed.hint) return parsed.hint;
  const text = parsed.text.replace(/```[\s\S]*?```|~~~[\s\S]*?~~~/g, "")
    .replace(/^\s*>.*$/gm, "").replace(/<!--[^]*?-->/g, "").trim();
  const tail = text.slice(-1200);
  const quoted = tail.match(/(?:^|\n|[.!?]\s+)(?:if (?:you(?:'d| would)? like|you want|that(?:'s| is) (?:okay|ok)),?\s+)?(?:please\s+|just\s+)?(?:reply(?:\s+with)?|say|send|type)\s+["'`“‘]([^"'`”’\n]{1,80})["'`”’](?:\s+(?:to|and|if|when)\b[^.!?\n]*)?[.!?]?\s*$/i);
  if (quoted && allowedReply.test(quoted[1])) return { reply: quoted[1], summary: tail.split(/\n/).at(-1)!.slice(0, 180) };
  const question = tail.match(/(?:^|[\n.!]\s*)([^\n?]*(?:shall I|should I|may I|can I|would you like me to|do you want me to|ready for me to)[^\n?]*\?)\s*$/i);
  if (question && /\b(?:proceed|continue|go ahead|start|run|build|implement|apply|make|change|update|deploy|publish|install|restart|send|delete|remove|commit|push|merge|create|fix|do|open|move|add|enable|disable)\b/i.test(question[1]) && !/\b(?:which|what|where|when|how|or)\b/i.test(question[1])) {
    return { reply: "proceed", summary: question[1].trim().slice(0, 180) };
  }
  const request = tail.match(/(?:^|\n)([^\n]*(?:please confirm|awaiting your (?:confirmation|approval)|waiting for your (?:confirmation|approval)|need your (?:confirmation|approval))[^\n]*)\s*$/i);
  if (request && !/\b(?:whether|which|what|where|when|how|name|address|number|version)\b/i.test(request[1])) {
    return { reply: "confirmed", summary: request[1].trim().slice(0, 180) };
  }
  return undefined;
}
