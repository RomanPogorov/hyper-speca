// Recompile every registered stylesheet and tell open tabs to re-fetch them.
// Called after a hot-reload: a class introduced by the change is in the freshly
// built css, and the `styles` event bumps the <link> so it lands without a full
// page reload. Failures are logged, not thrown — a broken $style must not take
// dev.sync down with it.
/**
 * Perform rebuild for the styles subsystem.
 */
export default async function (ctx: Context, _session: Session | null, _opts?: {}): Promise<void> {
    // hyper-code2: one rebuild at a time. A call made while one runs only asks for one more pass
    // after it, so a burst of saves costs two rebuilds, not one Tailwind per sheet per save.
    const st = ((ctx.state.procs as any).stylesRebuild ??= { running: null, again: false }) as { running: Promise<void> | null; again: boolean };
    if (st.running) { st.again = true; return st.running; }
    st.running = (async () => {
        try {
            do {
                st.again = false;
                for (const style of ctx.state.procs?.styles ?? []) {
                    try { await ctx.fns.procs.styles.build({ abs: style.abs, key: style.key, force: true }); }
                    catch (error: any) { ctx.fns.procs.log.warn({ event: "styles.build", msg: String(error?.message ?? error) }); }
                }
                ctx.fns.procs.events.emit({ event: { type: "styles" } });
            } while (st.again);
        } finally { st.running = null; }
    })();
    return st.running;
}
