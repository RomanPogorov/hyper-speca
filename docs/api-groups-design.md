# Hyper как API: префикс `/api` и API groups

**Статус:** черновик для обсуждения. Протокол не реализован, решения не приняты. Исследование, на котором он основан: заметка проекта `notes/hyper-as-api.md` (инвентарь поверхностей и дыр). Связанные документы: [auth.md](auth.md), [hyper-node.md](hyper-node.md), [external-harnesses.md](external-harnesses.md), [plugin-extension-principles.md](plugin-extension-principles.md), [hyper-global-registry-design.md](hyper-global-registry-design.md).

## 1. Зачем

Hyper уже отдаёт часть себя наружу, но каждый раз по-своему:

| Сейчас | Путь | Вход | Проверка |
|---|---|---|---|
| Мобильное приложение | `/api/mobile/v1/*`, `/api/mobile/v1/news/*` | cookie-сессия | только «вошёл»; владение агентом не проверяется |
| Вызов функций из UI | `POST /rpc`, `GET /rpc/<fn>` | cookie + CSRF | только уровни `user_/project_/agent_`; любая системная функция открыта любому member |
| CLI-харнессы | `/external/*`, `/external/repl` | JWT `kind=external-*` в файле | loopback; `tools/call` без allowlist |
| Раздача LLM другим Hyper | `/node/v1/*` | bearer, sha256 в `llm_node_clients` | loopback/Tailscale/hypermesh, allowlist провайдеров, hops |
| Расширение Chrome | `/sidebar/api/*` | pairing-токен | Origin расширения, одобрение человеком |
| Framework REPL | `/procs/repl` | JWT `kind=repl` | loopback, не production |

В итоге: пять механизмов токенов, четыре копии кода «запрос с локальной машины», нигде нет rate limit и аудита, у функции нет способа объявить себя публичной, а discovery разбросан по `/external/functions`, `/node/v1/models` и жёстко заданному `version: 1`.

Цель: **одна дверь для всех внешних клиентов**. У каждой двери описано, кто владелец, какая версия, кто и с какими правами может войти и как узнать, что за ней есть.

## 2. Принципы

1. **Всё внешнее — под `/api`.** Всё, что вне `/api`, — это UI: cookie, CSRF, без обещаний стабильности. `/rpc` остаётся внутренним каналом UI.
2. **Группа — единица API.** У неё есть владелец (модуль или плагин), версии, права, лимиты и документация. Это аналог Kubernetes API groups (`/apis/<group>/<version>`).
3. **Под `/api` вход только по токену (bearer), без cookie.** Поэтому там нет CSRF, и браузерная сессия не превращается в API-ключ.
4. **По умолчанию закрыто.** Функция или маршрут доступны снаружи только если явно объявлены в группе.
5. **Одна проверка.** Кто ты, что тебе можно, откуда пришёл запрос, не превышен ли лимит — всё это решает одна функция `api.authorize`, вызываемая диспетчером `/api`, а не каждым маршрутом.
6. **Клиент никогда не сильнее своего человека.** Токен ограничивает права владельца и не расширяет их.
7. **Discovery под токеном.** Клиент видит только то, что ему можно вызвать.

## 3. Адресация

```
/api                                   список групп и версий, видимых этому токену
/api/<group>                           версии группы, предпочтительная версия
/api/<group>/<version>                 ресурсы и операции группы
/api/<group>/<version>/openapi.json    схема OpenAPI 3.1 (из runtime.docs)
/api/<group>/<version>/<resource…>     сами операции
```

- `<group>`: имя выводится из владельца, а не выбирается (naming convention, §5 «Плагины»): модуль ядра `<mod>`, плагин `<name>`, пользовательский плагин `x-<name>`, плагин из реестра `<scope>.<name>`.
- `<version>`: `v1`, `v2`, … и `v1beta1`/`v1alpha1` для нестабильного. Версия относится к группе целиком.
- Зарезервированные имена групп: `auth`, `meta`, `fn`, `mcp`.

## 4. Объявление группы

Новый файл в грамматике модулей: `src/<mod>/$apigroup_<name>.ts` (и то же в плагинах и в `.hyper/`). Загрузчик собирает их в `ctx.state.api.groups`, как сейчас собираются `$route_` и `$setting_`.

```ts
// src/llm/$apigroup_llm.ts
export default {
    group: "llm",
    title: "LLM gateway",
    description: "OpenAI- and Anthropic-compatible access to models this Hyper can reach.",
    versions: {
        v1: { status: "stable" },
    },
    network: "private",                 // any | private (loopback, tailnet, hypermesh) | loopback
    credentials: ["pat", "node", "service"],
    scopes: {
        "llm:models:read": "List models and quota",
        "llm:use":         "Send completions; resource = provider[/model]",
    },
    rateLimit: { perCredential: { rpm: 120 } },
    owner: "llm",
} satisfies types.api.Group;
```

Операции группы объявляются одним из двух способов.

**Маршрут** — обычный `$route_`, путь которого начинается с `api_<group>_<version>_`, плюс экспорт `access`:

```ts
// src/llm/$route_api_llm_v1_chat_completions_POST.ts
export const access = { scope: "llm:use", resource: (req, body) => body?.model };
export default async function (ctx, session, opts: { req: Request; principal: types.api.Principal }) { … }
```

Маршрут под `/api/` без `access` или без своей группы не загружается: загрузчик выдаёт ошибку, а `code.quality` получает правило `api-undeclared`.

**Функция** — JSDoc-тег на обычной runtime-функции:

```ts
/**
 * Lists news items with filters.
 * @api news v1 read
 */
export default async function (ctx, session, opts: { … }) { … }
```

Формат тега: `@api <group> <version> <verb>`, где verb — `read | write | admin`. Индексатор кладёт тег в таблицу `functions` рядом с `paramsSchema` и `returnType`. Такая функция доступна как `POST /api/<group>/<version>/fn/<module>.<fn>`, а `read`-функции ещё и как `GET` с параметрами в query. Схема операции берётся из уже имеющегося `paramsSchema`, так что OpenAPI собирается без нового реестра. Уже существующий `@view` остаётся тегом UI-адресов (`GET /rpc/<fn>`) и к `/api` отношения не имеет.

Плагин объявляет свои группы теми же файлами. Менеджер плагинов показывает их при установке: «плагин открывает наружу группу `telegram` с правами …». Это та же идея, что optIn-инструменты агента e: расширение не получает внешнюю поверхность молча.

## 5. Группы

### Ядро

| Группа | Что внутри | Откуда берётся |
|---|---|---|
| `meta` | `GET /api/meta/v1/whoami` (principal, scopes, лимиты, срок токена), `GET /api/meta/v1/health` | новое |
| `auth` | выдача и отзыв токенов, device-code, обмен мобильного кода | `src/auth` (mobile exchange, OIDC) |
| `agents` | агенты: список, чтение событий, отправка сообщений, stop, archive | ресурсная часть `/api/mobile/v1` |
| `projects` | проекты и участники | `/api/mobile/v1/projects` |
| `events` | SSE-подписка на темы | `/procs/events` с фильтром по правам |
| `llm` | `models`, `chat/completions`, `responses`, `messages`, `usage` | `/node/v1/*` |
| `fn` | общий вызов функций с `@api fn …` из модулей, у которых нет своей группы | `/rpc` для внешних клиентов, `/external/functions` |
| `harness` | tools list/call с allowlist, plugins search/read, skills mount | `/external/*` |
| `mcp` | MCP Streamable HTTP поверх каталога | новое |
| `admin` | users, settings, modules, tests | сейчас UI-маршруты; только owner |

`mobile` остаётся отдельной группой-фасадом (`/api/mobile/v1`) для совместимости с приложением: внутри она вызывает те же функции, что `agents` и `projects`.

### Плагины

**Решение (niquola): одна группа на плагин, имя выводится по соглашению, а не выбирается.**

Naming convention:

| Источник | Имя группы | Путь | Пример |
|---|---|---|---|
| модуль ядра `src/<mod>` | `<mod>` | `/api/<mod>/<v>` | `/api/llm/v1`, `/api/agents/v1` |
| официальный плагин `plugins/<name>` | `<name>` | `/api/<name>/<v>` | `/api/news/v1`, `/api/telegram/v1` |
| пользовательский плагин (`USER_PLUGINS/<name>`) | `x-<name>` | `/api/x-<name>/<v>` | `/api/x-circleback/v1` |
| плагин из реестра `@scope/name` (HGR) | `<scope>.<name>` | `/api/<scope>.<name>/<v>` | `/api/health-samurai.clinical/v1` |
| уровни памяти `user_<uid>`, `project_<slug>`, `agent_<id>` | то же имя | `/api/project_<slug>/<v>` | `/api/project_hyperDesign/v1` |

Правила:

- **Имя группы = имя плагина = его namespace в `ctx.fns`.** Плагин не выбирает имя группы. Файл объявления без суффикса: `$apigroup.ts` в корне namespace плагина. `$apigroup_<name>.ts` с чужим именем загрузчик отвергает, так что плагин не может занять `/api/llm` или группу другого плагина.
- **Один плагин — одна группа.** Внутри группы ресурсы разделяются путём (`/api/news/v1/items`, `/api/news/v1/likes`), а не новыми группами. Если плагину правда нужны две независимо версионируемые поверхности, это повод разделить плагин.
- **Зарезервированные имена** (`meta`, `auth`, `fn`, `mcp`, `admin`, `api`, имена модулей ядра) плагину недоступны; коллизию ловит та же проверка, что сейчас ловит namespace collision при установке (`plugins.lifecycle`).
- **Префикс `x-`** у пользовательских плагинов отделяет частные группы от официальных: официальный плагин с тем же именем не ломает клиентов частного, а частный не может выдавать себя за официальный.
- **Scopes выводятся из имени:** `<group>:read`, `<group>:write`, `<group>:admin` есть у каждой группы автоматически; плагин может объявить более узкие (`news:likes:write`), но они всегда начинаются с имени группы. Тег у функции тогда короче: `@api read`, потому что группа = namespace функции, а версия по умолчанию — предпочтительная версия группы.
- **Операции функций** получают путь `/api/<group>/<v>/<fn>`, где `<fn>` — имя функции в namespace (`/api/news/v1/list`), а маршруты — `$route_api_<v>_<resource>_<METHOD>.ts` внутри плагина; префикс группы загрузчик подставляет сам.
- **Discovery** показывает происхождение группы: `{ name, source: "core"|"official"|"user"|"registry"|"memory", plugin, version }`, чтобы клиент и человек видели, чей это код.

Например, `/api/mobile/v1/news/*` переезжает в `/api/news/v1/*`.

### Группа `fn` или своя группа у каждого модуля

Обе формы поддерживаются одной механикой:

- модуль или плагин со стабильным, документированным API объявляет **свою группу** (у неё своя версия и свои scopes);
- для «просто дать вызвать пару функций» есть общая группа **`fn`**: `@api fn v1 read`. Её версия означает только формат вызова, а не стабильность функций; права выражаются как `fn:call` с ресурсом `<module>.<fn>`.

По умолчанию — своя группа (по naming convention выше); `fn` остаётся для модулей ядра, у которых нет своей группы, и для перехода с `/rpc`.

## 6. Модель доступа

```
principal ─► credential ─► grant (scopes + resources + limits + network) ─► api.authorize ─► операция ─► audit
```

**Principal** — кто действует:
- `person` — строка `users`;
- `agent` — агент, действует от имени `created_by`;
- `client` — устройство, CLI-харнесс, другой Hyper, внешний сервис, MCP-клиент. У клиента всегда есть человек-владелец.

**Credential** — одна таблица вместо пяти механизмов:

```sql
CREATE TABLE api_credentials (
    id            TEXT PRIMARY KEY,          -- cred_…
    kind          TEXT NOT NULL,             -- pat | device | node | harness | service | repl
    name          TEXT NOT NULL,
    owner_user_id TEXT REFERENCES users(id), -- NULL только для служебных kind на открытом экземпляре
    agent_id      TEXT,                      -- если действует агент
    token_hash    TEXT NOT NULL UNIQUE,      -- sha256 непрозрачного токена
    token_hint    TEXT NOT NULL,             -- последние символы для UI
    grants        JSONB NOT NULL,            -- [{ group, scope, resource?, limits? }]
    network       TEXT NOT NULL DEFAULT 'private',
    expires_at    BIGINT,
    revoked_at    BIGINT,
    created_at    BIGINT NOT NULL,
    created_by    TEXT,
    last_used_at  BIGINT,
    last_used_ip  TEXT,
    use_count     BIGINT NOT NULL DEFAULT 0
);
```

Формат токена: `hy_<kind>_<base62 32 байта>`. По префиксу сканеры секретов распознают утечку, а по kind видно назначение. Токен показывается один раз в secure popup, как сейчас делает `node.issueClient`.

Кроме таблицы, `api.authorize` принимает ещё два источника:
- **portal-assertion** hypermesh (`X-Hn-Assertion`). Как сейчас, это person без токена; права — роль пользователя;
- **токены control plane** (JWT от issuer, `aud=hn:<team>/<node>/hyper`, claim `scope`). Проверяются по JWKS тем же `auth.verifyIdToken`. Так control plane может централизованно выдавать доступ сервисам.

**Scope** — строка `<group>:<resource-kind>:<verb>` (или короче, как объявила группа) с необязательным ресурсом:

```
agents:read                    resource: own | project:<slug> | <agentId>
agents:write                   resource: own
llm:use                        resource: claude-code/* | openai/gpt-5.4-mini
fn:call                        resource: news.* | knowledge.search
harness:tools:call             resource: read,grep,find
admin                          только owner
```

Ресурс сравнивается по сегментам с `*`. Права уровней `user_/project_/agent_` дополнительно проверяет существующий `project.canCall`: группа не может открыть то, что закрыто уровнем памяти.

**Роли** — именованные наборы grants. Они хранятся настройкой и предлагаются при выдаче токена:

| Роль | Grants |
|---|---|
| `member` (для сессии person) | `agents:*` own и своих проектов, `projects:read`, `fn:call` на `@api … read`, `events` своих тем |
| `owner` | всё, включая `admin` |
| `mobile` | `agents:*` own, `projects:read`, `news:*`, `events` |
| `node` | `llm:models:read`, `llm:use` по allowlist |
| `harness` | `harness:*` с allowlist инструментов, `fn:call` по списку |
| `readonly` | все `:read` своих ресурсов |

Итоговое право — пересечение: роль владельца ∩ grants токена ∩ ограничение сети.

## 7. `api.authorize`

Одна функция. Её вызывает диспетчер `/api` до маршрута:

```ts
ctx.fns.api.authorize({ req, group, version, scope, resource })
  → { ok: true, principal, grant } | { ok: false, response }
```

Шаги:
1. **Группа и версия** существуют, версия не `removed`.
2. **Сеть**: единая функция `http.peer({ req })` возвращает `{ ip, via: "loopback"|"tailnet"|"hypermesh"|"proxy"|"direct" }` и заменяет пять нынешних копий. Сравнивается с `network` группы и токена.
3. **Credential**: `Authorization: Bearer hy_…` → `api_credentials` (кэш 30 с, отзыв сбрасывает кэш), или portal-assertion, или JWT control plane. Cookie под `/api` не принимается; исключение — переходный режим группы `mobile`.
4. **Владелец** не отключён (`users.disabled_at`), как сейчас перепроверяется на каждый запрос.
5. **Scope и ресурс**: пересечение роли и grants; ресурс считается из параметров (`agentId` → `own` через `agents.created_by`).
6. **Rate limit** (§9).
7. Результат кладётся в `session.principal`, и маршрут или функция видят, от чьего имени они работают.
8. **Аудит** (§9) пишется после ответа.

Отказ: `401` — нет или неверный токен; `403` — нет права, в теле указан недостающий scope; `404` — группа не видна этому токену (не раскрываем существование); `429` с `retry-after`.

## 8. Discovery

```
GET /api
{
  "hyper": { "name": "studio", "version": "a1b2c3d" },
  "principal": { "kind": "client", "name": "iphone-niquola", "owner": "niquola" },
  "groups": [
    { "name": "agents", "preferred": "v1", "versions": ["v1"] },
    { "name": "llm",    "preferred": "v1", "versions": ["v1"] },
    { "name": "news",   "preferred": "v1", "versions": ["v1"] }
  ]
}
```

- Список фильтруется по правам: группа без единого доступного scope не показывается.
- `GET /api/<group>/<version>/openapi.json` — OpenAPI 3.1. Операции маршрутов описаны в их `access` и JSDoc, операции функций — из `functions.params_schema`/`return_type`. Тоже фильтруется по правам, поэтому SDK-генератор видит ровно доступное.
- `GET /api/meta/v1/whoami` — права и лимиты токена, срок действия.
- **MCP** (`/api/mcp/v1`, Streamable HTTP): `tools/list` = доступные операции всех групп (имя `group.operation`, схема из того же каталога), `resources` = `@view`-страницы и memory, доступные principal. Одна реализация поверх каталога, а не отдельный реестр.
- **Между инстансами**: «кто есть» по-прежнему отвечает `controlPlane.services`; «что умеет» — карточка `/node/card`, расширенная до краткой выдачи `GET /api` без principal (только публичные группы и версии).

## 9. Выдача, отзыв, аудит, лимиты

**Выдача.** Страница Settings → API clients: имя, роль, точечные grants, срок, сеть; токен показывается один раз. Особые потоки:
- мобильное устройство — существующий handoff (`/auth/mobile/complete` → exchange), но в ответ выдаётся `device`-токен, а не 30-дневная cookie;
- Hyper ↔ Hyper — `node.issueClient` пишет в `api_credentials` kind `node`;
- CLI-харнесс — `external.token` выдаёт kind `harness` с allowlist и перевыпускает его по истечении (сейчас кэш в state живёт до рестарта);
- позже OAuth device-code и PKCE для сторонних клиентов через control plane.

**Отзыв.** `revoked_at` действует сразу (сброс кэша); «отозвать все токены пользователя»; отключение пользователя гасит все его токены.

**Аудит.** Таблица `api_audit(ts, credential_id, principal, group, version, operation, status, ms, bytes_in, bytes_out, tokens_in, tokens_out, ip_via)`. Тела запросов и промпты не пишутся. Страница с фильтром по клиенту и группе; агрегаты уходят в telemetry. Срок хранения задаётся настройкой.

**Rate limit.** Token bucket в памяти по `credential × group`, параметры из группы и grant. Для `llm` дополнительно квоты в токенах за сутки: relay уже видит usage в ответе провайдера. Ответ `429` отдаётся в формате провайдера (`retry-after`, `*-ratelimit-*`), чтобы клиентский `classifyError` парковал агента так же, как при родной подписке. Для анонимных `/api/auth/*` — лимит по IP.

## 10. Группа `llm` подробнее

Это обобщение того, что уже работает в `/node/v1`.

```
GET  /api/llm/v1/models               OpenAI-формат списка, из node.catalog по правам
GET  /api/llm/v1/usage                квоты, доступные клиенту
POST /api/llm/v1/chat/completions     OpenAI chat
POST /api/llm/v1/responses            OpenAI Responses
POST /api/llm/v1/messages             Anthropic Messages
```

- Любой OpenAI SDK работает с `base_url=<hyper>/api/llm/v1` и ключом `hy_…`; Anthropic SDK — с `base_url=<hyper>/api/llm` (SDK сам добавляет `/v1/messages`).
- `model` — id из каталога (`claude-code/claude-opus-5`, `hyper/niquola:gpt-5.4-mini`); право `llm:use` проверяется по нему.
- Остаётся то, что есть в relay: hops < 3, запрет петли, проксирование 1:1, лог без промпта.
- Клиентская сторона (`llm.resolveEndpoint` для `hyper/<node>:<model>`) переходит на новый путь, когда хост сообщает в `/api` о группе `llm`; иначе использует `/node/v1`.

## 11. Миграция без поломок

Каждый шаг — отдельный коммит с тестами; на каждом шаге mobile, CLI, rpc и node продолжают работать.

1. **Каркас без поведения.** `http.peer` вместо пяти копий (поведение 1:1, тесты на каждое место). Загрузчик `$apigroup_`, тип `types.api.Group`, индекс тега `@api`. `GET /api` и `openapi.json` только для чтения. Исправить в `docs/hyper-node.md` путь `/llm/node/v1` на реальный `/node/v1`.
2. **`api.authorize` в режиме audit-only** на `/api/mobile/v1`, `/node/v1`, `/external/*` и `/rpc`: пишет, какой scope потребовался бы и был бы отказ, но ничего не запрещает. По этим логам и `code.callers` размечаем `@api` на функциях, которые реально вызываются.
3. **Закрыть срочное** под флагом `api.enforce` (для новых установок включён):
   - `/rpc` для member — только `@api`/`@view` и функции уровней; owner — как сейчас;
   - mobile — проверка владения агентом (`created_by` или проект пользователя; агенты без создателя — owner);
   - формы shared-agents — CSRF.
4. **`api_credentials`.** Перенос `llm_node_clients` (тот же sha256, старые токены работают); external/repl JWT → kind `harness`/`repl` с теми же файлами для CLI. `sidebar_pairs` остаётся своим мостом, но пишет в аудит.
5. **Новые группы и алиасы:**
   - `/node/v1/*` → алиас `/api/llm/v1/*` и `/api/node/v1/*`;
   - `/external/*` → алиас `/api/harness/v1/*`, CLI переходит на новый путь;
   - `/api/mobile/v1/news/*` → `/api/news/v1/*`, старый путь остаётся алиасом;
   - `/api/mobile/v1` принимает и cookie, и `device`-токен; приложение переходит на токен.
6. **UI выдачи и отзыва, аудит, rate limit, LLM-квоты.**
7. **MCP, OAuth для сторонних клиентов, токены control plane.**
8. **Удаление алиасов** после того, как аудит покажет нулевое использование старых путей за N недель. Cookie под `/api/mobile` выключается тем же способом.

## 12. Открытые вопросы

1. ~~`fn` или своя группа по умолчанию?~~ Решено: одна группа на плагин, имя по naming convention (§5). Открыто: префикс `x-` для пользовательских плагинов или отдельный сегмент `/api/user/<name>`; нужен ли плагину когда-нибудь больше одной группы.
2. **Насколько доверяем member?** От этого зависит, включаем ли `api.enforce` для существующих установок сразу или после периода аудита.
3. **Выходит ли `/api` за пределы приватной сети** (tailnet, hypermesh)? Если да, OAuth и rate limit нужны до открытия, а не после.
4. **Кто выдаёт токены сторонним клиентам** — сам Hyper, control plane или оба?
5. **LLM-лимиты**: в токенах, деньгах или запросах? Видит ли получатель квоту хоста? Допускают ли условия провайдеров раздачу подписок Claude и Codex третьим лицам?
6. **Агент чужого человека или инстанса как клиент**: от чьего имени он действует и откуда берёт scopes?
7. **Открытый режим** (нет пользователей): оставить `/api` открытым для локальной разработки или требовать хотя бы loopback?
8. **Нужны ли группам версии на уровне ресурса** (как `v1beta1` для одной операции), или хватит статуса версии группы?
9. **Имя файла** `$apigroup_` или более общее `$api_`, если позже появятся другие объявления (webhooks, исходящие API)?
