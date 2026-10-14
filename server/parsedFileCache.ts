/** Bounded, concurrent-request-coalescing cache. Signatures must include file
 * identity and every parse option; callers still stat files on every request. */
export class ParsedFileCache<T> {
  private entries = new Map<string, { signature: string; value: Promise<T>; bytes: number }>();
  private bytes = 0;
  hits = 0;
  misses = 0;
  constructor(private maxEntries = 320, private maxBytes = 64 * 1024 * 1024) {}
  async get(key: string, signature: string, load: () => Promise<T>): Promise<T> {
    const cached = this.entries.get(key);
    if (cached?.signature === signature) {
      this.hits++;
      this.entries.delete(key); this.entries.set(key, cached);
      return cached.value;
    }
    this.misses++;
    if (cached) { this.bytes -= cached.bytes; this.entries.delete(key); }
    const entry = { signature, value: Promise.resolve().then(load), bytes: 0 };
    this.entries.set(key, entry);
    try {
      const result = await entry.value;
      if (this.entries.get(key) === entry) {
        entry.bytes = Buffer.byteLength(JSON.stringify(result) ?? "null", "utf8");
        this.bytes += entry.bytes;
        while (this.entries.size > this.maxEntries || this.bytes > this.maxBytes) {
          const oldest = this.entries.keys().next().value!;
          this.bytes -= this.entries.get(oldest)!.bytes; this.entries.delete(oldest);
        }
      }
      return result;
    } catch (error) {
      if (this.entries.get(key) === entry) this.entries.delete(key);
      throw error;
    }
  }
}
