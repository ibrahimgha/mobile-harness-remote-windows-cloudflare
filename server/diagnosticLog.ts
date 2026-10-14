import { createWriteStream, existsSync, statSync } from "node:fs";
import { Writable } from "node:stream";

/** Cap duplicate diagnostics, not Codex transcripts or the live protocol. */
export class DiagnosticLog extends Writable {
  private output;
  private used: number;
  private terminalBytes = 0;
  private limited = false;
  constructor(file: string, private limit = 256 * 1024) {
    super({ objectMode: true });
    this.used = existsSync(file) ? statSync(file).size : 0;
    this.output = createWriteStream(file, { flags: "a" });
    this.output.on("error", error => this.destroy(error));
  }
  _write(chunk: Buffer | string | { terminal: unknown }, _encoding: BufferEncoding, done: (error?: Error | null) => void) {
    if (typeof chunk === "string") chunk = Buffer.from(chunk);
    if (!Buffer.isBuffer(chunk)) {
      const line = JSON.stringify(chunk.terminal) + "\n";
      if (this.terminalBytes + Buffer.byteLength(line) > 16 * 1024) { done(); return; }
      this.terminalBytes += Buffer.byteLength(line); this.output.write(line, done); return;
    }
    if (this.used + chunk.length <= this.limit) {
      this.used += chunk.length; this.output.write(chunk, done); return;
    }
    if (!this.limited) {
      this.limited = true;
      this.output.write('{"type":"diagnostic_limit","message":"Diagnostic log bounded; complete chat remains in native transcript"}\n', done);
    } else done();
  }
  terminal(record: unknown) {
    this.write({ terminal: record });
  }
  get acceptingDiagnostics() { return !this.limited && this.used < this.limit; }
  _final(done: (error?: Error | null) => void) { this.output.end(done); }
}

export function compactDiagnosticRecord(line: string): string {
  try {
    const record = JSON.parse(line);
    const trim = (value: unknown, depth = 0): unknown => {
      if (typeof value === "string") return value.length > 512 ? value.slice(0, 512) + " [diagnostic excerpt]" : value;
      if (depth > 5) return "[diagnostic detail omitted]";
      if (Array.isArray(value)) return value.slice(0, 8).map(v => trim(v, depth + 1));
      if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).slice(0, 24).map(([k,v]) => [k,trim(v,depth+1)]));
      return value;
    };
    return JSON.stringify(trim(record)) + "\n";
  } catch { return JSON.stringify({type:"diagnostic_unparsed",text:line.slice(0,512)}) + "\n"; }
}
