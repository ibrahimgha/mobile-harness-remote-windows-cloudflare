import { existsSync } from "node:fs";
import { createReadStream, createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { pipeline } from "node:stream/promises";
import { createZstdDecompress } from "node:zlib";

type ArchiveRow = {
  id: string; rollout_path: string; cwd: string; title: string;
  created_at: number; updated_at: number; first_user_message: string;
  source: string; thread_source?: string;
};
const inFlight = new Map<string, Promise<string>>();
const defaultRoot = () => process.env.CODEX_SESSIONS_DIR ?? path.join(os.homedir(), ".codex", "sessions");
const canonical = (file: string) => path.resolve(file.replace(/^\\\\\?\\/, ""));

/** Read metadata only: opening the sidebar must not expand gigabytes of history. */
export function compressedSessionRows(root = defaultRoot(), database = path.join(path.dirname(root), "state_5.sqlite")): ArchiveRow[] {
  if (!existsSync(database)) return [];
  let db: DatabaseSync | undefined;
  try {
    db = new DatabaseSync(database, {readOnly:true});
    const columns = db.prepare("PRAGMA table_info(threads)").all().map(c => c.name);
    const threadSource = columns.includes("thread_source") ? "thread_source" : "NULL AS thread_source";
    const rows = db.prepare(`SELECT id, rollout_path, cwd, title, created_at, updated_at, first_user_message, source, ${threadSource} FROM threads WHERE archived = 0`).all() as unknown as ArchiveRow[];
    const prefix = canonical(root) + path.sep;
    return rows.filter(row => {
      if (typeof row.rollout_path !== "string" || typeof row.id !== "string") return false;
      const file = canonical(row.rollout_path);
      if (!file.startsWith(prefix) || !file.endsWith(`-${row.id}.jsonl`)) return false;
      if (row.thread_source?.toLowerCase() === "subagent") return false;
      try { if (JSON.parse(row.source)?.subagent) return false; } catch { /* CLI/editor source names are plain text. */ }
      return !existsSync(file) && existsSync(file + ".zst");
    }).map(row => ({...row, rollout_path:canonical(row.rollout_path)}));
  } catch {
    // Machines without a compatible local metadata database still list plain transcripts.
    return [];
  } finally { db?.close(); }
}

/** Restore only the selected transcript, atomically, without overwriting a live writer. */
export function materializeSession(file: string): Promise<string> {
  const target = file.endsWith(".zst") ? file.slice(0, -4) : file;
  const pending = inFlight.get(target);
  if (pending) return pending;
  const operation = (async () => {
    if (existsSync(target)) return target;
    const compressed = target + ".zst";
    if (!existsSync(compressed)) return target;
    const temporary = `${target}.restore-${process.pid}-${Math.random().toString(16).slice(2)}.tmp`;
    try {
      await pipeline(createReadStream(compressed), createZstdDecompress(), createWriteStream(temporary, {flags:"wx"}));
      const stat = await fs.stat(compressed);
      await fs.utimes(temporary, stat.atime, stat.mtime);
      try { await fs.link(temporary, target); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
      return target;
    } finally { await fs.rm(temporary, {force:true}); }
  })().finally(() => inFlight.delete(target));
  inFlight.set(target, operation);
  return operation;
}

export async function restoreCompressedChat(id: string): Promise<void> {
  const row = compressedSessionRows().find(row => row.id === id);
  if (row) await materializeSession(row.rollout_path);
}
