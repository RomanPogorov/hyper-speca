/**
 * Maps a raw jobs table row to the public types.jobs.Job shape
 *
 * Shared by jobs.get, jobs.list, jobs.start and jobs.poll so every caller sees the same field names.
 * @param opts.row Raw row selected from the jobs table.
 */
export default function (
    _ctx: Context,
    _session: Session | null,
    opts: {
        /** Raw row selected from the jobs table. */
        row: Record<string, any>;
    },
): types.jobs.Job {
    const r = opts.row;
    const json = (v: any) => (typeof v === "string" ? JSON.parse(v) : v ?? null);
    const spec = json(r.spec) ?? {};
    const num = (v: any) => (v == null ? null : Number(v));
    return {
        id: String(r.id),
        kind: r.kind,
        runner: String(r.runner),
        status: r.status,
        outcomeReason: r.outcome_reason ?? null,
        agentId: String(r.agent_id),
        title: String(spec.title ?? ""),
        host: spec.host ?? null,
        prompt: r.prompt ?? null,
        createdAt: Number(r.created_at),
        startedAt: num(r.started_at),
        deadlineAt: num(r.deadline_at),
        finishedAt: num(r.finished_at),
        result: json(r.result),
    };
}
