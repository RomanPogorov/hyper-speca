#!/usr/bin/env bash
# Load a backup of a live hyper database into a throwaway hyperdb cluster and compare it with the source.
#
#   SRC=postgres://hyper:…@127.0.0.1:54398/hyper ./test-restore.sh
#
# Read-only on SRC (pg_dump + count(*) + a few searches). The cluster lives in build/restore-test on
# HYPERDB_PORT (default 54410) and is stopped at the end; KEEP=1 leaves it running for manual checks.
set -euo pipefail
cd "$(dirname "$0")"
HERE=$PWD
source ./versions.env
PREFIX=${PREFIX:-$HERE/dist/pg${PG_VERSION%%.*}}
BIN=$PREFIX/bin
PORT=${HYPERDB_PORT:-54410}
T=$HERE/build/restore-test
D=$T/pgdata
: "${SRC:?set SRC to the source database URL}"
export LC_ALL=en_US.UTF-8 LANG=en_US.UTF-8
mkdir -p "$T"
L=(-h "$D" -p "$PORT" -U hyper)

say() { printf '\n== %s\n' "$*"; }

say "fresh cluster on port $PORT"
[ -f "$D/postmaster.pid" ] && "$BIN/pg_ctl" -D "$D" -m fast stop >/dev/null || true
rm -rf "$D"
"$BIN/initdb" -D "$D" -U hyper --auth=trust -E UTF8 --locale=en_US.UTF-8 >/dev/null
# Same server settings as the real one (hyper.conf), with a small shared_buffers: this is a throwaway copy.
mkdir -p "$D/conf.d"; cp "$HERE/hyper.conf" "$D/conf.d/hyper.conf"
echo "shared_buffers = 256MB" >"$D/conf.d/zz-test.conf"
cat >>"$D/postgresql.conf" <<EOF
port=$PORT
listen_addresses='127.0.0.1'
unix_socket_directories='$D'
include_dir='conf.d'
EOF
"$BIN/pg_ctl" -D "$D" -l "$T/server.log" -w start >/dev/null
"$BIN/createdb" "${L[@]}" hyper

say "pg_dump from source"
s=$(date +%s)
"$BIN/pg_dump" -d "$SRC" -Fc -f "$T/hyper.dump"
echo "dump: $(( $(date +%s)-s ))s, $(du -h "$T/hyper.dump" | cut -f1)"

say "pg_restore"
s=$(date +%s)
# PostGIS is not part of hyperdb (the live db has the extension but no geometry columns): drop its
# extensions, schemas (tiger, topology) and spatial_ref_sys from the restore list.
"$BIN/pg_restore" -l "$T/hyper.dump" \
  | grep -Ev ' (EXTENSION|COMMENT) - (EXTENSION )?postgis| SCHEMA - (tiger|topology) |COMMENT - SCHEMA (tiger|topology) | (tiger|topology) [a-z_]+ hyper$|spatial_ref_sys' >"$T/restore.list"
"$BIN/pg_restore" "${L[@]}" -d hyper --no-owner -j 8 -L "$T/restore.list" "$T/hyper.dump" >"$T/restore.log" 2>&1 || true
echo "restore: $(( $(date +%s)-s ))s"
# CREATE EXTENSION pg_search seeds paradedb._typmod_cache itself; the dump's copy of that row collides. Harmless.
errs=$(grep -E '^pg_restore: error' "$T/restore.log" | grep -v '_typmod_cache' || true)
if [ -n "$errs" ]; then echo "UNEXPECTED restore errors:"; echo "$errs"; grep -A3 'pg_restore: error' "$T/restore.log" | head -40; fi

say "row counts"
"$BIN/psql" -d "$SRC" -At >"$T/cnt.sql" <<'EOF'
select format('select %L||''=''||count(*) from %I.%I;', n.nspname||'.'||c.relname, n.nspname, c.relname)
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where c.relkind in ('r','p') and n.nspname not in ('pg_catalog','information_schema','pg_toast','topology','tiger','tiger_data')
  and not (n.nspname='public' and c.relname='spatial_ref_sys')
order by 1
EOF
"$BIN/psql" -d "$SRC" -At -f "$T/cnt.sql" >"$T/src_cnt.txt"
"$BIN/psql" "${L[@]}" hyper -At -f "$T/cnt.sql" >"$T/dst_cnt.txt"
echo "tables: $(wc -l <"$T/src_cnt.txt" | tr -d ' ')"
# Live source keeps writing (messages, events, cron_runs); report differences, don't fail on them.
diff "$T/src_cnt.txt" "$T/dst_cnt.txt" && echo "all counts equal" || echo "(differences above: rows written to the source after the dump)"

say "extensions and indexes"
"$BIN/psql" "${L[@]}" hyper -At -c "select extname||' '||extversion from pg_extension order by 1" | tr '\n' ' '; echo
bad=$("$BIN/psql" "${L[@]}" hyper -At -c "select count(*) from pg_index where not indisvalid")
"$BIN/psql" "${L[@]}" hyper -At -c "select a.amname||': '||count(*) from pg_index x join pg_class c on c.oid=x.indexrelid join pg_am a on a.oid=c.relam where a.amname in ('bm25','hnsw','ivfflat') group by a.amname"
echo "invalid indexes: $bad"

say "search: source vs hyperdb"
# Only rows that were in the dump: the source keeps growing.
MAXID=$("$BIN/psql" "${L[@]}" hyper -At -c "select coalesce(max(id),0) from messages")
fail=0
while IFS= read -r q; do
  [ -z "$q" ] && continue
  a=$("$BIN/psql" -d "$SRC" -At -c "$q" 2>&1 | tr '\n' ' ')
  b=$("$BIN/psql" "${L[@]}" hyper -At -c "$q" 2>&1 | tr '\n' ' ')
  if [ "$a" = "$b" ]; then echo "ok   $q → $b"; else echo "DIFF $q"; echo "  src: $a"; echo "  dst: $b"; fail=1; fi
done <<EOF
select count(*) from messages where content @@@ 'postgres' and id <= $MAXID
select string_agg(name, ',') from (select name from plugin_docs where description @@@ 'calendar' order by pdb.score(name) desc, name limit 3) s
select string_agg(name, ',') from (select name from functions where summary @@@ 'database' order by pdb.score(name) desc, name limit 5) s
select md5(string_agg(t::text, '|' order by id)) from paradedb._typmod_cache t
EOF

[ -n "${KEEP:-}" ] || "$BIN/pg_ctl" -D "$D" -m fast stop >/dev/null
say "result"
if [ -z "$errs" ] && [ "$bad" = 0 ] && [ $fail = 0 ]; then echo "RESTORE OK"; else echo "RESTORE FAILED"; exit 1; fi
