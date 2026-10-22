/**
 * Restarts a hyperd unit: stops the current run, waits for it to exit and starts it again
 *
 * Use after changing a service's code or unit file (call hyperd.reload first for file changes). Returns once the new run is started; wait for state ready with hyperd.status.
 * @param opts.name Unit name, as in hyperd.status.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Unit name, as in hyperd.status. */
        name: string;
    },
): Promise<{ name: string; state: string; run: number }> {
    const u = await ctx.fns.hyperd.call({ path: "/units/" + encodeURIComponent(opts.name) + "/restart", body: {}, timeoutMs: 120_000 });
    return { name: u.name, state: u.state, run: u.run };
}
