/**
 * Turns a running foreground bash call into a background job ("move to background")
 *
 * Called by agent.executeBash when the person presses "to background" on a running bash call: the process keeps
 * running inside this server, its output goes on to ~/.hyper-jobs/<id>/out.log and its exit code to
 * ~/.hyper-jobs/<id>/exit, and the tool call returns at once. jobs.poll then reports the end like any other job.
 * The process is a child of this server, so a server restart ends it and the job is reported as lost.
 * @param opts.agentId Agent that owns the call and gets the completion message.
 * @param opts.command The command being run.
 * @param opts.startedAt When the call started (ms).
 * @param opts.secrets Secret references of the call, for masking output.
 * @param opts.kill Stops the process; used by jobs.cancel.
 * @param opts.title Short label; defaults to the first line of the command.
 * @param opts.prompt Instruction appended to the completion message.
 * @param opts.timeoutMs Deadline counted from startedAt; past it the job is stopped and reported as timeout. @default 86400000
 */
export default async function (
    ctx: Context,
    _session: Session | null,
    opts: {
        /** Agent that owns the call and gets the completion message. */
        agentId: string;
        /** The command being run. */
        command: string;
        /** When the call started (ms). */
        startedAt: number;
        /** Secret references of the call, for masking output. */
        secrets?: Record<string, string>;
        /** Stops the process; used by jobs.cancel. */
        kill: () => void;
        /** Short label; defaults to the first line of the command. */
        title?: string;
        /** Instruction appended to the completion message. */
        prompt?: string;
        /** Deadline counted from startedAt; past it the job is stopped and reported as timeout. @default 86400000 */
        timeoutMs?: number;
    },
): Promise<{ id: string; dir: string }> {
    const now = Date.now();
    const id = "j" + Bun.randomUUIDv7().replaceAll("-", "").slice(-10);
    const home = process.env.HOME ?? "";
    const dir = `${home}/.hyper-jobs/${id}`;
    const { mkdirSync } = await import("node:fs");
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const owner = (await ctx.fns.procs.db.select({ sql: "SELECT created_by FROM agents WHERE id = ?", params: [opts.agentId] }) as any[])[0];
    const title = (opts.title ?? opts.command.split("\n").find((l) => l.trim()) ?? opts.command).trim().slice(0, 120);
    const spec = { title, command: opts.command, host: null, secrets: opts.secrets ?? {}, detached: true };
    await ctx.fns.procs.db.run({
        sql: `INSERT INTO jobs (id, kind, runner, spec, state, status, owner_id, created_by, agent_id, prompt, execution_id, next_at, created_at, started_at, deadline_at, updated_at)
              VALUES (?, 'exec', 'attached', ?::jsonb, '{}'::jsonb, 'running', ?, 'ui', ?, ?, ?, ?, ?, ?, ?, ?)`,
        params: [id, JSON.stringify(spec), owner?.created_by ?? null, opts.agentId, opts.prompt ?? null, id, now + 1000, now, opts.startedAt, opts.startedAt + Math.max(1000, opts.timeoutMs ?? 86_400_000), now],
    });
    (((ctx.state as any).attachedJobs ??= new Map()) as Map<string, { kill: () => void }>).set(id, { kill: opts.kill });
    ctx.fns.events.refreshAgentMeta({ agentId: opts.agentId, section: "automation", reason: "job-adopt" });
    return { id, dir };
}
