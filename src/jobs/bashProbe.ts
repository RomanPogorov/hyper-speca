/**
 * Checks one background bash job: finished with an exit code, still running, gone, or host unreachable
 *
 * Bash runner of the jobs table, used by jobs.poll. Reads ~/.hyper-jobs/<jobId>/exit and the tmux session, plus the
 * log size and its last bytes, in one round trip. "gone" means the session vanished without an exit file (killed,
 * machine rebooted).
 * @param opts.jobId Job id.
 * @param opts.host SSH alias, or null for this machine.
 * @param opts.tailBytes How many trailing log bytes to return. @default 4000
 * @param opts.alive For jobs without a tmux session (moved to the background from a foreground call): whether the process is known to be running.
 */
export default async function (
    ctx: Context,
    _session: Session | null,
    opts: {
        /** Job id. */
        jobId: string;
        /** SSH alias, or null for this machine. */
        host: string | null;
        /** How many trailing log bytes to return. @default 4000 @minimum 0 @maximum 100000 */
        tailBytes?: number;
        /** For jobs without a tmux session (moved to the background from a foreground call): whether the process is known to be running. */
        alive?: boolean;
    },
): Promise<{ state: "done" | "running" | "gone" | "unreachable"; exitCode: number | null; bytes: number; tail: string; error?: string }> {
    if (!/^[A-Za-z0-9_-]+$/.test(opts.jobId)) throw new Error("jobs.bashProbe: invalid job id " + opts.jobId);
    const dir = `$HOME/.hyper-jobs/${opts.jobId}`;
    const n = Math.max(0, Math.min(100_000, Math.floor(opts.tailBytes ?? 4000)));
    const script = [
        `if [ -f "${dir}/exit" ]; then echo "STATE=done $(cat "${dir}/exit")"; elif ${opts.alive === undefined ? `tmux has-session -t '=hj-${opts.jobId}' 2>/dev/null` : opts.alive ? "true" : "false"}; then echo STATE=running; else echo STATE=gone; fi`,
        `echo "BYTES=$(wc -c < "${dir}/out.log" 2>/dev/null | tr -d ' ' || echo 0)"`,
        "echo ---TAIL---",
        `tail -c ${n} "${dir}/out.log" 2>/dev/null`,
    ].join("\n");
    const r = await ctx.fns.jobs.sh({ host: opts.host, script, timeout: 20 });
    if (r.unreachable) return { state: "unreachable", exitCode: null, bytes: 0, tail: "", error: r.stderr.trim() };
    const cut = r.stdout.indexOf("---TAIL---\n");
    const head = cut >= 0 ? r.stdout.slice(0, cut) : r.stdout;
    const tail = cut >= 0 ? r.stdout.slice(cut + 11) : "";
    const m = /STATE=(done|running|gone)(?: (-?\d+))?/.exec(head);
    if (!m) return { state: "unreachable", exitCode: null, bytes: 0, tail: "", error: (r.stderr || r.stdout).trim().slice(0, 500) };
    return { state: m[1] as "done" | "running" | "gone", exitCode: m[2] != null ? Number(m[2]) : null, bytes: Number(/BYTES=(\d+)/.exec(head)?.[1] ?? 0), tail };
}
