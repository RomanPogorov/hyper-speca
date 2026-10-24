// GET /canvas/:id/item/:itemId/frame — the sandboxed document of an html canvas tab (canvas.htmlFrame).
/** Serves an html canvas tab's page under a sandboxing CSP. */
export default async function (ctx: Context, _session: Session | null, opts: { req: Request; params: Record<string, string> }): Promise<Response> {
    const itemId = Number(opts.params.itemId);
    if (!Number.isInteger(itemId)) return new Response("invalid item id", { status: 400 });
    // ?ver=N an older saved version, ?at=n the draft right after edit n (the history drawer)
    const q = new URL(opts.req.url).searchParams;
    const v = Number(q.get("ver")) || undefined, edit = Number(q.get("at")) || undefined;
    return await ctx.fns.canvas.htmlFrame({ agentId: String(opts.params.id ?? ""), itemId, v, edit });
}
