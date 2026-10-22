/**
 * Stops a background bash job's tmux session (Ctrl-C, then kill after a grace period)
 *
 * Bash runner of the jobs table, used by jobs.cancel and by the deadline check in jobs.poll.
 * @param opts.jobId Job id.
 * @param opts.host SSH alias, or null for this machine.
 * @param opts.grace Seconds between Ctrl-C and kill-session. @default 3
 */
export default async function (
    ctx: Context,
    _session: Session | null,
    opts: {
        /** Job id. */
        jobId: string;
        /** SSH alias, or null for this machine. */
        host: string | null;
        /** Seconds between Ctrl-C and kill-session. @default 3 @minimum 0 @maximum 30 */
        grace?: number;
        /** Where the job runs. @default "tmux" */
        backend?: "tmux" | "hyperd";
    },
): Promise<{ wasRunning: boolean; unreachable: boolean }> {
    if (!/^[A-Za-z0-9_-]+$/.test(opts.jobId)) throw new Error("jobs.bashKill: invalid job id " + opts.jobId);
    if (opts.backend === "hyperd") {
        // hyperd sends SIGTERM to the process group and SIGKILL after its stop timeout
        let u: any;
        try { u = await ctx.fns.hyperd.call({ path: "/units/" + opts.jobId }); } catch (error: any) { return { wasRunning: false, unreachable: !/no unit/.test(String(error?.message)) }; }
        const was = ["starting", "running", "ready", "stopping"].includes(u.state);
        if (was) await ctx.fns.hyperd.stop({ name: opts.jobId, reason: "cancelled" });
        const until = Date.now() + (Math.max(0, Math.min(30, opts.grace ?? 3)) + 12) * 1000;
        while (was && Date.now() < until) {
            const s = await ctx.fns.hyperd.call({ path: "/units/" + opts.jobId }).catch(() => null);
            if (!s || !["starting", "running", "ready", "stopping"].includes(s.state)) break;
            await Bun.sleep(150);
        }
        return { wasRunning: was, unreachable: false };
    }
    const t = `'=hj-${opts.jobId}'`;
    const g = Math.max(0, Math.min(30, opts.grace ?? 3));
    const script = `tmux has-session -t ${t} 2>/dev/null || { echo WAS=0; exit 0; }; echo WAS=1; tmux send-keys -t ${t}: C-c; for i in $(seq 1 ${g * 4}); do tmux has-session -t ${t} 2>/dev/null || exit 0; sleep 0.25; done; tmux kill-session -t ${t}`;
    const r = await ctx.fns.jobs.sh({ host: opts.host, script, timeout: g + 15 });
    return { wasRunning: r.stdout.includes("WAS=1"), unreachable: r.unreachable };
}
