const chatDraftStoragePrefix = "codex-remote-chat-draft-v1:";
const voiceDraftStoragePrefix = "codex-remote-chat-draft-source-v1:";
export type PromptInputSource = "typed" | "voice" | "mixed";

type DraftStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function composerInputId(chatId: string | null | undefined) {
  return `chat-prompt-${chatId ? encodeURIComponent(chatId) : "none"}`;
}

export function chatDraftStorageKey(chatId: string) {
  return `${chatDraftStoragePrefix}${encodeURIComponent(chatId)}`;
}

export function readChatDraft(storage: DraftStorage, chatId: string | null | undefined) {
  if (!chatId) {
    return "";
  }

  try {
    const draft = storage.getItem(chatDraftStorageKey(chatId)) ?? "";
    return draft.trim() ? draft : "";
  } catch {
    return "";
  }
}

export function writeChatDraft(storage: DraftStorage, chatId: string, text: string) {
  try {
    if (text) {
      storage.setItem(chatDraftStorageKey(chatId), text);
    } else {
      storage.removeItem(chatDraftStorageKey(chatId));
      storage.removeItem(`${voiceDraftStoragePrefix}${encodeURIComponent(chatId)}`);
    }
    return true;
  } catch {
    return false;
  }
}

export function readChatDraftSource(storage: DraftStorage, chatId: string): PromptInputSource {
  try {
    const source = storage.getItem(`${voiceDraftStoragePrefix}${encodeURIComponent(chatId)}`);
    return source === "voice" || source === "mixed" ? source : "typed";
  } catch { return "typed"; }
}

export function writeChatDraftSource(storage: DraftStorage, chatId: string, source: PromptInputSource) {
  try {
    const key = `${voiceDraftStoragePrefix}${encodeURIComponent(chatId)}`;
    if (source === "typed") storage.removeItem(key);
    else storage.setItem(key, source);
  } catch { /* The immediate voice-send path also carries explicit provenance. */ }
}
