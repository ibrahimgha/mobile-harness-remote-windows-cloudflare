import assert from "node:assert/strict";
import path from "node:path";
import { scopedLocalPathAllowed, scopedRequestAllowed, type SingleChatRemoteAccess } from "../server/accessTokens.js";

const access: SingleChatRemoteAccess = {
  mode: "single-chat",
  tokenId: "test",
  chatId: "selected-chat",
  chatTitle: "Data Cleaning",
  projectName: "bit68-finance",
  projectPath: path.resolve("C:/projects/bit68-finance"),
  settings: {
    model: "gpt-5.6-sol",
    reasoningEffort: "medium",
    speed: "default",
    updatedAt: new Date(0).toISOString()
  }
};

assert.equal(scopedRequestAllowed("GET", "/api/chats", access), true);
assert.equal(scopedRequestAllowed("GET", "/api/chats/selected-chat", access), true);
assert.equal(scopedRequestAllowed("POST", "/api/chats/selected-chat/prompt", access), true);
assert.equal(scopedRequestAllowed("POST", "/api/chats/selected-chat/files", access), true);
assert.equal(scopedRequestAllowed("POST", "/api/chats/selected-chat/dictation/transcribe", access), true);
assert.equal(scopedRequestAllowed("POST", "/api/chats/selected-chat/fork", access), false);
assert.equal(scopedRequestAllowed("PATCH", "/api/chats/selected-chat", access), false);
assert.equal(scopedRequestAllowed("POST", "/api/chats/selected-chat/dictation/clean", access), false);
assert.equal(scopedRequestAllowed("GET", "/api/chats/another-chat", access), false);
assert.equal(scopedRequestAllowed("PATCH", "/api/run-settings", access), false);
assert.equal(scopedRequestAllowed("POST", "/api/projects", access), false);
assert.equal(scopedRequestAllowed("GET", "/api/notifications/public-key", access), false);
assert.equal(scopedLocalPathAllowed(path.join(access.projectPath, "report.md"), access), true);
assert.equal(scopedLocalPathAllowed(path.resolve("C:/private/other-project/secret.md"), access), false);

console.log("Scoped access route and path checks passed.");
