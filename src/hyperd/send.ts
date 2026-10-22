/**
 * Writes text to the input of a running hyperd unit, e.g. a command into a terminal session
 *
 * Use for interactive programs started with pty (kind session or pty: true). Add \n to press Enter; \u0003 is Ctrl-C. Read the reaction with hyperd.logs.
 * @param opts.name Unit name, as in hyperd.status.
 * @param opts.data Bytes to write, e.g. "ls\n".
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Unit name, as in hyperd.status. */
        name: string;
        /** Bytes to write, e.g. "ls\n". */
        data: string;
    },
): Promise<{ written: number }> {
    return await ctx.fns.hyperd.call({ path: "/units/" + encodeURIComponent(opts.name) + "/input", body: { data: opts.data } });
}
