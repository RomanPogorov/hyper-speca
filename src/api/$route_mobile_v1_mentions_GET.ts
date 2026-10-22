/**
 * Lists the signed-in person's @mentions for the native mobile client, newest first: who, which chat, the excerpt and when,
 * plus the unread total for the badge. Query: unreadOnly=true|false (default true), limit 1..200 (default 50).
 * Open a mention with GET agents/:agentId/events?aroundMessageIdx=<messageIdx>.
 */
export default async function (ctx: Context, _session: Session | null, opts: { req: Request; params: Record<string, string> }) {
    const url = new URL(opts.req.url);
    const unreadOnly = url.searchParams.get("unreadOnly") !== "false";
    const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit") ?? 50) || 50));
    const [mentions, unread] = await Promise.all([
        ctx.fns.mentions.list({ unreadOnly, limit }),
        ctx.fns.mentions.unreadCount({}),
    ]);
    const authors = new Map<string, Awaited<ReturnType<typeof ctx.fns.auth.author>>>();
    for (const m of mentions) {
        if (m.from && !authors.has(m.from)) authors.set(m.from, await ctx.fns.auth.author({ userId: m.from }));
    }
    return Response.json({
        version: 1,
        unread,
        mentions: mentions.map((m) => ({
            ...m,
            author: m.from ? authors.get(m.from) ?? null : null,
            fromAgent: m.from?.startsWith("agent:") ? m.from.slice("agent:".length) : null,
        })),
    });
}
