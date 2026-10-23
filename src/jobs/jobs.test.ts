// Background jobs: real tmux on this machine (the bash runner), real Postgres, agent.deliver for the message.
import { describe, expect, test } from "bun:test";
import { mkTestCtx } from "../_testCtx.entry";

async function setup() {
    const ctx: any = await mkTestCtx();
    ctx.state.registry.agent.wakeWorker = () => {};
    const a = await ctx.fns.agent.start({ model: "mock:test" });
    return { ctx, a };
}
async function until(ctx: any, id: string, ms = 8000) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
        await ctx.fns.procs.db.run({ sql: "UPDATE jobs SET next_at = 0 WHERE id = ? AND status = 'running'", params: [id] });
        await ctx.fns.jobs.poll({});
        const j = await ctx.fns.jobs.get({ id });
        if (j.status !== "running") return j;
        await Bun.sleep(150);
    }
    throw new Error("job still running: " + id);
}
const inbox = async (ctx: any, id: string) => (await ctx.fns.session.getMessages({ id })).filter((m: any) => m.role === "user");

describe("jobs", () => {
    test("bash job: exit code, output tail and one inbox message; a second poll does nothing", async () => {
        const { ctx, a } = await setup();
        const job = await ctx.fns.jobs.start({ agentId: a.id, command: "echo hello; echo oops >&2; exit 3", prompt: "fix it" });
        expect(job).toMatchObject({ status: "running", runner: "bash", title: "echo hello; echo oops >&2; exit 3" });
        const done = await until(ctx, job.id);
        expect(done).toMatchObject({ status: "failed", outcomeReason: "exit", result: { exitCode: 3 } });
        await ctx.fns.jobs.poll({ now: Date.now() + 120_000 });
        const msgs = await inbox(ctx, a.id);
        expect(msgs).toHaveLength(1);
        expect(msgs[0].message_type).toBe("job");
        expect(msgs[0].content).toContain(`Background job ${job.id} failed (exit 3)`);
        expect(msgs[0].content).toContain("hello\noops");
        expect(msgs[0].content).toContain("Your instruction for this moment: fix it");
        expect((await ctx.fns.jobs.logs({ id: job.id })).text).toBe("hello\noops\n");
    }, 15_000);

    test("secrets: values reach the process, never the inbox or logs, and the launcher file is gone", async () => {
        const { ctx, a } = await setup();
        ctx.state.registry.secrets.get = async (_c: any, _s: any, o: any) => (o.ref === "env://T" ? "s3cr3t-value" : null);
        const job = await ctx.fns.jobs.start({ agentId: a.id, command: 'echo "token=$TOKEN"', secrets: { TOKEN: "env://T" } });
        await until(ctx, job.id);
        const msg = (await inbox(ctx, a.id))[0].content;
        expect(msg).toContain("token=[REDACTED]");
        expect(msg).not.toContain("s3cr3t-value");
        expect((await ctx.fns.jobs.logs({ id: job.id })).text).not.toContain("s3cr3t-value");
        const left = await ctx.fns.jobs.sh({ script: `ls "$HOME/.hyper-jobs/${job.id}"` });
        expect(left.stdout).not.toContain("run.sh");
    }, 15_000);

    test("cancel stops the process and does not wake the agent", async () => {
        const { ctx, a } = await setup();
        const job = await ctx.fns.jobs.start({ agentId: a.id, command: "sleep 60" });
        const c = await ctx.fns.jobs.cancel({ id: job.id });
        expect(c.status).toBe("cancelled");
        expect((await ctx.fns.jobs.bashProbe({ jobId: job.id, host: null })).state).not.toBe("running");
        expect(await inbox(ctx, a.id)).toHaveLength(0);
    }, 15_000);

    test("timeout kills a job past its deadline and reports it", async () => {
        const { ctx, a } = await setup();
        const job = await ctx.fns.jobs.start({ agentId: a.id, command: "echo started; sleep 60", timeout: 1 });
        await Bun.sleep(300);
        await ctx.fns.jobs.poll({ now: Date.now() + 5_000 });
        const j = await ctx.fns.jobs.get({ id: job.id });
        expect(j).toMatchObject({ status: "timeout", outcomeReason: "timeout" });
        expect((await inbox(ctx, a.id))[0].content).toContain("timeout");
    }, 20_000);

    test("a vanished tmux session is reported as lost", async () => {
        const { ctx, a } = await setup();
        const job = await ctx.fns.jobs.start({ agentId: a.id, command: "sleep 60" });
        await ctx.fns.jobs.sh({ script: `tmux kill-session -t '=hj-${job.id}'` });
        const j = await until(ctx, job.id);
        expect(j).toMatchObject({ status: "lost", outcomeReason: "gone" });
        expect((await inbox(ctx, a.id))[0].content).toContain("lost");
    }, 15_000);

    test("sleep timer: fires at its deadline, wake is batched by 2 s", async () => {
        const { ctx, a } = await setup();
        await ctx.fns.procs.db.run({ sql: "UPDATE agents SET next_run_at = NULL WHERE id = ?", params: [a.id] });
        const t = await ctx.fns.jobs.start({ agentId: a.id, runner: "sleep", ms: 1000, prompt: "check the deploy" });
        const now = Date.now();
        expect((await ctx.fns.jobs.poll({ now })).finished).toEqual([]);
        expect((await ctx.fns.jobs.poll({ now: now + 2000 })).finished).toEqual([t.id]);
        const msg = (await inbox(ctx, a.id))[0].content;
        expect(msg).toContain(`Timer ${t.id}`);
        expect(msg).toContain("check the deploy");
        const row = (await ctx.fns.procs.db.select({ sql: "SELECT next_run_at FROM agents WHERE id = ?", params: [a.id] }))[0];
        expect(Number(row.next_run_at)).toBe(now + 4000);
    });

    test("jobs ending in one pass do not tell each other they are still running", async () => {
        const { ctx, a } = await setup();
        const t1 = await ctx.fns.jobs.start({ agentId: a.id, runner: "sleep", ms: 10 });
        const t2 = await ctx.fns.jobs.start({ agentId: a.id, runner: "sleep", ms: 10 });
        const long = await ctx.fns.jobs.start({ agentId: a.id, runner: "sleep", ms: 600_000 });
        expect((await ctx.fns.jobs.poll({ now: Date.now() + 1000 })).finished.sort()).toEqual([t1.id, t2.id].sort());
        for (const m of await inbox(ctx, a.id)) expect(m.content).toContain("1 other job(s) still running");
        await ctx.fns.jobs.cancel({ id: long.id });
    });

    test("bash tool background:true starts a job and returns at once", async () => {
        const { ctx, a } = await setup();
        const started = Date.now();
        const r = await ctx.fns.tools.call({ name: "bash", args: { command: "sleep 2; echo done", background: true, notify: "report" }, agent: a });
        expect(Date.now() - started).toBeLessThan(1500);
        expect(r.isError).toBe(false);
        const id = /job (j[0-9a-f]+)/.exec(r.output)![1];
        const j = await until(ctx, id);
        expect(j).toMatchObject({ status: "succeeded", prompt: "report" });
    }, 15_000);

    test("background.afterMs: a command done in time returns its normal result and sends no message", async () => {
        const { ctx, a } = await setup();
        const r = await ctx.fns.tools.call({ name: "bash", args: { command: "echo quick; exit 2", background: { afterMs: 5000, wake: "never" } }, agent: a });
        expect(r.isError).toBe(true);
        expect(r.output).toBe("[exit 2]\nquick");
        const [j] = await ctx.fns.jobs.list({ agentId: a.id, status: "all" });
        expect(j).toMatchObject({ status: "failed", result: { exitCode: 2 } });
        await ctx.fns.jobs.poll({ now: Date.now() + 120_000 });
        expect(await inbox(ctx, a.id)).toHaveLength(0);
    }, 15_000);

    test("background.afterMs: a command still running moves to the background and wakes with its instruction", async () => {
        const { ctx, a } = await setup();
        const started = Date.now();
        const r = await ctx.fns.tools.call({ name: "bash", args: { command: "echo one; sleep 1.5; echo two", timeout: 60, background: { afterMs: 400, wake: "Tests finished. Inspect failures." } }, agent: a });
        expect(Date.now() - started).toBeLessThan(1400);
        expect(r.output).toContain("Still running after 0s — moved to background job");
        const id = /job (j[0-9a-f]+)/.exec(r.output)![1];
        expect(await until(ctx, id)).toMatchObject({ status: "succeeded" });
        const msg = (await inbox(ctx, a.id))[0].content;
        expect(msg).toContain("one\ntwo");
        expect(msg).toContain("Your instruction for this moment: Tests finished. Inspect failures.");
    }, 15_000);

    test("background option is validated: unknown keys inside it are refused", async () => {
        const { ctx, a } = await setup();
        const r = await ctx.fns.tools.call({ name: "bash", args: { command: "true", background: { after: 5 } }, agent: a });
        expect(r.isError).toBe(true);
        expect(r.output).toContain('unknown option "background.after"');
    });

    test("jobs.wait returns a finished job at once and done:false for one still running", async () => {
        const { ctx, a } = await setup();
        const quick = await ctx.fns.jobs.start({ agentId: a.id, command: "echo hi" });
        expect(await ctx.fns.jobs.wait({ id: quick.id, timeoutMs: 5000 })).toMatchObject({ done: true, job: { status: "succeeded" } });
        const slow = await ctx.fns.jobs.start({ agentId: a.id, command: "sleep 30" });
        expect(await ctx.fns.jobs.wait({ id: slow.id, timeoutMs: 300 })).toMatchObject({ done: false, job: { status: "running" } });
        await ctx.fns.jobs.cancel({ id: slow.id });
    }, 15_000);

    test("eval background: output and the result come back as a job message", async () => {
        const { ctx, a } = await setup();
        // mkTestCtx stubs repl.eval; this one sleeps, prints or throws as the code says
        ctx.state.registry.repl.eval = async (_c: any, _s: any, o: { code: string }) => {
            const ms = Number(/sleep\((\d+)\)/.exec(o.code)?.[1] ?? 0);
            if (ms) await Bun.sleep(ms);
            if (o.code.includes("throw")) throw new Error("boom");
            return o.code.includes("crawled") ? "crawled 3" : "2";
        };
        const r = await ctx.fns.tools.call({ name: "eval", args: { code: "await Bun.sleep(300); console.log('crawled', 3)", background: true }, agent: a });
        expect(String(r.output ?? r)).toContain("Started background job");
        const id = /job (j[0-9a-f]+)/.exec(String(r.output ?? r))![1];
        expect(await until(ctx, id)).toMatchObject({ status: "succeeded", runner: "attached" });
        expect((await inbox(ctx, a.id))[0].content).toContain("crawled 3");

        const quick = await ctx.fns.tools.call({ name: "eval", args: { code: "console.log(1 + 1)", background: { afterMs: 3000 } }, agent: a });
        expect(String(quick.output ?? quick)).toBe("2");

        const bad = await ctx.fns.tools.call({ name: "eval", args: { code: "await Bun.sleep(200); throw new Error('boom')", background: true }, agent: a });
        const badId = /job (j[0-9a-f]+)/.exec(String(bad.output ?? bad))![1];
        expect(await until(ctx, badId)).toMatchObject({ status: "failed", result: { exitCode: 1 } });
    }, 20_000);

    test("a command that cannot start fails the call instead of messaging later", async () => {
        const { ctx, a } = await setup();
        await expect(ctx.fns.jobs.start({ agentId: a.id, command: "true", host: "no-such-host-xyz" })).rejects.toThrow("could not start");
        expect((await ctx.fns.jobs.list({ agentId: a.id, status: "all" }))[0]).toMatchObject({ status: "failed", outcomeReason: "start" });
    }, 30_000);
});

describe("to background", () => {
    test("a running foreground bash call returns at once; the process goes on and reports as a job", async () => {
        const { ctx, a } = await setup();
        const call = ctx.fns.tools.call({ name: "bash", args: { command: "echo before; sleep 1.5; echo after; exit 4" }, agent: a });
        let run: any;
        for (let i = 0; i < 50 && !run?.detachable; i++) { await Bun.sleep(30); run = ctx.fns.tools.runs({ agentId: a.id })[0]; }
        expect(run.detachable).toBe(true);
        await Bun.sleep(200);
        expect(ctx.fns.tools.detachRun({ id: run.id })).toEqual({ detached: true });
        const r = await call;
        expect(r.isError).toBe(false);
        expect(r.output).toContain("moved to the background");
        const id = /job (j[0-9a-f]+)/.exec(r.output)![1];
        expect(ctx.fns.tools.runs({ agentId: a.id })).toHaveLength(0);
        const j = await until(ctx, id);
        expect(j).toMatchObject({ status: "failed", runner: "attached", result: { exitCode: 4 } });
        const msg = (await inbox(ctx, a.id))[0].content;
        expect(msg).toContain("before\nafter");
    }, 15_000);

    test("an attached job without its process (server restarted) is lost; cancel kills a live one", async () => {
        const { ctx, a } = await setup();
        const call = ctx.fns.tools.call({ name: "bash", args: { command: "sleep 30" }, agent: a });
        let run: any;
        for (let i = 0; i < 50 && !run?.detachable; i++) { await Bun.sleep(30); run = ctx.fns.tools.runs({ agentId: a.id })[0]; }
        ctx.fns.tools.detachRun({ id: run.id });
        const id = /job (j[0-9a-f]+)/.exec((await call).output)![1];
        expect((await ctx.fns.jobs.cancel({ id })).status).toBe("cancelled");
        expect(await inbox(ctx, a.id)).toHaveLength(0);

        const call2 = ctx.fns.tools.call({ name: "bash", args: { command: "sleep 30" }, agent: a });
        let run2: any;
        for (let i = 0; i < 50 && !run2?.detachable; i++) { await Bun.sleep(30); run2 = ctx.fns.tools.runs({ agentId: a.id })[0]; }
        ctx.fns.tools.detachRun({ id: run2.id });
        const id2 = /job (j[0-9a-f]+)/.exec((await call2).output)![1];
        const handle = ctx.state.attachedJobs.get(id2);
        ctx.state.attachedJobs.delete(id2);
        expect(await until(ctx, id2)).toMatchObject({ status: "lost" });
        handle.kill();
    }, 15_000);

    test("non-detachable calls refuse", async () => {
        const { ctx } = await setup();
        expect(ctx.fns.tools.detachRun({ id: "nope" })).toEqual({ detached: false, reason: "not running" });
    });
});
