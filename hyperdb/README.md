# hyperdb

PostgreSQL 18 with the extensions hyper needs, built from source into one prefix, to run the main hyper
database natively under hyperd instead of the paradedb Docker image.

| component  | version | why |
|------------|---------|-----|
| PostgreSQL | 18.6    | server |
| pg_search  | 0.21.8  | BM25 indexes (messages, functions, plugin_docs); built with cargo-pgrx 0.16.1 |
| pgvector   | 0.8.1   | hnsw indexes on embeddings |
| pg_cron    | 1.6.8   | preloaded |
| pg_ivm     | 1.13    | installed in the db (no IMMVs yet) |
| contrib    | —       | pg_trgm, fuzzystrmatch, pg_stat_statements |

Versions and sha256 of the source archives are pinned in `versions.env`. PostGIS is not built: the old
database had the extension but no geometry columns.

## Files

| file | what |
|------|------|
| `versions.env` | pinned versions + sha256 |
| `build.sh` | build steps `pg vector cron ivm search check` into `dist/pg18` |
| `install.sh` | copy `dist/pg18` to `~/.hyper/hyperdb/pg18`, rewriting library paths; `--init` also creates data dir, config, role and hyperd unit |
| `hyper.conf` | server settings, installed as `<data>/conf.d/hyper.conf` |
| `test-restore.sh` | dump a live database, restore into a throwaway cluster, compare |
| `sums.sh` | check / `--update` the sha256 pins and the pgrx version |

## Commands

```
make            # build + smoke check (~10 min: pg_search ~9, the rest ~1)
make install    # → ~/.hyper/hyperdb/pg18 (DEST=… elsewhere); restart hyper-db to pick up
make init       # first setup on a machine: install + initdb + hyperd unit; prints DATABASE_URL
SRC=postgres://… make restore   # check a build against a copy of a live db (port HYPERDB_PORT=54410)
make sums       # are the pins right?   ./sums.sh --update after changing a version
make package    # dist/hyperdb-<pg>-arm64.tar.gz
make clean      # drop build/ (~7 GB) and dist/
```

Needs Homebrew `icu4c`, `openssl@3`, `readline`, `lz4`, `zstd`, `pkgconf` and `cargo`. Sources, the pgrx
toolchain and logs stay in `build/` (`build/logs/<step>.log`); nothing is installed outside `build/`,
`dist/` and the install prefix. The binaries link those Homebrew libraries, so the target machine needs them.

## How it runs on hyper-design

- binaries `~/.hyper/hyperdb/pg18`, data `~/.hyper/hyperdb/data`, port 54411, socket `/tmp/.s.PGSQL.54411`
- hyperd unit `~/.hyper/units/hyper-db.yaml`: `bun hyperd/cli.ts status|restart|logs hyper-db`
- settings `~/.hyper/hyperdb/data/conf.d/hyper.conf` (copy of `hyper.conf`): change, then
  `pg_ctl reload`, or `restart hyper-db` for shared_buffers / max_worker_processes
- `pg_hba`: scram-sha-256 everywhere, socket mode 0700; role `hyper` has a random password kept only in `.env`
- hyper connects through the socket: `DATABASE_URL=postgres://hyper:…@localhost:54411/hyper?path=/tmp/.s.PGSQL.54411`
  (TCP to 127.0.0.1 is filtered per user on that machine)

## Upgrading

1. Change a version in `versions.env`, run `./sums.sh --update` (it also follows pg_search's pinned pgrx).
2. `make` — fails on a sha mismatch, a build error (see `build/logs`) or the smoke check.
3. `SRC=<live url> make restore` — the live data still loads and searches the same.
4. `make install`, `bun hyperd/cli.ts restart hyper-db` (a few seconds of downtime).

A new PostgreSQL major (19) needs a data migration (pg_dump/pg_restore or pg_upgrade), not just a restart.

## Moving a database onto hyperdb (what was done 2026-10-22)

1. `make && make init`, start the unit, `createdb hyper`.
2. `make restore` against the old db until it says RESTORE OK.
3. Window (~30 s): point `DATABASE_URL` at the new db, stop hyper (launchd restarts it), `pg_dump -Fc` the
   old db, `pg_restore -j 8 --no-owner` into `hyper_new` without the PostGIS objects, compare row counts of
   every table and index validity, `ALTER DATABASE hyper_new RENAME TO hyper`.
4. Rollback: put the old `DATABASE_URL` back and restart hyper. The old db is left untouched.

The only expected restore error is `paradedb._typmod_cache` (CREATE EXTENSION pg_search seeds that row).
