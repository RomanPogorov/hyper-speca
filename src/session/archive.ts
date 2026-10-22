/** Archive for the runtime. */
export default async function (ctx: Context, _session: Session | null, opts: {
        /** Agent identifier. */
id: string }): Promise<{ ok: boolean }> {
    const { id } = opts;
    const res = await ctx.fns.procs.db.run({ sql: 'UPDATE agents SET archived_at = ? WHERE id = ?', params: [Date.now(), id] });
    const ok = res.changes > 0;
    // An archived agent keeps nothing running or scheduled: its jobs are cancelled (unarchive does not restore them).
    if (ok) await ctx.fns.jobs.cancelAgent({ agentId: id }).catch((error: any) => console.error(`archive: cancelling jobs of ${id} failed:`, error?.message ?? error));
    if (ok) await ctx.fns.events.emitAgentsChanged({ agentId: id, reason: 'archive' });
    return { ok };
}
