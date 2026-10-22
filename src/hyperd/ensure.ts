/**
 * Starts the local hyperd daemon detached when it is not already running and returns its health
 *
 * Use before handing work to hyperd from this server (the jobs runner calls it). Spawns `bun hyperd/main.ts` from the code repo in its own session, so it outlives this server; a running daemon is left alone. In production hyperd is meant to be started by launchd/systemd; this is the fallback.
 * @param opts.waitMs How long to wait for the socket to answer after spawning. @default 5000 @minimum 100 @maximum 30000
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** How long to wait for the socket to answer after spawning. @default 5000 @minimum 100 @maximum 30000 */
        waitMs?: number;
    },
): Promise<{ ok: boolean; pid: number; seq: number; units: number; started: boolean }> {
    try { const h = await ctx.fns.hyperd.call({ path: "/health", timeoutMs: 2000 }); return { ...h, started: false }; } catch (error: any) { if (!/not running/.test(String(error?.message))) throw error; }
    const root = String((ctx.state as any).root ?? process.cwd());
    const p = Bun.spawn(["bun", root + "/hyperd/main.ts"], { cwd: root, detached: true, stdio: ["ignore", "ignore", "ignore"], env: { ...process.env } } as any);
    p.unref();
    const until = Date.now() + (opts.waitMs ?? 5000);
    for (;;) {
        await Bun.sleep(150);
        try { const h = await ctx.fns.hyperd.call({ path: "/health", timeoutMs: 1000 }); return { ...h, started: true }; }
        catch (error: any) { if (Date.now() > until) throw new Error("hyperd did not come up: " + String(error?.message ?? error)); }
    }
}
