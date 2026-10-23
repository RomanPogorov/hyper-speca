// Run TypeScript inside this process with the live ctx in scope — the agent's
// own extension mechanism. Declared as a tool by $tool_eval.md; callable by
// hand as ctx.fns.tools.eval({ code }).
//
// background: the code keeps running in this server as an "attached" job (jobs.adopt): its captured output goes
// to the job log and the agent gets the usual completion message. It is a promise, not a process — cancel or
// timeout stop reporting it but cannot interrupt code already running, and a server restart reports it lost.
/**
 * Evaluates TypeScript in the live runtime context, in the foreground or as a background job.
 * @param opts.code TypeScript or JavaScript code to evaluate.
 * @param opts.background Run as a background job and return its id at once; the agent is messaged when it ends. An object { afterMs, wake } waits afterMs first: code done by then returns its normal result. @default false
 * @param opts.timeout With background — seconds after which a still-running eval is reported as timeout. @default 86400 @minimum 1
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** TypeScript or JavaScript code to evaluate. */
        code: string;
        /** Run as a background job and return its id at once; the agent is messaged when it ends. An object { afterMs, wake } waits afterMs first: code done by then returns its normal result. @default false */
        background?: boolean | { afterMs?: number; wake?: string };
        /** With background — seconds after which a still-running eval is reported as timeout. @default 86400 @minimum 1 */
        timeout?: number;
    },
): Promise<string | { output: string; content: types.tools.Content[] }> {
    const agent = (session as any)?.agent;
    if (!opts.background) return await ctx.fns.repl.eval({ code: opts.code, agent });

    const agentId = String(agent?.id ?? (session as any)?.agentId ?? "");
    if (!agentId) throw new Error("eval: background needs an agent to notify");
    const bg = typeof opts.background === "object" ? opts.background : {};
    const afterMs = Math.max(0, Math.min(600_000, Math.floor(bg.afterMs ?? 0)));
    const startedAt = Date.now();
    type Outcome = { ok: boolean; value: string | { output: string; content: types.tools.Content[] }; error?: any };
    const running: Promise<Outcome> = ctx.fns.repl.eval({ code: opts.code, agent })
        .then((value: any) => ({ ok: true, value }), (error: any) => ({ ok: false, value: String(error?.stack ?? error?.message ?? error), error }));

    if (afterMs > 0) {
        const first = await Promise.race([running, Bun.sleep(afterMs).then(() => null)]);
        if (first) {
            if (!first.ok) throw first.error;
            return first.value;
        }
    }

    const line = (opts.code.split("\n").find((l) => l.trim()) ?? opts.code).trim();
    const job = await ctx.fns.jobs.adopt({
        agentId, command: opts.code, startedAt, title: `eval: ${line}`.slice(0, 120), prompt: bg.wake,
        timeoutMs: Math.max(1, opts.timeout ?? 86_400) * 1000,
        // a promise cannot be interrupted: cancel/timeout only stop waiting for it
        kill: () => undefined,
    });
    void running.then(async (r) => {
        const { appendFileSync, writeFileSync, renameSync } = await import("node:fs");
        const text = typeof r.value === "string" ? r.value : r.value.output;
        appendFileSync(`${job.dir}/out.log`, text.endsWith("\n") ? text : text + "\n");
        writeFileSync(`${job.dir}/exit.tmp`, r.ok ? "0" : "1");
        renameSync(`${job.dir}/exit.tmp`, `${job.dir}/exit`);
    }).catch(() => undefined);
    const after = afterMs > 0 ? `Still running after ${Math.round(afterMs / 1000)}s — moved to background job ${job.id}` : `Started background job ${job.id}`;
    return `${after}: ${line.slice(0, 120)}\nYou will get a message when it ends — do not wait or poll; end your turn or do other work. Output: ctx.fns.jobs.logs({ id: "${job.id}" }); everything running: ctx.fns.jobs.list({}). It runs inside this server: a restart reports it lost, cancel stops reporting but cannot interrupt the code.`;
}
