/** Handles the HTTP route agent :id wake-timer GET endpoint. */
export default async function (ctx: Context, _session: Session | null, opts: {
        /** Route parameters captured from the request path. */ params: Record<string, string> }) {
    const agent = await ctx.fns.session.load({ id: opts.params.id! });
    if (!agent) return new Response('not found', { status: 404 });
    // The nearest pending wake-up / schedule of the agent (jobs table).
    const next = (await ctx.fns.procs.db.select({ sql: "SELECT MIN(next_at) AS at FROM jobs WHERE agent_id = ? AND status = 'running' AND runner IN ('at','cron')", params: [agent.id] }) as any[])[0];
    return new Response(ctx.fns.ui.wakeTimer({ agent: { ...agent, wakeAt: next?.at == null ? null : Number(next.at) } }), { headers: { 'content-type': 'text/html; charset=utf-8' } });
}
