import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { EventEmitter } from 'node:events';
export interface RpcMessage { id?: number | string; method?: string; params?: any; result?: any; error?: { code?: number; message: string } }
type Pending = { resolve: (value: any) => void; reject: (error: Error) => void; cleanup: () => void };
/** One bounded, newline-framed channel shared by the indexer and Codex adapters. */
export class JsonLineClient extends EventEmitter {
  private child: ChildProcessWithoutNullStreams;
  private buffer = '';
  private next = 1;
  private pending = new Map<number, Pending>();
  private failure?: Error;
  constructor(executable: string, args: string[], options: { cwd?: string; env?: NodeJS.ProcessEnv; log?: (line: string) => void } = {}) {
    super();
    this.child = spawn(executable, args, { cwd: options.cwd, env: options.env ?? process.env, shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    this.child.stdout.setEncoding('utf8');
    this.child.stdout.on('data', (chunk: string) => this.read(chunk));
    this.child.stderr.setEncoding('utf8');
    this.child.stderr.on('data', (chunk: string) => options.log?.(chunk.slice(0, 4000)));
    this.child.on('error', e => this.fail(e));
    this.child.stdin.on('error', e => this.fail(e));
    this.child.on('exit', (code, signal) => this.fail(new Error(`Helper exited (${signal ?? code}). Check executable and dependencies.`)));
  }
  private read(chunk: string) {
    this.buffer += chunk;
    if (this.buffer.length > 32 * 1024 * 1024) { this.fail(new Error('Helper response exceeds size limit')); this.child.kill(); return; }
    let at;
    while ((at = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, at); this.buffer = this.buffer.slice(at + 1);
      if (!line.trim()) continue;
      let message: RpcMessage;
      try { message = JSON.parse(line); } catch { this.fail(new Error('Invalid JSON from local helper')); this.child.kill(); return; }
      if (message.method) {
        if (message.id !== undefined) this.emit('request', message);
        else this.emit('notification', message);
      } else if (typeof message.id === 'number') {
        const pending = this.pending.get(message.id);
        if (pending) { this.pending.delete(message.id); pending.cleanup(); message.error ? pending.reject(new Error(message.error.message)) : pending.resolve(message.result); }
      }
    }
  }
  private fail(error: Error) {
    if (this.failure) return;
    this.failure = error;
    for (const p of this.pending.values()) { p.cleanup(); p.reject(error); }
    this.pending.clear(); this.emit('closed', error);
  }
  send(message: RpcMessage) {
    if (this.failure) throw this.failure;
    this.child.stdin.write(JSON.stringify(message) + '\n');
  }
  request<T = any>(method: string, params: unknown, options: { timeoutMs?: number; signal?: AbortSignal } = {}): Promise<T> {
    if (this.failure) return Promise.reject(this.failure);
    if (options.signal?.aborted) return Promise.reject(new Error('Request cancelled'));
    return new Promise((resolve, reject) => {
      const id = this.next++;
      const abort = () => { this.pending.delete(id); cleanup(); reject(new Error('Request cancelled')); };
      const timer = setTimeout(() => { this.pending.delete(id); cleanup(); reject(new Error(`${method} timed out`)); }, options.timeoutMs ?? 30000);
      const cleanup = () => { clearTimeout(timer); options.signal?.removeEventListener('abort', abort); };
      options.signal?.addEventListener('abort', abort, { once: true });
      this.pending.set(id, { resolve, reject, cleanup });
      try { this.send({ id, method, params }); } catch (e) { this.pending.delete(id); cleanup(); reject(e); }
    });
  }
  dispose() { this.fail(new Error('Helper closed')); this.child.stdin.end(); this.child.kill(); this.removeAllListeners(); }
}

