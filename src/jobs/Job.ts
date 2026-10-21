/** One row of the jobs table as returned by jobs.get / jobs.list. */
export type Job = {
    id: string;
    kind: "exec" | "schedule" | "subscription";
    runner: "bash" | "sleep" | string;
    status: "running" | "succeeded" | "failed" | "cancelled" | "timeout" | "lost";
    outcomeReason: string | null;
    agentId: string;
    title: string;
    host: string | null;
    prompt: string | null;
    createdAt: number;
    startedAt: number | null;
    deadlineAt: number | null;
    finishedAt: number | null;
    /** Exit code, duration, output tail and size once finished. */
    result: { exitCode?: number | null; ms?: number; tail?: string; bytes?: number } | null;
};
