// Rebuild the route table from scratch and swap it in. Not a second collector
// any more: it scans, hands each kind to its loader out of the same table
// everything else uses, and only owns the two things a loader cannot — that the
// rebuild starts empty (a deleted file must leave no handler behind) and that
// the swap is atomic (a request mid-rebuild must not see a half-built table).
/**
 * Perform load routes for the http subsystem.
 * @param opts.strict The strict value used by the operation.
 */
export default async function (ctx: Context, _session: Session | null, opts: { strict?: boolean } = {}) {
    // A rebuild rescans; a production bundle has no filesystem to scan, so it
    // reuses the list boot.apply was given.
    const entries = ctx.env.NODE_ENV === "production"
        ? (ctx.state as any).procs?.boot?.entries ?? []
        : await ctx.fns.procs.project.scan({});
    const loaders = (ctx.state as any).procs?.boot?.loaders ?? {};

    // A derived ctx with empty tables: the loaders write into it exactly as they
    // do at boot, and the running server keeps serving the old ones meanwhile.
    const draft: any = Object.create(ctx);
    draft.state = {
        ...ctx.state,
        procs: { ...ctx.state.procs, http: { ...ctx.state.procs.http, routes: {}, middleware: [] }, styles: [] },
    };

    for (const kind of ["route", "ws", "middleware", "script", "style"]) {
        const loader = loaders[kind];
        const mine = entries.filter((e: any) => e.kind === kind);
        if (!loader || !mine.length) continue;
        try {
            await loader(draft, null, { entries: mine });
        } catch (error: any) {
            const message = `[$loader ${kind}] ${error?.message ?? error}`;
            console.error(message);
            if (opts.strict) throw new Error(message);
        }
    }

    // hyper-code2: a rescan keeps what this run already compiled. The fresh records came back
    // unbuilt, so the next page load started one Tailwind per sheet at once (11, load 110) after
    // every route or script save; `styles.rebuild` is what recompiles after a change.
    const previous = new Map((ctx.state.procs.styles ?? []).map((s: any) => [s.key, s]));
    for (const style of draft.state.procs.styles) {
        const built = (previous.get(style.key) as any)?.built;
        if (built) style.built = built;
    }
    ctx.state.procs.styles = draft.state.procs.styles;
    ctx.state.procs.http.middleware = draft.state.procs.http.middleware;
    ctx.state.procs.http.routes = draft.state.procs.http.routes;
    return ctx.state.procs?.http.routes;
}
