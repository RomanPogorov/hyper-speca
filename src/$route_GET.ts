/**
 * The home page of the person's interface: Hyper's neutral overview, or — when they chose another
 * interface (ui.provider) — a redirect to its home. `?ui=hyper` always shows Hyper's own.
 */
export default async function (ctx: Context, _session: Session | null, opts: { req: Request; params: Record<string, string> }) {
    const url = new URL(opts.req.url);
    if (url.searchParams.get("ui") !== "hyper" && opts.req.headers.get("hx-request") !== "true") {
        const ui = await ctx.fns.ui.provider({});
        if (ui.name !== "hyper" && ui.home !== "/") return new Response(null, { status: 303, headers: { location: ui.home, "cache-control": "no-store" } });
    }
    return ctx.fns.home.render({});
}
