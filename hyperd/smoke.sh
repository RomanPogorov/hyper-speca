#!/usr/bin/env bash
# End-to-end check of a hyperd checkout on this machine, in a throwaway HYPERD_HOME (does not touch your daemon):
# daemon up, unit file with readiness, dependent task, transient run with env, PTY session input,
# daemon restart with a live service (same pid after), stop of the whole process group, clean exit.
#   bash hyperd/smoke.sh
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
tmp="$(mktemp -d "${TMPDIR:-/tmp}/hyperd-smoke-XXXXXX")"
export HYPERD_HOME="$tmp/home" HYPERD_UNITS="$tmp/units" HYPERD_TICK_MS=100
mkdir -p "$HYPERD_UNITS"
cli() { bun "$here/cli.ts" "$@"; }
pass() { printf 'ok   %s\n' "$1"; }
fail() { printf 'FAIL %s\n' "$1"; cli status || true; exit 1; }
wait_for() { local i; for i in $(seq 1 "${3:-60}"); do if eval "$2"; then pass "$1"; return; fi; sleep 0.2; done; fail "$1"; }
cleanup() {
  [ -n "${daemon:-}" ] && kill "$daemon" 2>/dev/null || true
  pkill -f "$tmp" 2>/dev/null || true
  sleep 0.3; pkill -9 -f "$tmp" 2>/dev/null || true
  rm -rf "$tmp"
}
trap cleanup EXIT

cat > "$HYPERD_UNITS/web.yaml" <<'EOF'
kind: service
cmd: "echo booting; sleep 0.5; echo listening; exec sleep 1000"
ready: { log: listening }
EOF
cat > "$HYPERD_UNITS/after-web.yaml" <<'EOF'
kind: task
cmd: "echo web is up"
after: [web]
autostart: true
EOF

bun "$here/main.ts" >"$tmp/daemon.log" 2>&1 & daemon=$!
wait_for "daemon answers" 'cli status >/dev/null 2>&1'
wait_for "service becomes ready from its log" 'cli status | grep -q "^web .* ready"'
wait_for "dependent task ran after it" 'cli logs after-web 2>/dev/null | grep -q "web is up"'

cli run greet -- bash -c 'echo "hello $WHO"' >/dev/null
wait_for "transient run" 'cli logs greet | grep -q "hello"'

cli run sh --pty -- bash --norc -i >/dev/null
sleep 0.5; cli send sh 'X=42' ; cli send sh 'echo "x is $X"'
wait_for "pty session keeps shell state" 'cli logs sh | grep -q "x is 42"'

pid="$(cli status | awk '/^web /{print $5}')"
kill "$daemon"; wait "$daemon" 2>/dev/null || true
kill -0 "$pid" 2>/dev/null && pass "service survives daemon stop (pid $pid)" || fail "service survives daemon stop"
bun "$here/main.ts" >>"$tmp/daemon.log" 2>&1 & daemon=$!
wait_for "daemon is back" 'cli status >/dev/null 2>&1'
wait_for "service adopted with the same pid" '[ "$(cli status | awk "/^web /{print \$5}")" = "$pid" ]'

cli stop web >/dev/null; cli stop sh >/dev/null
wait_for "stop ends the service" '! kill -0 "$pid" 2>/dev/null'
wait_for "pty session stopped" 'cli status | grep -q "^sh .* exited"'
echo "all ok"
