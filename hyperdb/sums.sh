#!/usr/bin/env bash
# Check (default) or rewrite (--update) the *_SHA256 lines in versions.env against the real source archives.
# After bumping a version in versions.env: ./sums.sh --update, review the diff, commit.
set -euo pipefail
cd "$(dirname "$0")"
source ./versions.env
update=${1:-}
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
rc=0
check() { # VAR url
  local var=$1 url=$2 got want
  curl -fsSL "$url" -o "$tmp/f" || { echo "download failed: $url" >&2; exit 1; }
  got=$(shasum -a 256 "$tmp/f" | cut -d' ' -f1); want=${!var:-}
  if [ "$got" = "$want" ]; then echo "ok   $var"; return; fi
  if [ "$update" = --update ]; then
    if grep -q "^$var=" versions.env; then sed -i '' "s/^$var=.*/$var=$got/" versions.env; else echo "$var=$got" >>versions.env; fi
    echo "set  $var=$got"
  else echo "DIFF $var: versions.env=$want real=$got"; rc=1; fi
}
check PG_SHA256       "https://ftp.postgresql.org/pub/source/v$PG_VERSION/postgresql-$PG_VERSION.tar.bz2"
check PGVECTOR_SHA256 "https://github.com/pgvector/pgvector/archive/refs/tags/v$PGVECTOR_VERSION.tar.gz"
check PG_CRON_SHA256  "https://github.com/citusdata/pg_cron/archive/refs/tags/v$PG_CRON_VERSION.tar.gz"
check PG_IVM_SHA256   "https://github.com/sraoss/pg_ivm/archive/refs/tags/v$PG_IVM_VERSION.tar.gz"
check PG_SEARCH_SHA256 "https://github.com/paradedb/paradedb/archive/refs/tags/v$PG_SEARCH_VERSION.tar.gz"
# pg_search pins pgrx in its Cargo.toml; keep PGRX_VERSION in step with it.
pinned=$(curl -fsSL "https://raw.githubusercontent.com/paradedb/paradedb/v$PG_SEARCH_VERSION/Cargo.toml" | sed -nE 's/^pgrx = "=?([0-9.]+)"/\1/p' | head -1)
if [ "$pinned" = "$PGRX_VERSION" ]; then echo "ok   PGRX_VERSION ($pinned)"
elif [ "$update" = --update ]; then sed -i '' "s/^PGRX_VERSION=.*/PGRX_VERSION=$pinned/" versions.env; echo "set  PGRX_VERSION=$pinned"
else echo "DIFF PGRX_VERSION: versions.env=$PGRX_VERSION pg_search pins $pinned"; rc=1; fi
exit $rc
