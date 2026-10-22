// Background jobs on the hyperd backend: a real hyperd daemon in a temporary HYPERD_HOME, real Postgres.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { mkTestCtx } from "../_testCtx.entry";

const root = mkdtempSync(join(tmpdir(), "hyperd-jobs-"));
const prevHome = process.env.HYPERD_HOME;
let daemon: ReturnType<typeof Bun.spawn>;

beforeAll(async () => {
    process.env.HYPERD_HOME = join(root, "home");
    daemon = Bun.spawn(["bun", resolve(import.meta.dir, "../../hyperd/main.ts")], {
        env: { ...process.env, HYPERD_HOME: join(root, "home"), HYPERD_UNITS: join(root, "units"), HYPERD_TICK_MS: "50" }, stdout: "ignore", stderr: "inherit",
    });
    const end = Date.now() + 8000;
    for (;;) {
        try { const r = await fetch("http://hyperd/health", { unix: join(root, "home/hyperd.sock") } as any); if (r.ok) break; } catch {}
        if (Date.now() > end) throw new Error("hyperd did not start");
        await Bun.sleep(100);
    }
});
afterAll(async () => {
    daemon.kill("SIGTERM");
    await daemon.exited;
    for (const pid of Bun.spawnSync(["pgrep", "-f", root]).stdout.toString().split("\n").filter(Boolean)) { try { process.kill(Number(pid), "SIGKILL"); } catch {} }
    rmSync(root, { recursive: true, force: true });
    if (prevHome === undefined) delete process.env.HYPERD_HOME; else process.env.HYPERD_HOME = prevHome;
});

async function setup() {
    const ctx: any = await mkTestCtx();
    ctx.state.registry.agent.wakeWorker = () => {};
    const real = ctx.state.registry.settings.getString;
    ctx.state.registry.settings.getString = async (c: any, s: any, o: any) => (o.module === "jobs" && o.key === "backend" ? "hyperd" : real(c, s, o));
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
        await Bun.sleep(100);
    }
    throw new Error("job still running: " + id);
}

describe("jobs on hyperd", () => {
    test("bash job runs as a hyperd unit: exit code, tail, logs by offset, one message", async () => {
        const { ctx, a } = await setup();
        const job = await ctx.fns.jobs.start({ agentId: a.id, command: "echo hello; echo oops >&2; exit 3" });
        expect(job.spec.backend).toBe("hyperd");
        const unit = await ctx.fns.hyperd.call({ path: "/units/" + job.id });
        expect(unit).toMatchObject({ kind: "task", owner: "job:" + job.id });
        const done = await until(ctx, job.id);
        expect(done).toMatchObject({ status: "failed", outcomeReason: "exit", result: { exitCode: 3 } });
        expect((await ctx.fns.jobs.logs({ id: job.id })).text).toBe("hello\noops\n");
        expect((await ctx.fns.jobs.logs({ id: job.id, offset: 6, limit: 4 })).text).toBe("oops");
        const msgs = (await ctx.fns.session.getMessages({ id: a.id })).filter((m: any) => m.role === "user");
        expect(msgs).toHaveLength(1);
        expect(msgs[0].content).toContain(`Background job ${job.id} failed (exit 3)`);
    }, 15_000);

    test("secrets reach the process but not the unit spec, the logs or the message", async () => {
        const { ctx, a } = await setup();
        ctx.state.registry.secrets.get = async (_c: any, _s: any, o: any) => (o.ref === "env://T" ? "s3cr3t-value" : null);
        const job = await ctx.fns.jobs.start({ agentId: a.id, command: 'echo "token=$TOKEN"', secrets: { TOKEN: "env://T" } });
        await until(ctx, job.id);
        const spec = await Bun.file(join(root, "home/units", job.id, "spec.json")).text();
        expect(spec).not.toContain("s3cr3t-value");
        expect((await ctx.fns.jobs.logs({ id: job.id })).text).not.toContain("s3cr3t-value");
        const msgs = (await ctx.fns.session.getMessages({ id: a.id })).filter((m: any) => m.role === "user");
        expect(msgs[0].content).not.toContain("s3cr3t-value");
    }, 15_000);

    test("cancel stops the process group silently", async () => {
        const { ctx, a } = await setup();
        const job = await ctx.fns.jobs.start({ agentId: a.id, command: "sleep 300 & sleep 300; wait" });
        await Bun.sleep(400);
        const pid = (await ctx.fns.hyperd.call({ path: "/units/" + job.id })).pid;
        const c = await ctx.fns.jobs.cancel({ id: job.id });
        expect(c).toMatchObject({ status: "cancelled", outcomeReason: "cancelled" });
        expect(Bun.spawnSync(["pgrep", "-g", String(pid)]).stdout.toString().trim()).toBe("");
        expect((await ctx.fns.session.getMessages({ id: a.id })).filter((m: any) => m.role === "user")).toHaveLength(0);
    }, 20_000);

    test("timeout kills the unit and reports timeout", async () => {
        const { ctx, a } = await setup();
        const job = await ctx.fns.jobs.start({ agentId: a.id, command: "echo started; sleep 300", timeout: 1 });
        await Bun.sleep(1200);
        const done = await until(ctx, job.id, 15_000);
        expect(done).toMatchObject({ status: "timeout", outcomeReason: "timeout" });
        expect(done.result.tail).toContain("started");
    }, 25_000);
});
