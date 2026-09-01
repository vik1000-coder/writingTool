export interface CompletionSnapshot {
  scope: string;
  uri: string;
  before: string;
  after: string;
  /** Hash of an explicitly highlighted manuscript passage, when present. */
  focus?: string;
}
interface Entry<T> extends CompletionSnapshot {
  insertText: string;
  data: T;
  created: number;
  bytes: number;
}

/** Session memory only. Matches the entire surrounding document, never a fuzzy
 * semantic similarity. The caller must revalidate evidence before displaying. */
export class CompletionCache<T> {
  private entries = new Map<number, Entry<T>>();
  private serial = 0;
  private usedBytes = 0;
  private now: () => number;
  constructor(
    private options: {
      ttlMs?: number;
      maxEntries?: number;
      maxBytes?: number;
      now?: () => number;
    } = {},
  ) {
    this.now = options.now ?? Date.now;
  }
  get size() {
    this.pruneExpired();
    return this.entries.size;
  }
  get bytes() {
    this.pruneExpired();
    return this.usedBytes;
  }
  clear() {
    this.entries.clear();
    this.usedBytes = 0;
  }
  private remove(id: number) {
    this.usedBytes -= this.entries.get(id)?.bytes ?? 0;
    this.entries.delete(id);
  }
  private pruneExpired() {
    const now = this.now(),
      ttl = this.options.ttlMs ?? 120000;
    for (const [id, entry] of this.entries)
      if (now - entry.created >= ttl) this.remove(id);
  }
  put(snapshot: CompletionSnapshot, insertText: string, data: T) {
    if (!insertText) return;
    this.pruneExpired();
    for (const [id, e] of this.entries)
      if (
        e.scope === snapshot.scope &&
        e.uri === snapshot.uri &&
        e.focus === snapshot.focus &&
        e.before === snapshot.before &&
        e.after === snapshot.after
      )
        this.remove(id);
    const bytes = Buffer.byteLength(
      JSON.stringify({ snapshot, insertText, data }),
      "utf8",
    );
    if (bytes > (this.options.maxBytes ?? 2 * 1024 * 1024)) return;
    this.entries.set(++this.serial, {
      ...snapshot,
      insertText,
      data: structuredClone(data),
      created: this.now(),
      bytes,
    });
    this.usedBytes += bytes;
    while (
      this.size > (this.options.maxEntries ?? 32) ||
      this.bytes > (this.options.maxBytes ?? 2 * 1024 * 1024)
    )
      this.remove(this.entries.keys().next().value!);
  }
  find(snapshot: CompletionSnapshot) {
    this.pruneExpired();
    for (const [id, e] of [...this.entries].reverse()) {
      const ageMs = this.now() - e.created;
      if (
        e.scope !== snapshot.scope ||
        e.uri !== snapshot.uri ||
        e.focus !== snapshot.focus ||
        e.after !== snapshot.after ||
        !snapshot.before.startsWith(e.before)
      )
        continue;
      const consumed = snapshot.before.slice(e.before.length);
      if (
        !e.insertText.startsWith(consumed) ||
        consumed.length === e.insertText.length
      )
        continue;
      this.entries.delete(id);
      this.entries.set(id, e);
      return {
        remaining: e.insertText.slice(consumed.length),
        consumed: consumed.length,
        ageMs,
        data: structuredClone(e.data),
      };
    }
    return undefined;
  }
}
