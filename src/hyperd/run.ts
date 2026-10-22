/**
 * Starts a transient hyperd unit (one-shot task, service or terminal session) without a unit file
 *
 * Like systemd-run: the process runs under its own detached holder, survives restarts of this server and of hyperd, and its output goes to a log readable by offset with hyperd.logs. env is handed over once and never written to the unit spec, so secrets may go there.
 * @param opts.name Unit name: letters, digits, dot, dash, underscore (max 64).
 * @param opts.cmd argv, or a shell string run through bash -lc.
 * @param opts.kind task runs once, service is kept alive per restart policy, session is an interactive terminal. @default task
 * @param opts.cwd Working directory (absolute or ~/).
 * @param opts.env Environment for this run only; not stored in the spec.
 * @param opts.pty Run in a pseudo-terminal (needed for input to interactive programs); default true for session.
 * @param opts.ttlMs Stop the run after this many milliseconds. @minimum 1
 * @param opts.logMatch Output patterns (substring or /regex/) that emit log_match events.
 * @param opts.owner Owner label such as "job:j123" or "agent:bi".
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Unit name: letters, digits, dot, dash, underscore (max 64). */
        name: string;
        /** argv, or a shell string run through bash -lc. */
        cmd: string[] | string;
        /** task runs once, service is kept alive per restart policy, session is an interactive terminal. @default task */
        kind?: "task" | "service" | "session";
        /** Working directory (absolute or ~/). */
        cwd?: string;
        /** Environment for this run only; not stored in the spec. */
        env?: Record<string, string>;
        /** Run in a pseudo-terminal (needed for input to interactive programs); default true for session. */
        pty?: boolean;
        /** Stop the run after this many milliseconds. @minimum 1 */
        ttlMs?: number;
        /** Output patterns (substring or /regex/) that emit log_match events. */
        logMatch?: string[];
        /** Owner label such as "job:j123" or "agent:bi". */
        owner?: string;
    },
): Promise<{ name: string; state: string; run: number; pid: number | null; runDir: string | null }> {
    const { env, ...unit } = opts;
    const u = await ctx.fns.hyperd.call({ path: "/run", body: { unit, env } });
    return { name: u.name, state: u.state, run: u.run, pid: u.pid, runDir: u.runDir };
}
