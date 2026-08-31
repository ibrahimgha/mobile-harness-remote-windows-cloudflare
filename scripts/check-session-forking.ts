import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { streamForkSessionFile } from "../server/sessionForker.js";

const oldId = "63d9be59-dd30-48ae-afcd-e5ca93ee53ab";
const newId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const nowIso = "2026-08-31T12:30:00.000Z";
const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-session-fork-test-"));
const sourcePath = path.join(tempDir, "source.jsonl");
const targetPath = path.join(tempDir, "target.jsonl");

try {
  const meta = JSON.stringify({
    timestamp: "2026-08-27T20:49:38.535Z",
    type: "session_meta",
    payload: { id: oldId, timestamp: "2026-08-27T20:49:38.535Z", source: "cli" }
  });
  const bytesBeforeBoundary = 1024 * 1024 - Buffer.byteLength(`${meta}\n`) - 12;
  const largeEvent = `${"x".repeat(bytesBeforeBoundary)}${oldId}${"y".repeat(1024 * 1024 + 31)}`;
  await fs.writeFile(sourcePath, `${meta}\n${largeEvent}\n`, "utf8");

  const marker = `${JSON.stringify({
    timestamp: nowIso,
    type: "event_msg",
    payload: { type: "chat_forked", source_chat_id: oldId, source_title: "Dispatching" }
  })}\n`;
  await streamForkSessionFile(sourcePath, targetPath, oldId, newId, nowIso, marker);

  const output = await fs.readFile(targetPath, "utf8");
  const lines = output.trimEnd().split("\n");
  const rewrittenMeta = JSON.parse(lines[0]);
  const forkMarker = JSON.parse(lines.at(-1) ?? "{}");

  assert.equal(rewrittenMeta.payload.id, newId);
  assert.equal(rewrittenMeta.timestamp, nowIso);
  assert.equal(rewrittenMeta.payload.source, "vscode");
  assert.match(lines[1], new RegExp(newId));
  assert.doesNotMatch(lines[1], new RegExp(oldId));
  assert.equal(forkMarker.payload.type, "chat_forked");
  assert.equal(forkMarker.payload.source_chat_id, oldId);
  assert.ok((await fs.stat(targetPath)).size > 2 * 1024 * 1024);
} finally {
  await fs.rm(tempDir, { recursive: true, force: true });
}

console.log("Streaming session fork checks passed.");
