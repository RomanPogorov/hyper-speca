/**
 * Returns one background job by id: status, timing, exit code and output tail
 *
 * Use to check a job started with jobs.start or bash background:true without waiting for its completion message.
 * An agent may read jobs that report to it, that it started, or that report to its own sub-agents; people and the
 * runtime may read any.
 * @param opts.id Job id, e.g. "j0123456789".
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Job id, e.g. "j0123456789". */
        id: string;
    },
): Promise<types.jobs.Job> {
    const row = (await ctx.fns.procs.db.select({ sql: "SELECT * FROM jobs WHERE id = ?", params: [String(opts.id ?? "")] }) as any[])[0];
    if (!row) throw new Error(`jobs.get: no job ${opts.id}`);
    const caller = session?.agentId;
    if (caller && caller !== row.agent_id && row.created_by !== "agent:" + caller) {
        const parent = (await ctx.fns.procs.db.select({ sql: "SELECT parent_id FROM agents WHERE id = ?", params: [row.agent_id] }) as any[])[0];
        if (parent?.parent_id !== caller) throw new Error(`jobs.get: job ${opts.id} belongs to agent ${row.agent_id}`);
    }
    return ctx.fns.jobs.fromRow({ row });
}
