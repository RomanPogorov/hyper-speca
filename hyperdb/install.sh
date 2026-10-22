#!/usr/bin/env bash
# Install a built hyperdb (dist/pg18) to its final place, and optionally create the data directory and the
# hyperd unit for it.
#
#   ./install.sh                         binaries → ~/.hyper/hyperdb/pg18
#   DEST=/path ./install.sh              elsewhere
#   ./install.sh --init [--port 54411]   + initdb ~/.hyper/hyperdb/data, conf.d/hyper.conf, pg_hba (scram
#                                          everywhere), role hyper with a random password, ~/.hyper/units/hyper-db.yaml;
#                                          prints the DATABASE_URL to put into hyper's .env
#
# Binaries are relocated: every library path that points into dist/ is rewritten to DEST and re-signed, so
# `make clean` cannot break an installed server (pg_cron, psql, pg_dump link libpq). Copying goes through a
# staging dir + rsync (new inodes), so reinstalling under a running server is safe; restart it to pick up.
set -euo pipefail
cd "$(dirname "$0")"
HERE=$PWD
source ./versions.env
MAJOR=${PG_VERSION%%.*}
SRC=$HERE/dist/pg$MAJOR
DEST=${DEST:-$HOME/.hyper/hyperdb/pg$MAJOR}
DATA=${DATA:-$HOME/.hyper/hyperdb/data}
PORT=54411
INIT=
while [ $# -gt 0 ]; do
  case $1 in
    --init) INIT=1 ;;
    --port) PORT=$2; shift ;;
    *) echo "unknown option $1" >&2; exit 2 ;;
  esac
  shift
done
[ -x "$SRC/bin/postgres" ] || { echo "no build in $SRC — run make first" >&2; exit 1; }

say() { printf '== %s\n' "$*"; }

# The prefix the binaries were built for (dist/ here, or the CI runner's path for a release tarball unpacked
# into dist/): read it from libpq's install name.
ORIG=$(otool -D "$SRC/lib/libpq.5.dylib" | sed -n 2p); ORIG=${ORIG%/lib/libpq.5.dylib}
say "stage $SRC (built for $ORIG) → $DEST"
STAGE=$(mktemp -d); trap 'rm -rf "$STAGE"' EXIT
cp -a "$SRC/." "$STAGE/"
n=0
while IFS= read -r f; do
  file "$f" | grep -q 'Mach-O' || continue
  changed=
  id=$(otool -D "$f" | sed -n 2p)
  case $id in "$ORIG"/*) install_name_tool -id "$DEST${id#"$ORIG"}" "$f" 2>/dev/null; changed=1 ;; esac
  # Rust's cdylib keeps its build path as its own id; harmless but point it at the installed file.
  case $id in */target/release/*) install_name_tool -id "$DEST/${f#"$STAGE/"}" "$f" 2>/dev/null; changed=1 ;; esac
  for dep in $(otool -L "$f" | tail -n +2 | awk '{print $1}'); do
    case $dep in "$ORIG"/*) install_name_tool -change "$dep" "$DEST${dep#"$ORIG"}" "$f" 2>/dev/null; changed=1 ;; esac
  done
  if [ -n "$changed" ]; then codesign -f -s - "$f" 2>/dev/null; n=$((n+1)); fi
done < <(find "$STAGE" -type f \( -perm -u+x -o -name '*.dylib' \))
echo "relocated $n files"
left=$(find "$STAGE" -type f \( -perm -u+x -o -name '*.dylib' \) -exec sh -c 'otool -L "$1" 2>/dev/null | grep -F "$2" >/dev/null && echo "$1"' _ {} "$ORIG/" \; | head -3)
[ -z "$left" ] || { echo "still pointing into $ORIG: $left" >&2; exit 1; }
mkdir -p "$DEST"
rsync -a --delete "$STAGE/" "$DEST/"
"$DEST/bin/postgres" --version

[ -n "$INIT" ] || exit 0

export LC_ALL=en_US.UTF-8 LANG=en_US.UTF-8
[ -e "$DATA/PG_VERSION" ] && { echo "$DATA already initialized — not touching it" >&2; exit 1; }
say "initdb $DATA (port $PORT)"
umask 077
PW=$(openssl rand -hex 24)
PWF=$(mktemp); printf '%s' "$PW" >"$PWF"
"$DEST/bin/initdb" -D "$DATA" -U hyper --pwfile="$PWF" --auth=scram-sha-256 -E UTF8 --locale=en_US.UTF-8 >/dev/null
rm -f "$PWF"
cat >>"$DATA/postgresql.conf" <<EOF

# hyperdb — managed by hyperd (~/.hyper/units/hyper-db.yaml)
port = $PORT
listen_addresses = '127.0.0.1'
unix_socket_directories = '/tmp'
include_dir = 'conf.d'
EOF
mkdir -p "$DATA/conf.d"; cp "$HERE/hyper.conf" "$DATA/conf.d/hyper.conf"
cat >"$DATA/pg_hba.conf" <<'EOF'
# TYPE  DATABASE  USER  ADDRESS        METHOD
local   all       all                  scram-sha-256
host    all       all   127.0.0.1/32   scram-sha-256
host    all       all   ::1/128        scram-sha-256
EOF

UNIT=$HOME/.hyper/units/hyper-db.yaml
if [ -e "$UNIT" ]; then echo "$UNIT exists — left as is"; else
  mkdir -p "$(dirname "$UNIT")"
  cat >"$UNIT" <<EOF
# Main hyper Postgres (hyperdb: PG $MAJOR + pg_search, pgvector, pg_cron, pg_ivm). Managed by hyperd.
kind: service
cmd: ["$DEST/bin/postgres", "-D", "$DATA"]
env: { LC_ALL: en_US.UTF-8, LANG: en_US.UTF-8 }
ready: { exec: ["$DEST/bin/pg_isready", "-h", "/tmp", "-p", "$PORT", "-U", "hyper"], timeoutMs: 120000 }
restart: { policy: always, backoffMs: [1000, 30000] }
stop: { signal: SIGINT, timeoutMs: 60000 }
autostart: true
EOF
  echo "wrote $UNIT — start it: bun hyperd/cli.ts reload (or ctx.fns.hyperd.reload({}))"
fi
echo
echo "Then create the database once it is up:  PGPASSWORD=… $DEST/bin/createdb -h /tmp -p $PORT -U hyper hyper"
echo "DATABASE_URL for hyper's .env (socket — some machines filter TCP on loopback per user):"
echo "  postgres://hyper:$PW@localhost:$PORT/hyper?path=/tmp/.s.PGSQL.$PORT"
