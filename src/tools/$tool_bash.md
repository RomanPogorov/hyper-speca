---
description: >-
  Run a shell command via `bash -c`. Runs in the agent's workspace unless cwd says otherwise.
  Returns stdout; a non-zero exit returns [exit N] with stderr, and a command that outruns
  timeout is killed and reported with whatever it printed.
marker: bash
promptSnippet: "run shell commands (ls, git, tests)"
promptGuidelines:
  - "To work on another machine pass host (an alias from ~/.ssh/config, list with ctx.fns.remote.servers({})) to bash, read, write or edit — no ssh quoting needed; the connection is kept open between calls."
  - "Give bash a timeout when a command could hang (a server, a watcher, a prompt) — and make it generous: a slow search needs minutes, and a timeout that is too tight kills work that was about to succeed."
  - "For anything that takes more than a minute or two (builds, full test suites, deploys, downloads, a server that must come up) pass background: true: the call returns a job id at once, the command keeps running in tmux, and you get ONE message with exit code and output tail when it ends — end your turn instead of waiting or polling. Several jobs can run at once. jobs.logs({ id }) reads full output, jobs.cancel({ id }) stops one, jobs.list({}) shows what is running."
  - "To locate files use the find tool and to search contents use grep; `bash find ~` walks every node_modules on the machine and dies on the clock."
parameters:
  type: object
  properties:
    host:
      type: string
      description: "SSH server alias from ~/.ssh/config (list: ctx.fns.remote.servers({})), or \"local\". Omit to run in the agent workspace — local, or remote when the workspace has a host (then cwd defaults to the workspace dir). Remote commands run via bash -lc over a persistent connection."
    command:
      type: string
      description: "Shell script to run."
    cwd:
      type: string
      description: "Directory to run in. Relative paths resolve against the workspace. Defaults to the workspace."
    env:
      type: object
      description: "Extra environment variables, merged over the server's own environment."
      additionalProperties:
        type: string
    secrets:
      type: object
      description: "Secret environment variables. Values must be op://, env:// or secret://namespace/name references (the latter written by secrets.set or secureInput.prompt({ saveAs })); resolved values are redacted from output."
      additionalProperties:
        type: string
    timeout:
      type: integer
      description: "Seconds before the command is killed. No timeout by default; with background: true the default is 24 h."
    background:
      type: boolean
      description: "Run as a background job: returns a job id immediately, the command runs in tmux (local or host) and survives a Hyper restart; when it exits you receive one message with exit code, duration and output tail. Do not wait or poll for it — end your turn."
    notify:
      type: string
      description: "With background: true — an instruction included in the completion message, e.g. \"if tests pass, commit\"."
  required: [command]
  additionalProperties: false
---
### `§bash`

- Runs the body as a shell script via `bash -c`, in the workspace directory.
- `secrets` maps environment variable names to `op://`, `env://` or `secret://namespace/name` references. Values are injected only into the child process and redacted from captured output. A `secret://` entry is created with `secureInput.prompt({ title, saveAs: "secret://ns/name" })` (the human types it, the model only sees the reference) or `secrets.set({ ref, value })`.
- stdout comes back as the result; a non-zero exit returns `[exit N]` with stderr.

Example:

```ts
await ctx.fns.tools.bash({
  command: 'curl -H "Authorization: Bearer $TOKEN" https://api.example.com/me',
  secrets: { TOKEN: 'op://vault/item/field' },
  timeout: 30,
});
```

The model-visible command contains only `$TOKEN` and the secret reference. The resolved value exists in the child process environment and occurrences in captured stdout/stderr are replaced with `[REDACTED]`. `secrets` overrides variables with the same name from `env`.

This prevents accidental transcript leakage, not malicious exfiltration: the invoked program can still read the environment and send it over the network. Do not use `set -x`, place secret values in command arguments, or print the environment.
- `background: true` turns the call into a job (`ctx.fns.jobs.start`): the result is the job id, the command runs detached in tmux on the target host with output in `~/.hyper-jobs/<id>/out.log`. When it exits the agent gets one `job` message (exit code, duration, last ~4 KB of output, an optional `notify` instruction); jobs ending within ~2 s of each other arrive in one turn. A job you cancel with `jobs.cancel` does not wake you. If the process disappears (machine reboot) the job is reported as `lost`.
- The marker form takes no options — use the `bash` tool call for cwd / env / secrets / timeout.
