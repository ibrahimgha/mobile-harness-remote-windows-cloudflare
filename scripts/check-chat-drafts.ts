import assert from "node:assert/strict";
import fs from "node:fs";

import { chatDraftStorageKey, composerInputId, readChatDraft, writeChatDraft } from "../src/chatDrafts.js";
import { buildDictationCleanupPrompt } from "../server/dictationCleaner.js";

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

const cleanupPrompt = buildDictationCleanupPrompt({
  projectName: "Remote",
  chatTitle: "Draft test",
  rawTranscript: "fix react use effect",
  draftContext: "Do not erase this typed text",
  language: "en-US"
});
assert.match(cleanupPrompt, /vocabulary context only; do not include it in the output/i);
assert.match(cleanupPrompt, /fix react use effect/);

const appSource = fs.readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
assert.match(appSource, /id=\{composerInputId\(selectedChatId\)\}/);
assert.match(appSource, /const commitComposerEditorState[\s\S]*setDraftForChat\(chatId, text\)/);
assert.match(appSource, /onInput=[\s\S]{0,180}commitComposerEditorState\(event\.currentTarget\)/);
assert.match(appSource, /onPaste=[\s\S]{0,900}commitComposerEditorState\(event\.currentTarget, selection\)/);
assert.match(appSource, /pagehide[\s\S]*flushCustomKeyboardDraftSync/);
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
  /catch \(error\) \{[\s\S]{0,500}setDraftForChat\(targetChatId, outgoingDraft\)/,
  "failed prompt submissions restore the exact outgoing draft"
);
