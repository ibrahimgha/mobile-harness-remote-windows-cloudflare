import assert from "node:assert/strict";
import fs from "node:fs";

import { chatDraftStorageKey, composerInputId, readChatDraft, writeChatDraft } from "../src/chatDrafts.js";

const values = new Map<string, string>();
const storage = {
  getItem(key: string) {
    return values.get(key) ?? null;
  },
  setItem(key: string, value: string) {
    values.set(key, value);
  },
  removeItem(key: string) {
    values.delete(key);
  }
};

const chatA = "chat/a";
const chatB = "chat:b";

assert.notEqual(composerInputId(chatA), composerInputId(chatB));
assert.notEqual(chatDraftStorageKey(chatA), chatDraftStorageKey(chatB));
assert.equal(writeChatDraft(storage, chatA, "Typed for A"), true);
assert.equal(writeChatDraft(storage, chatB, "Typed for B"), true);
assert.equal(readChatDraft(storage, chatA), "Typed for A");
assert.equal(readChatDraft(storage, chatB), "Typed for B");
writeChatDraft(storage, chatA, "");
assert.equal(readChatDraft(storage, chatA), "");
assert.equal(readChatDraft(storage, chatB), "Typed for B");
values.set(chatDraftStorageKey(chatA), "\n");
assert.equal(readChatDraft(storage, chatA), "");

const appSource = fs.readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
assert.match(appSource, /id=\{composerInputId\(selectedChatId\)\}/);
assert.match(appSource, /const commitComposerEditorState[\s\S]*setDraftForChat\(chatId, text\)/);
assert.match(appSource, /onInput=[\s\S]{0,180}commitComposerEditorState\(event\.currentTarget\)/);
assert.match(appSource, /onPaste=[\s\S]{0,1200}commitComposerEditorState\(event\.currentTarget, selection\)/);
assert.match(appSource, /onPaste=[\s\S]{0,300}clipboardAttachmentFiles\(event\.clipboardData\)/);
assert.match(appSource, /pastedFiles\.length > 0[\s\S]{0,180}addAttachments\(pastedFiles\)/);
assert.match(appSource, /const attachComposerEditor = useCallback[\s\S]*syncComposerEditorText\(editor, latestDraftRef\.current\)/);
assert.match(appSource, /ref=\{attachComposerEditor\}/);
assert.match(appSource, /preserveDraft:\s*true/);
assert.doesNotMatch(appSource, /setDraft\(cleaned\)/);
const sendPromptSource = appSource.slice(
  appSource.indexOf("async function sendPrompt("),
  appSource.indexOf("function sendPromptFromPointer")
);
const immediateClearIndex = sendPromptSource.indexOf("setDraftsByChat((current)");
const submitRequestIndex = sendPromptSource.indexOf("apiFetch<PromptSubmitResult>");
assert.ok(immediateClearIndex >= 0 && immediateClearIndex < submitRequestIndex, "typed prompts clear from the composer before waiting for server acknowledgement");
const persistedClearIndex = sendPromptSource.indexOf('setDraftForChat(targetChatId, "")');
assert.ok(persistedClearIndex > submitRequestIndex, "persisted drafts remain recoverable until the server acknowledges the prompt");
assert.match(
  sendPromptSource,
  /body: JSON\.stringify\(\{ text: promptText, clientRequestId \}\)/,
  "prompt submissions must carry an idempotent client request ID"
);
const reconcileIndex = sendPromptSource.indexOf("job.clientRequestId === clientRequestId");
const restoreIndex = sendPromptSource.indexOf("setDraftForChat(targetChatId, outgoingDraft)");
assert.ok(reconcileIndex > submitRequestIndex, "failed acknowledgements must be reconciled against server jobs");
assert.ok(restoreIndex > reconcileIndex, "the outgoing draft must only be restored after acceptance reconciliation fails");
assert.doesNotMatch(sendPromptSource, /flushCustomKeyboard|pendingCustomKeyboardDraftRef/);
