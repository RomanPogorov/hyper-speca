/**
 * Lists an agent's background jobs, newest first: running ones and recently finished ones
 *
 * Use to see what is still running before starting the same command again, or to find a job id for jobs.logs or
 * jobs.cancel.
 * @param opts.agentId Agent whose jobs to list; defaults to the calling agent.
 * @param opts.status "running" (default), "finished" or "all".
 * @param opts.limit Maximum rows. @default 20
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Agent whose jobs to list; defaults to the calling agent. */
        agentId?: string;
        /** "running" (default), "finished" or "all". @default "running" */
        status?: "running" | "finished" | "all";
        /** Maximum rows. @default 20 @minimum 1 @maximum 200 */
        limit?: number;
    },
): Promise<types.jobs.Job[]> {
    const agentId = opts.agentId ?? session?.agentId;
    if (!agentId) throw new Error("jobs.list: pass agentId");
    const status = opts.status ?? "running";
    const where = status === "running" ? "AND status = 'running'" : status === "finished" ? "AND status <> 'running'" : "";
    const limit = Math.max(1, Math.min(200, Math.floor(opts.limit ?? 20)));
    const rows = await ctx.fns.procs.db.select({ sql: `SELECT * FROM jobs WHERE agent_id = ? ${where} ORDER BY created_at DESC LIMIT ?`, params: [agentId, limit] }) as any[];
    return rows.map((row) => ctx.fns.jobs.fromRow({ row }));
}
