#!/usr/bin/env bash
# Build hyperdb: PostgreSQL 18 + the extensions hyper needs, into one self-contained prefix.
#
#   ./build.sh                 build everything (skips steps already done)
#   ./build.sh pg vector       build only the named steps
#   PREFIX=/path ./build.sh    install somewhere else (default: dist/pg<major>)
#
# Steps: pg vector cron ivm search check. Sources and the Rust toolchain for pgrx live under build/,
# nothing is installed outside build/ and $PREFIX. Needs Homebrew deps: icu4c, openssl, readline, lz4,
# zstd, krb5, pkgconf; cargo/rustc for pg_search.
set -euo pipefail
cd "$(dirname "$0")"
HERE=$PWD
source ./versions.env
PG_MAJOR=${PG_VERSION%%.*}
PREFIX=${PREFIX:-$HERE/dist/pg$PG_MAJOR}
B=$HERE/build
SRC=$B/src
LOG=$B/logs
mkdir -p "$SRC" "$LOG" "$PREFIX"
JOBS=${JOBS:-$(sysctl -n hw.ncpu 2>/dev/null || /usr/sbin/sysctl -n hw.ncpu)}
PG_CONFIG=$PREFIX/bin/pg_config
export LC_ALL=en_US.UTF-8 LANG=en_US.UTF-8
# Called from the Makefile, the inner makes would run at MAKELEVEL 1, and PostgreSQL generates its headers
# (errcodes.h, catalog/*_d.h) only at level 0 — a parallel build then fails on missing headers.
unset MAKELEVEL MAKEFLAGS MFLAGS

BREW=$(brew --prefix)
dep() { brew --prefix "$1" 2>/dev/null; }
ICU=$(dep icu4c@78 || dep icu4c)
SSL=$(dep openssl@3 || dep openssl@4)
export PKG_CONFIG_PATH="$ICU/lib/pkgconfig:$SSL/lib/pkgconfig:$(dep readline)/lib/pkgconfig:$(dep lz4)/lib/pkgconfig:$(dep zstd)/lib/pkgconfig:$(dep krb5)/lib/pkgconfig"

say() { printf '\n== %s\n' "$*"; }
sha() { shasum -a 256 "$1" | cut -d' ' -f1; }
fetch() { # url file [sha256]
  if [ ! -f "$SRC/$2" ]; then
    curl -fsSL "$1" -o "$SRC/$2.part" || { echo "download failed: $1" >&2; exit 1; }
    mv -f "$SRC/$2.part" "$SRC/$2"
  fi
  if [ -n "${3:-}" ] && [ "$(sha "$SRC/$2")" != "$3" ]; then
    echo "sha256 mismatch for $2: $(sha "$SRC/$2") != $3 (run ./sums.sh --update after a version bump)" >&2; exit 1
  fi
}
untar() { # file dir
  [ -d "$SRC/$2" ] || (cd "$SRC" && tar xf "$1")
}
run() { # name cmd...  — output into build/logs/<name>.log, tail on failure
  local name=$1; shift
  if ! "$@" >>"$LOG/$name.log" 2>&1; then echo "FAILED: $name (see $LOG/$name.log)"; tail -30 "$LOG/$name.log"; exit 1; fi
}

step_pg() {
  say "postgresql $PG_VERSION → $PREFIX"
  fetch "https://ftp.postgresql.org/pub/source/v$PG_VERSION/postgresql-$PG_VERSION.tar.bz2" "postgresql-$PG_VERSION.tar.bz2" "${PG_SHA256:-}"
  untar "postgresql-$PG_VERSION.tar.bz2" "postgresql-$PG_VERSION"
  cd "$SRC/postgresql-$PG_VERSION"
  : >"$LOG/pg.log"
  run pg ./configure --prefix="$PREFIX" \
    --with-icu --with-openssl --with-lz4 --with-zstd --with-libxml --with-libxslt \
    --with-uuid=e2fs --with-readline --with-extra-version=" (hyperdb)" \
    --with-includes="$(dep readline)/include:$SSL/include:$ICU/include" \
    --with-libraries="$(dep readline)/lib:$SSL/lib:$ICU/lib:$BREW/lib"
  run pg make -j"$JOBS" world-bin
  run pg make install-world-bin
  cd "$HERE"
  "$PG_CONFIG" --version
}

step_vector() {
  say "pgvector $PGVECTOR_VERSION"
  fetch "https://github.com/pgvector/pgvector/archive/refs/tags/v$PGVECTOR_VERSION.tar.gz" "pgvector-$PGVECTOR_VERSION.tar.gz" "${PGVECTOR_SHA256:-}"
  untar "pgvector-$PGVECTOR_VERSION.tar.gz" "pgvector-$PGVECTOR_VERSION"
  : >"$LOG/vector.log"
  # OPTFLAGS="" — no -march=native, the build must run on any Apple Silicon.
  run vector make -C "$SRC/pgvector-$PGVECTOR_VERSION" PG_CONFIG="$PG_CONFIG" OPTFLAGS="" -j"$JOBS"
  run vector make -C "$SRC/pgvector-$PGVECTOR_VERSION" PG_CONFIG="$PG_CONFIG" OPTFLAGS="" install
}

step_cron() {
  say "pg_cron $PG_CRON_VERSION"
  fetch "https://github.com/citusdata/pg_cron/archive/refs/tags/v$PG_CRON_VERSION.tar.gz" "pg_cron-$PG_CRON_VERSION.tar.gz" "${PG_CRON_SHA256:-}"
  untar "pg_cron-$PG_CRON_VERSION.tar.gz" "pg_cron-$PG_CRON_VERSION"
  : >"$LOG/cron.log"
  run cron make -C "$SRC/pg_cron-$PG_CRON_VERSION" PG_CONFIG="$PG_CONFIG" -j"$JOBS"
  run cron make -C "$SRC/pg_cron-$PG_CRON_VERSION" PG_CONFIG="$PG_CONFIG" install
}

step_ivm() {
  say "pg_ivm $PG_IVM_VERSION"
  fetch "https://github.com/sraoss/pg_ivm/archive/refs/tags/v$PG_IVM_VERSION.tar.gz" "pg_ivm-$PG_IVM_VERSION.tar.gz" "${PG_IVM_SHA256:-}"
  untar "pg_ivm-$PG_IVM_VERSION.tar.gz" "pg_ivm-$PG_IVM_VERSION"
  : >"$LOG/ivm.log"
  run ivm make -C "$SRC/pg_ivm-$PG_IVM_VERSION" PG_CONFIG="$PG_CONFIG" -j"$JOBS"
  run ivm make -C "$SRC/pg_ivm-$PG_IVM_VERSION" PG_CONFIG="$PG_CONFIG" install
}

step_search() {
  say "pg_search $PG_SEARCH_VERSION (pgrx $PGRX_VERSION)"
  # Private cargo home: cargo-pgrx of the exact version pg_search pins, and pgrx's config, stay in build/.
  export CARGO_HOME=$B/cargo PGRX_HOME=$B/pgrx
  mkdir -p "$CARGO_HOME" "$PGRX_HOME"
  : >"$LOG/search.log"
  if ! "$CARGO_HOME/bin/cargo-pgrx" pgrx --version 2>/dev/null | grep -q "$PGRX_VERSION"; then
    run search cargo install --locked cargo-pgrx --version "$PGRX_VERSION" --root "$CARGO_HOME"
  fi
  export PATH=$CARGO_HOME/bin:$PATH
  run search cargo pgrx init --pg"$PG_MAJOR"="$PG_CONFIG"
  fetch "https://github.com/paradedb/paradedb/archive/refs/tags/v$PG_SEARCH_VERSION.tar.gz" "paradedb-$PG_SEARCH_VERSION.tar.gz" "${PG_SEARCH_SHA256:-}"
  untar "paradedb-$PG_SEARCH_VERSION.tar.gz" "paradedb-$PG_SEARCH_VERSION"
  cd "$SRC/paradedb-$PG_SEARCH_VERSION/pg_search"
  # The repo pins an older rust-toolchain for rustup; without rustup the Homebrew rustc is used.
  run search cargo pgrx install --release --pg-config "$PG_CONFIG" --no-default-features --features "pg$PG_MAJOR"
  cd "$HERE"
}

step_check() {
  say "check: initdb + CREATE EXTENSION on a throwaway cluster"
  local d; d=$(mktemp -d); local port=${CHECK_PORT:-54419}
  "$PREFIX/bin/initdb" -D "$d" -U hyper --auth=trust -E UTF8 --locale=en_US.UTF-8 >/dev/null
  printf "port=%s\nlisten_addresses=''\nunix_socket_directories='%s'\nshared_preload_libraries='pg_search,pg_cron,pg_stat_statements'\n" "$port" "$d" >>"$d/postgresql.conf"
  "$PREFIX/bin/pg_ctl" -D "$d" -l "$d/log" -w start >/dev/null
  local rc=0
  for e in pg_search vector pg_ivm pg_cron pg_trgm fuzzystrmatch pg_stat_statements; do
    "$PREFIX/bin/psql" -h "$d" -p "$port" -U hyper postgres -qAtc "create extension $e" || rc=1
  done
  "$PREFIX/bin/psql" -h "$d" -p "$port" -U hyper postgres -Atc "select version()" \
    -c "select extname||' '||extversion from pg_extension order by 1" \
    -c "create table t(id int primary key, body text); insert into t values (1,'hello hyper'),(2,'other');
        create index t_bm25 on t using bm25(id, body) with (key_field=id);
        select 'bm25 hit: '||id from t where body @@@ 'hyper'" || rc=1
  "$PREFIX/bin/pg_ctl" -D "$d" -m fast stop >/dev/null; rm -rf "$d"
  [ $rc = 0 ] && echo "CHECK OK" || { echo "CHECK FAILED"; exit 1; }
}

steps=("$@"); [ ${#steps[@]} = 0 ] && steps=(pg vector cron ivm search check)
for s in "${steps[@]}"; do "step_$s"; done
