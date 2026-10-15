/** Display classification only: never modify the stored/native conversation. */
export function isInjectedInstruction(message: { role: string; text: string }): boolean {
  if (message.role !== "user") return false;
  const text = message.text.trim();
  return /^(?:#{1,6}\s*)?AGENTS\.md instructions(?:\s+for[^\r\n]*)?\s*(?:\r?\n|$)/i.test(text)
    || /^<environment_context>[\s\S]*<\/environment_context>\s*$/.test(text)
    || /^<skill>\s*<name>[\s\S]*<\/skill>\s*$/.test(text)
    || /^<turn_aborted>[\s\S]*<\/turn_aborted>\s*$/.test(text);
}

export const injectedInstructionsPreferenceKey = "codex-remote-show-injected-instructions";
export function readInjectedInstructionsPreference(storage: Pick<Storage, "getItem">): boolean {
  try { return storage.getItem(injectedInstructionsPreferenceKey) === "true"; }
  catch { return false; }
}
