const chatDraftStoragePrefix = "codex-remote-chat-draft-v1:";

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
    }
    return true;
  } catch {
    return false;
  }
}
