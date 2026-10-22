// Tiny client for the hyperd unix-socket API (used by the CLI, tests and hyper's src/hyperd).
import { homedir } from "node:os";
import { join, resolve } from "node:path";

export const hyperdHome = () => resolve(process.env.HYPERD_HOME ?? join(homedir(), ".hyper/run/hyperd"));
export const socketPath = (home = hyperdHome()) => join(home, "hyperd.sock");

export async function call(path: string, opts: { method?: string; body?: unknown; home?: string; timeoutMs?: number } = {}): Promise<any> {
    const res = await fetch(`http://hyperd${path}`, {
        unix: socketPath(opts.home),
        method: opts.method ?? (opts.body !== undefined ? "POST" : "GET"),
        headers: opts.body !== undefined ? { "content-type": "application/json" } : undefined,
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
        signal: AbortSignal.timeout(opts.timeoutMs ?? 30_000),
    } as any);
    const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    if (!res.ok) throw new Error(`hyperd ${path}: ${data?.error ?? res.status}`);
    return data;
}
