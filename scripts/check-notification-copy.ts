import assert from "node:assert/strict";
import { formatJobPushNotification } from "../server/webPush";
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
