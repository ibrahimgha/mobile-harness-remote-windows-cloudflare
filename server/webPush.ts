import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import webPush, { type PushSubscription } from "web-push";
import { clearSessionCache, getChat } from "./codexSessions.js";
import type { CodexRunJob } from "./types.js";

type StoredPushSubscription = {
  id: string;
  subscription: PushSubscription;
  createdAt: string;
  updatedAt: string;
  userAgent?: string;
};

type SendResult = {
  attempted: number;
  sent: number;
  removed: number;
  failed: number;
  failures?: PushFailure[];
};

type PushFailure = {
  subscriptionId: string;
  endpointHost: string;
  statusCode?: number;
  message: string;
  body?: string;
};

const runtimeDir = path.resolve(process.cwd(), ".runtime");
const subscriptionsPath = path.join(runtimeDir, "web-push-subscriptions.json");
const vapidPath = path.join(runtimeDir, "web-push-vapid.json");
const vapidSubject = process.env.WEB_PUSH_SUBJECT?.trim() || "mailto:codex-remote@bit68-infra.com";
const maxNotificationSummaryWords = 10;

let vapidReady: Promise<{ publicKey: string; privateKey: string }> | null = null;

function subscriptionId(endpoint: string): string {
  return createHash("sha256").update(endpoint).digest("hex").slice(0, 24);
}

function isMissingFileError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function normalizeSubscription(input: unknown): PushSubscription {
  const candidate = input as {
    endpoint?: unknown;
    expirationTime?: unknown;
    keys?: {
      p256dh?: unknown;
      auth?: unknown;
    };
  };

  if (
    !candidate ||
    typeof candidate.endpoint !== "string" ||
    !candidate.endpoint.startsWith("https://") ||
    !candidate.keys ||
    typeof candidate.keys.p256dh !== "string" ||
    typeof candidate.keys.auth !== "string"
  ) {
    throw new Error("Invalid push subscription");
  }

  return {
    endpoint: candidate.endpoint,
    expirationTime: typeof candidate.expirationTime === "number" ? candidate.expirationTime : null,
    keys: {
      p256dh: candidate.keys.p256dh,
      auth: candidate.keys.auth
    }
  };
}

async function ensureVapidKeys(): Promise<{ publicKey: string; privateKey: string }> {
  if (vapidReady) {
    return vapidReady;
  }

  vapidReady = (async () => {
    const envPublicKey = process.env.WEB_PUSH_PUBLIC_KEY?.trim();
    const envPrivateKey = process.env.WEB_PUSH_PRIVATE_KEY?.trim();

    if (envPublicKey && envPrivateKey) {
      webPush.setVapidDetails(vapidSubject, envPublicKey, envPrivateKey);
      return { publicKey: envPublicKey, privateKey: envPrivateKey };
    }

    await fs.mkdir(runtimeDir, { recursive: true });

    try {
      const saved = JSON.parse(await fs.readFile(vapidPath, "utf8")) as {
        publicKey?: unknown;
        privateKey?: unknown;
      };

      if (typeof saved.publicKey === "string" && typeof saved.privateKey === "string") {
        webPush.setVapidDetails(vapidSubject, saved.publicKey, saved.privateKey);
        return { publicKey: saved.publicKey, privateKey: saved.privateKey };
      }
    } catch (error) {
      if (!isMissingFileError(error)) {
        throw error;
      }
    }

    const generated = webPush.generateVAPIDKeys();
    await fs.writeFile(vapidPath, `${JSON.stringify(generated, null, 2)}\n`, "utf8");
    webPush.setVapidDetails(vapidSubject, generated.publicKey, generated.privateKey);
    return generated;
  })();

  return vapidReady;
}

async function readSubscriptions(): Promise<StoredPushSubscription[]> {
  try {
    const parsed = JSON.parse(await fs.readFile(subscriptionsPath, "utf8")) as unknown;

    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter((item): item is StoredPushSubscription => {
      const candidate = item as StoredPushSubscription;
      return Boolean(candidate?.id && candidate.subscription?.endpoint);
    });
  } catch (error) {
    if (isMissingFileError(error)) {
      return [];
    }

    throw error;
  }
}

async function writeSubscriptions(subscriptions: StoredPushSubscription[]): Promise<void> {
  await fs.mkdir(runtimeDir, { recursive: true });
  await fs.writeFile(subscriptionsPath, `${JSON.stringify(subscriptions, null, 2)}\n`, "utf8");
}

export async function getPushPublicKey(): Promise<string> {
  return (await ensureVapidKeys()).publicKey;
}

export async function savePushSubscription(input: unknown, userAgent?: string): Promise<StoredPushSubscription> {
  await ensureVapidKeys();

  const subscription = normalizeSubscription(input);
  const id = subscriptionId(subscription.endpoint);
  const now = new Date().toISOString();
  const subscriptions = await readSubscriptions();
  const existingIndex = subscriptions.findIndex((item) => item.id === id);
  const stored: StoredPushSubscription = {
    id,
    subscription,
    createdAt: existingIndex >= 0 ? subscriptions[existingIndex].createdAt : now,
    updatedAt: now,
    userAgent
  };

  if (existingIndex >= 0) {
    subscriptions[existingIndex] = stored;
  } else {
    subscriptions.push(stored);
  }

  await writeSubscriptions(subscriptions);
  return stored;
}

export async function removePushSubscription(endpoint: unknown): Promise<boolean> {
  if (typeof endpoint !== "string" || !endpoint) {
    return false;
  }

  const id = subscriptionId(endpoint);
  const subscriptions = await readSubscriptions();
  const next = subscriptions.filter((item) => item.id !== id);

  if (next.length === subscriptions.length) {
    return false;
  }

  await writeSubscriptions(next);
  return true;
}

export async function countPushSubscriptions(): Promise<number> {
  return (await readSubscriptions()).length;
}

async function sendPushPayload(payload: Record<string, unknown>): Promise<SendResult> {
  await ensureVapidKeys();

  const subscriptions = await readSubscriptions();
  const staleIds = new Set<string>();
  const failures: PushFailure[] = [];
  let sent = 0;
  let failed = 0;

  await Promise.all(
    subscriptions.map(async (item) => {
      try {
        await webPush.sendNotification(item.subscription, JSON.stringify(payload), {
          TTL: 60 * 60,
          urgency: "normal"
        });
        sent += 1;
      } catch (error) {
        const statusCode =
          typeof error === "object" && error !== null && "statusCode" in error ? Number(error.statusCode) : 0;
        const body =
          typeof error === "object" && error !== null && "body" in error && typeof error.body === "string"
            ? error.body.slice(0, 500)
            : undefined;
        const message = error instanceof Error ? error.message : "Push provider rejected notification";
        let endpointHost = "unknown";

        try {
          endpointHost = new URL(item.subscription.endpoint).host;
        } catch {
          endpointHost = "invalid-endpoint";
        }

        if (statusCode === 404 || statusCode === 410) {
          staleIds.add(item.id);
          return;
        }

        failed += 1;
        failures.push({
          subscriptionId: item.id,
          endpointHost,
          statusCode: Number.isFinite(statusCode) && statusCode > 0 ? statusCode : undefined,
          message,
          body
        });
      }
    })
  );

  if (staleIds.size) {
    await writeSubscriptions(subscriptions.filter((item) => !staleIds.has(item.id)));
  }

  return {
    attempted: subscriptions.length,
    sent,
    removed: staleIds.size,
    failed,
    failures: failures.length ? failures : undefined
  };
}

export async function sendTestPushNotification(): Promise<SendResult> {
  return sendPushPayload({
    title: "Codex notifications are on",
    body: "You will get a notification when a remote Codex run finishes.",
    tag: "codex-remote-test",
    url: "/",
    icon: "/icon-192.png",
    badge: "/apple-touch-icon.png"
  });
}

function summarizeResponseForNotification(text: string): string {
  const normalized = text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[[^\]]*]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)]\([^)]*\)/g, "$1")
    .replace(/[#>*_~|[\]()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!normalized) {
    return "Response unavailable";
  }

  const words = normalized.split(" ").filter(Boolean);
  const summary = words.slice(0, maxNotificationSummaryWords).join(" ");

  return words.length > maxNotificationSummaryWords ? `${summary}...` : summary;
}

function isUsefulSummary(summary: string): boolean {
  return Boolean(summary && !/^response unavailable$/i.test(summary) && !/^run failed before response$/i.test(summary));
}

async function readTranscriptResponseSummary(job: CodexRunJob): Promise<string | null> {
  try {
    clearSessionCache();
    const chat = await getChat(job.chatId);
    const response = chat?.lastResponse?.text;

    if (!response) {
      return null;
    }

    const summary = summarizeResponseForNotification(response);
    return isUsefulSummary(summary) ? summary : null;
  } catch {
    return null;
  }
}

async function readLastMessageSummary(job: CodexRunJob): Promise<string | null> {
  try {
    const response = await fs.readFile(job.logPaths.lastMessage, "utf8");
    const summary = summarizeResponseForNotification(response);
    return isUsefulSummary(summary) ? summary : null;
  } catch {
    return null;
  }
}

export async function sendJobPushNotification(job: CodexRunJob, event: "completed" | "failed"): Promise<SendResult> {
  const title = event === "completed" ? "Codex finished" : "Codex failed";
  const responseSummary = (await readTranscriptResponseSummary(job)) ?? (await readLastMessageSummary(job));
  const body =
    responseSummary ??
    (event === "failed"
      ? summarizeResponseForNotification(job.message ?? "Run failed before response")
      : "Response unavailable");

  return sendPushPayload({
    title,
    body,
    tag: `codex-job-${job.id}`,
    url: "/",
    icon: "/icon-192.png",
    badge: "/apple-touch-icon.png",
    jobId: job.id,
    chatId: job.chatId,
    status: job.status
  });
}
