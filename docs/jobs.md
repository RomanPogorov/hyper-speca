# Jobs: background commands, timers and triggers

Everything an agent has running or scheduled is a row of one Postgres table, `jobs`. When a job ends or fires,
the agent gets one message in the same conversation and a turn is queued. Nothing is polled by the agent itself.

| kind | runner | made by | ends with |
|---|---|---|---|
| `exec` | `bash` | `bash({ background: true })`, `jobs.start` | a completion message: exit code, duration, output tail |
| `exec` | `attached` | the "to background" button on a running bash call (`tools.detachRun` → `jobs.adopt`) | same |
| `exec` | `sleep` | `jobs.start({ runner: "sleep", ms })` | a message after `ms` |
| `schedule` | `at` | `agent.wake` | the prompt, once |
| `schedule` | `cron` | `agent.cron` | the prompt on every occurrence |
| `schedule` | `watch` | `agent.watch` | the prompt when the condition turns true (`once` or `edge`) |
| `subscription` | `attach` | `agent.attach` | the prompt on every matching external event |

## Background commands

```ts
await ctx.fns.tools.bash({ command: "bun test", background: true, notify: "if green, deploy" }) // the tool
const job = await ctx.fns.jobs.start({ command: "make build", host: "builder", timeout: 3600, secrets: { TOKEN: "secret://ci/token" } })
await ctx.fns.jobs.list({})                  // what is running; { status: "finished" | "all" }
await ctx.fns.jobs.get({ id: job.id })       // status, exit code, output tail
await ctx.fns.jobs.logs({ id: job.id, offset: 0, limit: 4000 })   // output, secrets masked
await ctx.fns.jobs.cancel({ id: job.id })    // silent: no completion message
```

- A bash job runs in tmux session `hj-<id>` on this machine or an SSH host; output goes to
  `~/.hyper-jobs/<id>/out.log`, the exit code to `~/.hyper-jobs/<id>/exit`. It survives a Hyper restart.
- With the setting `jobs.backend = hyperd` local jobs run as transient [hyperd](hyperd.md) units instead (PTY,
  logs by offset, process group killed on cancel). SSH hosts always use tmux.
- Env and secret values reach the process through a 0600 launcher file that deletes itself first; `ps` and tmux
  never see them, and secret values are replaced with `[REDACTED]` in everything the agent reads.
- A job that runs past `timeout` (default 24 h) is stopped and reported as `timeout`; a vanished session is
  `lost`. Unreachable SSH hosts are retried with backoff until the deadline.
- "To background" moves a running local bash call into a job: the tool call returns at once, the process keeps
  running inside the server (so a server restart reports it as lost).
- Several jobs that end within 2 s reach the agent in one turn.

## Wake-ups, cron and watches

```ts
await ctx.fns.agent.wake({ id: agent.id, inMs: 10 * 60_000, prompt: "Check the build" })      // or at
await ctx.fns.agent.cron({ id: agent.id, expression: "0 9 * * 1-5", timezone: "Europe/Lisbon", prompt: "Morning update" })
await ctx.fns.agent.watch({
  id: agent.id, predicate: "file.exists", opts: { path: "/tmp/result.json" },
  prompt: "The result is ready", everyMs: 30_000, timeoutMs: 3_600_000, mode: "once",
  onTimeoutPrompt: "The result did not arrive in time",
})
await ctx.fns.agent.triggers({ id: agent.id, status: "active" })
await ctx.fns.agent.cancelTrigger({ id: agent.id, triggerId })
await ctx.fns.agent.cancelAllTriggers({ id: agent.id })
```

Details, predicates and the UI: [agent triggers](agent-triggers.md). Trigger ids keep the `tr_` prefix and
appear in `jobs.list` too.

## How it runs

- `agent.workerLoop` calls `jobs.poll` on every pass and sleeps until the earliest `next_at`. Due rows are
  claimed with a short lease (`FOR UPDATE SKIP LOCKED`), so two workers never handle the same job.
- Every message goes through `agent.deliver`: the inbox message, UI event, job state change, `job_runs` audit row
  and the wake-up commit in one transaction, keyed by job id (+ scheduled time). A crash or a second poller
  can neither lose nor double a message; a cancel that commits first wins.
- While an agent is parked on a provider usage limit its schedules wait; the parking wake-up is itself an `at` job.
- Archiving an agent cancels all its jobs (`jobs.cancelAgent`). Stopping a turn does not: jobs keep running and
  report back.

## Tables

- `jobs` — `id, kind, runner, spec, state, status, outcome_reason, owner_id, created_by, agent_id, prompt,
  origin_tool_call_id, execution_id, next_at, lease_token, lease_expires_at, cancel_requested_at, result,
  created_at, started_at, deadline_at, finished_at, updated_at`. `status` is `running` until the job ends.
- `job_runs` — one row per firing of a schedule or subscription: `job_id, scheduled_at, outcome, result,
  result_ref, error`. Large predicate results are stored by reference ([trigger results](trigger-results-storage.md)).

The old tables `agent_triggers`, `agent_trigger_runs`, `agent_watches`, `agent_attachments` and the column
`agents.wake_at` are gone: migrations in `src/jobs/` copy their rows into `jobs` and drop them at boot.
