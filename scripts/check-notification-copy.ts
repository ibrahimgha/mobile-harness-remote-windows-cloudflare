import assert from "node:assert/strict";
import fs from "node:fs";
import { chatDeepLink, formatJobPushNotification } from "../server/webPush";
import type { CodexRunJob } from "../server/types";

const job = {
  chatId: "chat-12345678",
  projectPath: "C:\\Projects\\Fallback project",
  promptPreview: "Fallback chat"
} as CodexRunJob;

assert.deepEqual(
  formatJobPushNotification(job, "completed", {
    projectName: "mobile-harness-remote-windows-cloudflare",
    chatName: "Codex Remote"
  }),
  {
    title: "mobile-harness-remote-windows-cloudflare",
    body: "Codex Remote · Done"
  }
);

assert.equal(chatDeepLink("chat/id with spaces"), "/?chat=chat%2Fid%20with%20spaces", "notification links safely encode the target chat");
const pushSource = fs.readFileSync(new URL("../server/webPush.ts", import.meta.url), "utf8");
const workerSource = fs.readFileSync(new URL("../public/sw.js", import.meta.url), "utf8");
const appSource = fs.readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
assert.match(pushSource, /url: chatDeepLink\(job\.chatId\)/, "job push payloads deep-link the completed chat");
assert.match(workerSource, /sameOriginClient\.navigate\(targetUrl\)/, "notification clicks navigate an existing app window to the deep link");
assert.match(workerSource, /client\.url === targetUrl/, "notification clicks prefer an already-open exact target");
assert.match(appSource, /notificationChatId[\s\S]{0,220}getCachedChatHistory\(notificationChatId\)/, "the app selects a chat supplied by a notification deep link");

assert.deepEqual(formatJobPushNotification(job, "failed", {}), {
  title: "Fallback project",
  body: "Fallback chat · Failed"
});

assert.deepEqual(
  formatJobPushNotification({ ...job, projectPath: "/var/www/Fallback project" }, "failed", {}),
  {
    title: "Fallback project",
    body: "Fallback chat · Failed"
  }
);
