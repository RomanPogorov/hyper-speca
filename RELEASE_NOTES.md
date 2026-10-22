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
- Safe by default: secrets passed with `run({ env })` stay in hyperd's memory and never touch disk; only one
  daemon runs per home (exclusive pid file plus a socket check); after a reboot a reused pid is not taken for
  a live process; if a holder dies, its orphaned process group is killed before a restart, so a service never
  runs twice. The daemon started on demand by hyper gets only a minimal environment, not the server's keys.
  Under launchd/systemd a second copy waits for the running daemon to exit instead of restart-looping.
- Background job units: a task without a pty gets no stdin (EOF at once, like tmux jobs); the last output is
  kept when a job ends; finished job units and their logs are removed after a day (`HYPERD_GC_MS`).
- Not yet: rotation of the event journal; Linux/systemd is covered by unit tests but not run live yet.
- To try it: `bun hyperd/cli.ts install`, follow the printed commands, `bun hyperd/cli.ts doctor`, then set
  `jobs.backend = hyperd`. Switch back by setting it to `tmux`; nothing else to migrate.

### Telegram bot can send pictures
- `telegram.botSendPhoto({ chatId, path, caption?, confirm: true })` sends one JPEG, PNG or WebP (up to 10 MB)
  with an optional caption. Same rules as `botSendMessage`: only chats listed in `telegram.botAllowedChatIds`,
  only with `confirm: true`, no retries.

### Background jobs are easier for agents to find and use
- System prompt names every call in full (`ctx.fns.agent.wake/cron/watch`, `jobs.list/cancel`), explains that
  commands and triggers are rows of one jobs table, lists watch predicate options, and says that cancel is
  silent.
- `wake`, `cron` and `watch` return a `hint` with how to list and cancel; the bash background result points
  to `jobs.list`. A command with no output now says "Output: none".
- `agent.wakeIn` / `agent.wakeUpWhen` are deprecated in favour of `agent.wake` / `agent.watch`.

### Jobs: background commands, timers and triggers in one table
- `bash({ background: true })` / `jobs.start` run a command in tmux (locally or over SSH) that survives a Hyper
  restart; the agent gets one message with exit code, duration and output tail when it ends. `jobs.list`,
  `jobs.get`, `jobs.logs` (secrets masked), `jobs.cancel` (silent). A "to background" button moves a running
  bash call into a job. Jobs that end within 2 s arrive in one turn.
- Wake-ups (`agent.wake`), cron (`agent.cron`), watches (`agent.watch`), usage-limit parking and external
  subscriptions (`agent.attach`) are rows of the same `jobs` table, with firings audited in `job_runs`.
  Archiving an agent cancels its jobs; stopping a turn does not.
- Every runtime message to an agent (job end, trigger, watch, attachment, team update) goes through
  `agent.deliver`: message, state and wake-up commit in one transaction, so none is lost or doubled.
- Upgrade: migrations run at boot, copy rows from `agent_triggers`, `agent_trigger_runs`, `agent_watches`,
  `agent_attachments` and `agents.wake_at` into `jobs` and drop the old tables. Nothing to do by hand.
  Code that read those tables directly must use `jobs.list` / `agent.triggers`. Docs: `docs/jobs.md`.
