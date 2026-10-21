/**
 * Runs a short control script for a job host: locally through bash, or on an SSH host through remote.exec
 *
 * The one transport the job runners use to start, probe, read and kill job processes, so local and SSH jobs share
 * exactly the same shell scripts. Not for user commands — those run inside the job's own tmux session.
 * @param opts.host SSH alias, or null/omitted for this machine.
 * @param opts.script Bash source to execute.
 * @param opts.stdin Text piped to the script's standard input.
 * @param opts.timeout Seconds before the script is killed. @default 30
 */
export default async function (
    ctx: Context,
    _session: Session | null,
    opts: {
        /** SSH alias, or null/omitted for this machine. */
        host?: string | null;
        /** Bash source to execute. */
        script: string;
        /** Text piped to the script's standard input. */
        stdin?: string;
        /** Seconds before the script is killed. @default 30 @minimum 1 @maximum 600 */
        timeout?: number;
    },
): Promise<{ stdout: string; stderr: string; exitCode: number | null; unreachable: boolean }> {
    const timeout = Math.max(1, Math.min(600, opts.timeout ?? 30));
    if (opts.host) {
        const r = await ctx.fns.remote.exec({ host: opts.host, command: opts.script, stdin: opts.stdin, timeout });
        return { stdout: r.stdout, stderr: r.stderr, exitCode: r.exitCode, unreachable: r.timedOut || (r.exitCode === 255 && !r.stdout) };
    }
    const proc = Bun.spawn(["bash", "-c", ctx.fns.remote.shellPrelude({}) + opts.script], {
        stdin: opts.stdin != null ? new TextEncoder().encode(opts.stdin) : "ignore",
        stdout: "pipe",
        stderr: "pipe",
    });
    const timer = setTimeout(() => proc.kill(), timeout * 1000);
    try {
        const [stdout, stderr, exitCode] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
        return { stdout, stderr, exitCode, unreachable: false };
    } finally {
        clearTimeout(timer);
    }
}
