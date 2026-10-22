/**
 * Sends one request to the local hyperd process supervisor over its unix socket and returns the JSON reply
 *
 * Low-level client for the hyperd control API (GET /status, /units/<name>, /units/<name>/logs, /events; POST /run, /units/<name>/start|stop|restart|input, /reload). Use the typed wrappers hyperd.status, hyperd.run, hyperd.stop, hyperd.logs and hyperd.events instead when they fit. Throws 'hyperd is not running' when the socket is missing; use hyperd.ensure to start the daemon.
 * @param opts.path API path with query string, e.g. "/units/web/logs?offset=0".
 * @param opts.method HTTP method; POST when body is given, otherwise GET.
 * @param opts.body JSON body for POST requests.
 * @param opts.timeoutMs Request timeout in milliseconds. @default 30000 @minimum 100 @maximum 120000
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** API path with query string, e.g. "/units/web/logs?offset=0". */
        path: string;
        /** HTTP method; POST when body is given, otherwise GET. */
        method?: "GET" | "POST" | "DELETE";
        /** JSON body for POST requests. */
        body?: Record<string, unknown>;
        /** Request timeout in milliseconds. @default 30000 @minimum 100 @maximum 120000 */
        timeoutMs?: number;
    },
): Promise<any> {
    const sock = (process.env.HYPERD_HOME ? process.env.HYPERD_HOME.replace(/\/$/, "") : (process.env.HOME + "/.hyper/run/hyperd")) + "/hyperd.sock";
    let res: Response;
    try {
        res = await fetch("http://hyperd" + opts.path, {
            unix: sock,
            method: opts.method ?? (opts.body !== undefined ? "POST" : "GET"),
            headers: opts.body !== undefined ? { "content-type": "application/json" } : undefined,
            body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
            signal: AbortSignal.timeout(opts.timeoutMs ?? 30_000),
        } as any);
    } catch (error: any) {
        if (/FailedToOpenSocket|ENOENT|ECONNREFUSED|Unable to connect/.test(String(error?.code ?? error?.message ?? error))) throw new Error("hyperd is not running (" + sock + ")");
        throw error;
    }
    const data: any = await res.json().catch(() => ({ error: "HTTP " + res.status }));
    if (!res.ok) throw new Error("hyperd " + opts.path + ": " + (data?.error ?? res.status));
    return data;
}
