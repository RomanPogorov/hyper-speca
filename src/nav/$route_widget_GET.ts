// GET /nav/widget?tab=…&id=… — the body of one lazy menu tile, drawn in place of its "loading…" placeholder.
/**
 * Renders the body of one widget placement of the viewer's menu tab through nav.drawWidget; used by lazy
 * widgets (Widget.lazy) so a slow external API never holds the whole menu up. Unknown tab or placement → empty.
 */
export default async function (ctx: Context, _session: Session | null, opts: { req: Request; params: Record<string, string> }): Promise<Response> {
    const url = new URL(opts.req.url);
    const tabId = url.searchParams.get("tab") ?? "";
    const id = url.searchParams.get("id") ?? "";
    const { tabs } = await ctx.fns.nav.tabs({});
    const placement = tabs.find(t => t.id === tabId)?.widgets.find(w => w.id === id);
    const html = placement ? (await ctx.fns.nav.drawWidget({ placement })).html : "";
    return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}
