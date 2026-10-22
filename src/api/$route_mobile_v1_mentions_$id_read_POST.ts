/** Marks one of the signed-in person's @mentions read from the native mobile client (the chat-level read marks all of a chat). */
export default async function (ctx: Context, _session: Session | null, opts: { req: Request; params: Record<string, string> }) {
    const raw = opts.params.id ?? "";
    if (!/^\d+$/.test(raw)) return Response.json({ error: "bad_request", message: "Mention id must be a number" }, { status: 400 });
    const { read } = await ctx.fns.mentions.markRead({ id: Number(raw) });
    const unread = await ctx.fns.mentions.unreadCount({});
    return Response.json({ version: 1, ok: true, id: Number(raw), read, unread });
}
