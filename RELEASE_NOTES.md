# Release notes

Newest first. One entry per change that someone using or running Hyper would notice: what changed, why, and
what to do (if anything). Internal refactors without visible effect do not need an entry.

## Unreleased

### hyperd: process supervisor for services and background jobs
- New `hyperd/` daemon: runs services, tasks and terminal sessions from unit files in `~/.hyper/units/`
  (YAML, JSON, TS), with readiness checks, `after` ordering, restart with backoff, logs by offset, an event
  journal, and a CLI (`bun hyperd/cli.ts`). Processes survive restarts of hyper and of hyperd itself.
- Install as an OS service: `bun hyperd/cli.ts install` prints the launchd (macOS) or systemd (Linux) file
  for this machine and the commands to install it; `bun hyperd/cli.ts doctor` checks the setup;
  `bash hyperd/smoke.sh` runs an end-to-end check in a throwaway home. See "Install" in `docs/hyperd.md`.
- Agents control it through `ctx.fns.hyperd.*` (`status`, `run`, `start`, `stop`, `restart`, `reload`, `logs`,
  `send`, `events`). Docs: `docs/hyperd.md`.
- Setting `jobs.backend` (`tmux` default | `hyperd`): local background bash jobs run as hyperd units. SSH
  hosts still use tmux. Switch back by setting it to `tmux`.
- On this instance: hyperd runs as the system LaunchDaemon `com.hyper.hyperd`, `jobs.backend = hyperd`, and
  the test Postgres (`~/.hyper/pg-test`, port 54400) runs as unit `pg-test`. Verified across a hyper restart:
  the service kept its pid and a background job started before the restart reported to the new process.

### Background jobs are easier for agents to find and use
- System prompt names every call in full (`ctx.fns.agent.wake/cron/watch`, `jobs.list/cancel`), explains that
  commands and triggers are rows of one jobs table, lists watch predicate options, and says that cancel is
  silent.
- `wake`, `cron` and `watch` return a `hint` with how to list and cancel; the bash background result points
  to `jobs.list`. A command with no output now says "Output: none".
- `agent.wakeIn` / `agent.wakeUpWhen` are deprecated in favour of `agent.wake` / `agent.watch`.

### Jobs v3: one table for commands, timers and triggers
- Wake-ups, cron, watches, usage-limit parking and external subscriptions all live in `jobs`; archiving an
  agent cancels its jobs. Old trigger tables are dropped by migrations (applied at boot).
