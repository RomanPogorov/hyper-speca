/** One row of the jobs table as returned by jobs.get / jobs.list. */
export type Job = {
    id: string;
    kind: "exec" | "schedule" | "subscription";
    runner: "bash" | "attached" | "at" | "cron" | "watch" | "attach" | string;
    status: "running" | "succeeded" | "failed" | "cancelled" | "timeout" | "lost";
    outcomeReason: string | null;
    agentId: string;
    title: string;
    host: string | null;
    prompt: string | null;
    createdAt: number;
    startedAt: number | null;
    deadlineAt: number | null;
    /** When the job is next checked or fires (a wake-up's time, a cron's next occurrence); null once finished. */
    nextAt: number | null;
    finishedAt: number | null;
    /** Runner configuration: title, command/host for bash; expression/timezone for cron; predicate/opts/everyMs/mode for watch; source/events/filter for attach. Secrets are not included. */
    spec: Record<string, any>;
    /** Exit code, duration, output tail and size once finished. */
    result: { exitCode?: number | null; ms?: number; tail?: string; bytes?: number } | null;
};
