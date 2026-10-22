/**
 * Starts a registered hyperd unit (a service from ~/.hyper/units or a stopped transient unit)
 *
 * Use to bring up a service or rerun a task that hyperd already knows. Units with after wait until their dependencies are ready. To add a new service, write a unit file to ~/.hyper/units/<name>.yaml and call hyperd.reload first.
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
    const u = await ctx.fns.hyperd.call({ path: "/units/" + encodeURIComponent(opts.name) + "/start", body: {} });
    return { name: u.name, state: u.state, run: u.run };
}
