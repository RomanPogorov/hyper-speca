/**
 * Lists durable external event attachments for an agent
 *
 * Inspect active, paused, or detached external event subscriptions belonging to one agent.
 * @param opts.id Agent identifier.
 * @param opts.status Lifecycle filter. @default active
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Agent identifier. */
        id: string;
        /** Lifecycle filter. @default active */
        status?: "active" | "paused" | "detached" | "all";
    },
): Promise<any[]> {
    // Subscriptions live in jobs (runner attach): running = active, cancelled = detached.
    const status = opts.status ?? "active";
    const params: any[] = [opts.id];
    let where = "agent_id = ? AND runner = 'attach'";
    if (status === "paused") return [];
    if (status !== "all") { where += " AND status = ?"; params.push(status === "active" ? "running" : "cancelled"); }
    const rows = await ctx.fns.procs.db.select({ sql: `SELECT id, spec, prompt, status, created_at, updated_at, finished_at FROM jobs WHERE ${where} ORDER BY created_at DESC`, params }) as any[];
    return rows.map((r: any) => {
        const spec = typeof r.spec === "string" ? JSON.parse(r.spec) : r.spec ?? {};
        return { id: r.id, source: spec.source, events: spec.events ?? [], filter: spec.filter ?? {}, prompt: r.prompt, status: r.status === "running" ? "active" : "detached",
            createdAt: Number(r.created_at), updatedAt: Number(r.updated_at), detachedAt: r.finished_at == null ? null : Number(r.finished_at) };
    });
}
