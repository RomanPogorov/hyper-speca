# Durable agent wake-ups

Moved. Wake-ups, cron schedules and condition watches are rows of the `jobs` table now:

- [agent triggers](agent-triggers.md) — `agent.wake`, `agent.cron`, `agent.watch`, predicates, UI;
- [jobs](jobs.md) — the whole table, including background commands.

The old calls `agent.wakeIn`, `agent.wakeAt`, `agent.wakeUpWhen` and `agent.cancelWake` still work as
deprecated wrappers over `agent.wake` / `agent.watch` / `agent.cancelTrigger`. The tables `agent_watches`
and the column `agents.wake_at` no longer exist.

## Registered runtime function predicate

`runtime.fn` calls a registered `ctx.fns` procedure by dotted name; it stores the name and JSON args, never code.

```ts
await ctx.fns.agent.watch({
  id: agent.id,
  predicate: "runtime.fn",
  opts: { name: "tmp.waitForEmail", args: { from: "person@example.com", after: Date.now() }, callTimeoutMs: 15_000 },
  prompt: "Email arrived",
  everyMs: 5 * 60_000,
  timeoutMs: 24 * 60 * 60_000,
})
```

The function must accept one opts object and return `{ ready: false }` or `{ ready: true, result: { /* compact JSON */ } }`.
For project-local checks create `.hyper/<module>/<fn>.ts`, then run `procs.dev.genTypes` and `procs.repl.load`.
Checks should be read-only, idempotent, quick and return compact results. Errors are recorded and polling
continues until timeout.
