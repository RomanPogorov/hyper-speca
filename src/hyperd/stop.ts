/**
 * Stops a hyperd unit: its stop signal to the whole process group, SIGKILL after the stop timeout
 *
 * Use to end a service, task or session run by hyperd. The unit stays registered (start it again with hyperd.call POST /units/<name>/start); a service is not restarted after an explicit stop.
 * @param opts.name Unit name.
 * @param opts.reason Recorded as lastExit.reason. @default stopped
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Unit name. */
        name: string;
        /** Recorded as lastExit.reason. @default stopped */
        reason?: string;
    },
): Promise<{ name: string; state: string }> {
    const u = await ctx.fns.hyperd.call({ path: "/units/" + encodeURIComponent(opts.name) + "/stop", body: { reason: opts.reason ?? "stopped" } });
    return { name: u.name, state: u.state };
}
