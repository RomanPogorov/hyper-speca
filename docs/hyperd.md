# hyperd — process supervisor

hyperd keeps processes running for you and for agents: databases, dev servers, background commands, terminal
sessions. Every process runs under its own small holder, so restarting hyper (or hyperd) does not kill it.
State is in files under `~/.hyper/run/hyperd/` (hyperd may be what starts the database).

## Services: write a unit file

`~/.hyper/units/<name>.yaml` (also `.json`, `.jsonc`, `.ts` with `export default { ... }`):

```yaml
kind: service                 # service = keep alive | task = run once | session = terminal
cmd: ["bun", "run", "dev"]    # argv, or a string run through bash -lc
cwd: ~/projects/web
env: { PORT: "3000" }         # values are strings — quote numbers
after: [pg-test]              # start once these are ready
ready: { http: "http://127.0.0.1:3000/health" }   # or tcp: 3000 | exec: [...] | log: "listening"
restart: { policy: on-failure, backoffMs: [1000, 30000], maxRestarts: 0 }
stop: { signal: SIGTERM, timeoutMs: 10000 }       # whole process group; SIGKILL after the timeout
logMatch: ["/error/i"]        # emit a log_match event for matching lines
ttlMs: 3600000                # optional: stop after this long
```

Then `hyperd.reload({})` (or `bun hyperd/cli.ts reload`). Unknown keys and wrong types are rejected with the
field name. A file named `web.yaml` is unit `web` unless it sets `name`.

Real example on this machine: `~/.hyper/units/pg-test.yaml` (test Postgres, port 54400).

## From an agent (ctx.fns.hyperd.*)

| Call | What it does |
|---|---|
| `status({})` | all units: state, pid, run, last exit |
| `reload({})` | reread unit files, start new services |
| `start / stop / restart({ name })` | control one unit |
| `run({ name, cmd, kind?, cwd?, env?, pty?, ttlMs?, logMatch? })` | transient unit without a file (like `systemd-run`); env is not stored |
| `logs({ name, offset?, limit? })` | output by byte offset; pass `next` to continue |
| `send({ name, data })` | input into a pty unit (`"\n"` = Enter) |
| `events({ after, waitMs? })` | event journal: started, ready, exited, restarting, gave_up, log_match … |

Background commands of agents (`bash({ background: true })`, `jobs.start`) run as hyperd task units named
after the job id when the setting `jobs.backend` is `hyperd` (local jobs only; SSH hosts use tmux). Use the
jobs functions for them, not hyperd directly.

States: `waiting` (for after) → `starting` (ready check) → `ready` → `stopping` → `exited` | `failed`;
`backoff` between restarts.

## CLI

```
bun hyperd/cli.ts status | reload | start|stop|restart <u> | logs <u> [-f] [--offset N]
                  run <name> [--pty] -- <cmd...> | send <u> <text> | attach <u> | events [-f] [--after N]
```

`attach` connects your terminal to a pty unit; detach with Ctrl-\.

## Where things are

- code: `hyperd/` (main.ts daemon, holder.ts, Unit.ts, cli.ts, client.ts), hyper client `src/hyperd/`
- unit files: `~/.hyper/units/` (`HYPERD_UNITS`), state: `~/.hyper/run/hyperd/` (`HYPERD_HOME`)
- per unit: `units/<name>/spec.json`, `state.json`, `run-<n>/out.log`, `exit.json`, `pty.sock`
- the daemon is started on demand by `hyperd.ensure` (from hyper); a launchd/systemd unit for hyperd itself is
  the next step. Design and plan: `docs/hyperd-design.md`.
