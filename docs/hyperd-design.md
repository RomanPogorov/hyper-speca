# hyperd — дизайн (черновик)

Маленький демон на Bun, нечто среднее между tmux, загрузчиком и systemd/podman: по декларативным файлам
поднимает и держит процессы, от базы и самого hyper до фоновых задач агентов. Статус: на обсуждение,
кода нет.

## Зачем

- Перезапуск hyper сейчас убивает или осиротевает фоновые задачи; tmux — внешняя зависимость без логов и событий.
- Postgres, hyper и серверы проектов поднимаются разными способами (launchd, вручную, tmux).
- Нет единого места «что у меня запущено, почему упало, где лог».

## Цели и не-цели

Цели: декларативные юниты; процессы переживают перезапуск и hyper, и самого hyperd; логи с офсетами;
push-события в hyper; терминальные сессии с attach/вводом; изоляция по желанию.
Не-цели: свой контейнерный рантайм (берём podman / Apple `container`), кластер, замена launchd/systemd
целиком (они запускают только hyperd).

## Слои

```
launchd / systemd --user         запускает только hyperd (KeepAlive), один раз
  hyperd (Bun, ~1-2k строк)      юниты, порядок, health, рестарты, события, control API
    holder (на каждый процесс)    держит PTY/pipes, пишет лог, unix-сокет для attach, exit-код
      процесс                     postgres, hyper, bun run dev, команда агента, podman run ...
hyper  ── клиент hyperd           jobs = вид агента на процессы; уведомления через agent.deliver
```

Главное решение — **holder на процесс** (как dtach/abduco): маленький отвязанный (setsid) процесс владеет
PTY и логом. Поэтому перезапуск hyperd не трогает процессы: при старте он сканирует run-каталог и
переподключается к живым holder'ам. Прототип cj это уже показал (Bun 1.4: `Bun.spawn({ terminal })`,
`detached`, `kill(-pgid)`).

## Юниты

Три вида: `service` (держать живым), `task` (разовая команда), `session` (терминал как в tmux).

```toml
# ~/.hyper/units/postgres.toml
kind = "service"
cmd = ["/opt/homebrew/opt/postgresql@18/bin/postgres", "-D", "~/.hyper/pg", "-p", "54393"]
restart = { policy = "always", backoffMs = [1000, 30000] }
ready = { exec = ["pg_isready", "-p", "54393"], timeoutMs = 30000 }
stop = { signal = "SIGINT", timeoutMs = 30000 }
logs = { maxBytes = "50MB", keep = 3 }

# ~/.hyper/units/hyper.toml
kind = "service"
cmd = ["bun", "src/$main.ts"]
cwd = "~/hyper-code2"
after = ["postgres"]          # стартует после ready postgres
ready = { http = "http://127.0.0.1:3070/health" }
restart = { policy = "always" }

# <project>/.hyper/units/web.toml
kind = "service"
cmd = ["bun", "run", "dev"]
cwd = "apps/web"
env = { PORT = "3000" }
ready = { log = "ready on" }  # совпадение строки в выводе
isolation = { type = "container", image = "oven/bun:1.4" }   # none | sandbox | container
```

Поля: `kind, cmd, cwd, env, envFile, after/requires, ready (http|tcp|exec|log), health (то же + interval),
restart (no|on-failure|always, backoff, maxRestarts), stop (signal, timeoutMs), ttlMs, pty {cols,rows},
logs, isolation, owner, labels`.

Источники, по уровням (как память): `~/.hyper/units/` — машина/пользователь; `<project>/.hyper/units/` —
проект (из репозитория, нужен **trust**: hyperd запускает файл только после одобрения его хэша, как
`direnv allow`); **транзиентные** юниты через API (как `systemd-run`) — фоновые задачи агентов, лежат в
run-каталоге и не требуют файлов.

## Состояние — в файлах, не в базе

hyperd поднимает Postgres, значит не может от него зависеть.

```
~/.hyper/run/hyperd/
  hyperd.sock                 control API (0600)
  events.ndjson               журнал событий с seq
  units/<name>/
    spec.json                 итоговая спецификация (файл + транзиентная)
    run-<n>/ holder.pid  child.pid  pty.sock  out.log  exit.json
```

## Control API и CLI

Unix-сокет, HTTP+JSON (Bun.serve({ unix })). CLI `hyperd` — тонкая обёртка:
`status, start, stop, restart, reload, logs <unit> [--from offset] [--follow], attach <unit>, send <unit> <text>,
run -- <cmd> (транзиентный task), trust <file>`.

Методы: `units.list/get`, `unit.start/stop/restart`, `run` (транзиентный), `logs.read {offset, limit}`,
`input.write`, `pty.resize`, `events.subscribe {afterSeq}` (стрим).

## События и интеграция с hyper

hyperd пишет события в `events.ndjson`: `started, ready, unhealthy, exited {code, signal}, restarting,
gave_up, log_match {pattern}`. hyper подписывается с последнего `seq` (хранит его в базе), поэтому
ничего не теряется, пока hyper лежит.

В hyper:
- jobs-раннер `hyperd` вместо tmux: `jobs.start` → `run` с именем = id задачи и `owner` = агент;
  `jobs.cancel` → `unit.stop`; завершение → событие `exited` → `jobs.finish` → `agent.deliver`.
- Реконсиляция после рестарта — просто дочитать события с последнего seq.
- Новые возможности для агентов: срабатывание на строку в выводе (`log_match`), ввод в работающую
  команду, автоуход в фон (команда начинается в PTY; не уложилась в N секунд — агент получает id и
  дальше читает лог с офсета, как в Codex).
- Тот же клиент на SSH-хосте: hyperd на удалённой машине + проброс сокета — замена remote tmux.

## Рестарт hyper

`hyperd restart hyper`: hyperd шлёт SIGTERM, ждёт выхода, стартует, ждёт `ready`. Фоновые задачи агентов
не трогаются, они у своих holder'ов. Restart-contract упрощается: вместо самоубийства по PID —
запрос к hyperd + проверка `ready`. Сам hyperd обновляется редко и аккуратно (его перезапуск тоже
безопасен из-за holder'ов).

## Изоляция

- `none` — обычный процесс (по умолчанию).
- `sandbox` — macOS `sandbox-exec` с профилем (запись только в cwd и tmp, сеть on/off); Linux — `bwrap`.
- `container` — holder запускает `podman run --rm --name hyperd-<unit> ...` или Apple `container run`;
  стоп через `podman stop`. Лимиты памяти/CPU — флагами контейнера.

## Безопасность

Сокет 0600, только владелец. Юниты из репозитория — только после trust. Секреты: hyper резолвит
`secret://` и передаёт значения в транзиентный юнит при `run` (в spec.json пишутся только ссылки);
для файловых юнитов — `envFile` вне репозитория.

## Код

Отдельная программа (не runtime-функции): `hyperd/` в корне репозитория — `main.ts`, `holder.ts`,
`cli.ts`, `units.ts`, без зависимостей от hyper. В hyper — модуль `src/hyperd/` (клиент: `hyperd.status`,
`hyperd.run`, `hyperd.logs`, …) и раннер jobs.

## Этапы

| Этап | Что | Оценка |
|---|---|---|
| P0 | hyperd + holder + CLI, файлы состояния, `service`/`task`, логи; первый юнит — тестовый postgres (`~/.hyper/pg-test`) | 3–4 дня |
| P1 | jobs-раннер `hyperd` за настройкой, bash background через него, события → jobs, tmux остаётся fallback | 3 дня |
| P2 | hyper и основная база как юниты; launchd запускает только hyperd; новый restart-contract (с согласия) | 2 дня |
| P3 | `session`: attach/ввод, xterm в UI, `log_match`-триггеры, автоуход в фон | 4 дня |
| P4 | изоляция sandbox/container, hyperd на SSH-хостах | 3–5 дней |

## Открытые вопросы

1. Формат: TOML (декларативно, hyperd не исполняет код) или TS (`satisfies Unit`, как всё в hyper)?
2. Linux/systemd сразу или пока только Mac?
3. Один hyperd на пользователя ОС или на инстанс hyper (у нас на машине несколько сервисов)?
4. Нужен ли UI-раздел «Процессы» уже в P0 или хватит CLI и jobs?
