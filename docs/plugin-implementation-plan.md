# План реализации распространения плагинов Hyper

Статус: **план, не реализованный API**. Решения для обсуждения, а не разрешение устанавливать, удалять или публиковать код. Последовательность: рабочий filesystem → Git → multi-plugin bundle → надёжный runtime lifecycle → остальные источники и публикация. После каждого этапа — отдельный проверяемый результат, без «большого переключения» всех плагинов.

Смежные документы: [текущий API провайдеров](plugin-providers.md), [runtime и его ограничения](plugin-runtime-architecture.md), [настройки](settings.md), [принципы расширений](plugin-extension-principles.md), [проект глобального реестра](hyper-global-registry-design.md). При расхождении о *текущем* поведении приоритет у кода и тестов.
**Подписи к примерам:** `ЕСТЬ` — текущий контракт или форма файла в Hyper; `ЭСКИЗ` — предлагаемое устройство без реализации; `ПСЕВДОКОД` — пояснение потока, не исполняемый TypeScript. Если у блока указано `apiVersion: 1`, это только совместимый текущий API одного plugin tree, а не поддержка bundle.

## 1. Целевая модель и границы

```text
Человек:         search → install / update / uninstall; позже — publish
Источник:        search → materialize (возможное будущее имя fetch)
Hyper:           staging → проверка → diff/review → согласие → активация
Доставка:        bundle → один или несколько независимых plugin roots
Исполнение:      procs scan → $loader_<kind> → функции, UI, HTTP, инструменты
Настройка:       $setting_<key>.ts → Postgres / instance file / secrets
Lifecycle:       $start.ts → состояние → $stop.ts
```

- **Provider** — подключаемый *доверенный* источник. Он находит кандидат и переносит его файлы в пустой staging, но не решает, запускать ли их. Встроенный источник — filesystem; Git — первый внешний кандидат; HTTP/npm/HyperHub — отдельные провайдеры, не ветки в ядре. Код смонтированного провайдера уже исполняется с правами процесса: архитектура не превращает его в песочницу.
- **Bundle** — атомарная единица доставки, provenance, версии, обновления и удаления. **Plugin** — отдельное дерево исходников, единица включения и настройки. У одного bundle может быть несколько plugins. Установка bundle не обязана автоматически включать все его plugins. Идентификатор bundle и runtime-имя плагина — разные пространства имён.
- **Hyper** владеет установленным инвентарём, проверкой структуры, pin/digest, diff, согласием, включением, обновлением, снимками и удалением. Источник не реализует пользовательские `install`/`uninstall`. Публикация — отдельное действие с отдельным подтверждением; не часть `materialize`.
- **Ограничение сейчас:** `src/plugins/validateTree.ts` принимает один plugin tree и отвергает multi-plugin manifest. `filesystemSearch` выдаёт `mounted:<sha256(package.json)>`, а `filesystemMaterialize` принимает только SHA-256 полного дерева; прямой путь search → install не работает. `procs.lifecycle.stop` заново импортирует `$stop.ts` с диска, а reload не является гарантией unload. Не выдавать план за готовую функциональность.

## 2. Контракты, которые нужно согласовать до изменения кода

### 2.1. Совместимый provider API

Сохранить существующий `$plugin_provider_<id>.ts` (`apiVersion: 1`) и текущие типы `ProviderSelection`, `ProviderSearchResult`, `ProviderMaterializeOpts`: `search({q?,limit?}) → {items,errors}`, `materialize({selection,destination}) → {path}`. `selection` содержит `provider`, `name`, точную `revision`, непрозрачные строковые `source`; диспетчер проверяет owner и допускает только объявленный handler. Не переименовывать `materialize` в `fetch` в рабочем API без переходного адаптера. Сначала добиться согласованности search/materialize для *одного* дерева; затем обсудить версионированный контракт для bundle. Не выдавать устаревшие metadata-only `mounted:` selections за устанавливаемые.

Для bundle решить отдельно: `apiVersion: 2` c `selection` уровня bundle, манифестом и bundle digest **либо** адаптер поверх v1, совместимый с уже установленными plugin trees. Не расширять семантику `selection.name` молча. Версионировать проверку, сериализацию и хранение provenance, а не только TypeScript-тип.

### 2.2. Bundle manifest и целостность

Предложение: `package.json` в корне bundle с `hyper.bundle` (точное поле и schema — ADR до реализации): идентификатор, версия, перечень `{id, path}`; каждый plugin root имеет собственные `package.json`, `SKILL.md` и `procs.src`. Пути относительные, уникальные, не пересекаются и не выходят из bundle; никакие symlinks, специальные файлы, скрипты установки, неявные зависимости и сетевые загрузки в managed-пути. Сохранить v1-пакеты с одним плагином через явный адаптер; не ломать существующие локальные mounts с иными правилами.

Digest считается по канонически отсортированным относительным путям **и байтам файлов** всего bundle, включая manifest; исключения и правила нормализации зафиксировать и покрыть cross-platform test vectors. Лимиты на размер, число файлов, глубину, обход через symlink, регистр имён, Unicode и коллизии — до подключения Git. `revision` источника (например, полный Git commit + subdir) и `digest` дерева — разные проверки: ref без digest не закрепляет полученные файлы.

### 2.3. Установка, включение, настройки

У каждого plugin root — собственный enabled-флаг и config; у bundle — источник, ревизия, digest, список корней и установленная версия. Установленные файлы не являются пользовательскими настройками. `$setting_<key>.ts` объявляет поля; значение для scope `user` — Postgres; глобальное — Postgres или `~/.hyper/settings/$settings_<module>.json` (файл имеет приоритет; `HYPER_SETTINGS` меняет каталог). Секреты — только в защищённом хранилище; в metadata/settings не копировать их значение. Git-провайдер настраивается отдельно от доставленного им плагина. Обновление сохраняет значения и перед включением проверяет совместимость объявлений; удаление кода не должно автоматически стирать пользовательские значения и секреты (предложить явную отдельную операцию очистки).

## 3. Очередь реализации и критерии готовности

### Этап 0 — тестовая база и контракт безопасности

- Зафиксировать реальные schema/entry points: `src/plugins/{dispatch,providers,filesystemSearch,filesystemMaterialize,validateTree,lifecycle}.ts`, `src/procs/modules/readPluginRegistry.ts`, `src/procs/lifecycle/{start,stop}.ts`, `src/procs/boot/load.ts`, `src/procs/project/classify.ts`. Документировать, какие операции требуют restart, а какие выполняются live.
- Добавить интеграционные сценарии provider → staging → preview → confirmation → installed inventory с временными каталогами **вне** активных mounts; без исполнения неутверждённого кода. Проверять обе стороны: состояние файлов на диске и фактическое состояние runtime после ошибки.
- Проверить политики: path traversal, symlinks, замена файла после поиска/во время копирования, непиннутые revisions, namespace collision, неподтверждённая активация, сохранность secrets. Не ослаблять правила для managed copies ради существующих developer mounts.

**Готово:** тесты воспроизводят нынешний разрыв filesystem search/materialize и показывают отсутствие исполнения до подтверждения. Ни одного неявно установленного тестового плагина.

### Этап 1 — закончить встроенный filesystem provider

- Выбрать явный набор разрешённых локальных корней для поиска (на первом шаге — уже доверенные mounts); не сканировать произвольную домашнюю папку. Установить поведение для уже смонтированных плагинов: показывать как mounted/discovery-only, не копировать поверх них и не выдавать кнопку Install без безопасного пути.
- Для кандидатов, которые действительно можно установить, получить `validateTree` digest **всего** дерева при поиске и вернуть тот же pinned digest в `selection.revision`. `materialize` перечитывает исходник с no-follow, сверяет digest до/после копирования и пишет только в пустой внешний staging. Не превращать metadata revision в псевдо-digest. При изменении файлов просить новый поиск/preview.
- Подключить UI к preview/review core: пользователь видит источник, точную ревизию, файлы, diff, риски, digest и отдельное подтверждение. Не путать discoverable mounts с кандидатами к managed installation.

**Готово:** сценарий «нашёл installable кандидат → увидел исходники и diff → подтвердил → установлен» работает end-to-end; «нашёл существующий mount → установил поверх него» невозможен; TOCTOU после поиска отклоняется. Нынешний v1 install/update/rollback продолжает работать.

### Этап 2 — Git как первый внешний provider

- Создать отдельный provider с `$plugin_provider_git.ts` и процедурами поиска и получения исходников (точные имена — при реализации). Настройки Git — отдельные `$setting_`-файлы: allowlist хостов/организаций, параметры репозитория и ссылка на secret для приватного доступа; доступ не передаётся кандидату.
- `search` возвращает полную точную identity: repository URL из allowlist, full commit, путь к bundle/plugin root и отображаемые поля. Решить, кто и по каким правилам индексирует репозитории; отсутствие каталога не блокирует явное добавление доверенного Git URL при отдельной проверке.
- `materialize` извлекает **только выбранный commit и subdir** в staging; ограничивает протоколы, редиректы, размер, время, вложенные репозитории и доступ к сети; не выполняет Git hooks, package scripts, `npm install`, `postinstall`. Hyper сверяет ожидаемые файлы/digest и требует review. Содержимое Git считать недоверенным.

**Готово:** install/update из pinned Git commit проходят тот же review, что filesystem; перемещение ветки/тега после выбора не меняет доставленный commit; вредоносные URL, submodule, symlink, race и подмена digest отклоняются. Удаление провайдера не делает ранее установленный плагин недоступным offline.

### Этап 3 — multi-plugin bundles и раздельное включение

- Утвердить manifest/schema и migration/adapter v1 → bundle identity. `validateBundle` проверяет дерево целиком и все plugin roots *до* импорта любого кода. Проверить уникальность id, путей и runtime namespaces, типы contributions и конфликты с already mounted code.
- Core install/update атомарно меняет **поставку** и ведёт lock/provenance и снимок предыдущей версии. Реестр включений хранит независимое состояние каждого plugin root; отключённый root не сканировать и не импортировать. При обновлении показать diff по каждому плагину, отдельно новые/удалённые корни, изменения настроек и выбор включений.
- UI: карточка bundle перечисляет все plugins и их видимые вклады (функции, маршруты, страницы, виджеты, Canvas, инструменты, settings), статус включения, источник/revision/digest. `uninstall` сначала выключает плагины и должен отказаться от небезопасного удаления при изменённых файлах или зависимостях; предложить отдельный явный путь для force, если он вообще понадобится.

**Готово:** bundle с двумя plugins можно установить и включить только один; второй не импортируется. Обновление обоих при сохранении независимых настроек и enabled-флагов проходит без подмены произвольного локального root. Rollback возвращает подтверждённый snapshot или честно сообщает невозможность; отсутствие сетевого источника не блокирует локальный snapshot.

### Этап 4 — реальный lifecycle и обновление runtime

- Сохранить `$start.ts` и `$stop.ts`. Для каждой версии владельца удерживать *тот же загруженный* stop-handler и состояние, возвращённое start; не импортировать `$stop` повторно из уже заменённого файла при отключении/обновлении. Owner + generation на регистрацию функции/route/loader/hook/настройки/таймера/подписки. Нужно инвентаризировать, что каждый loader действительно регистрирует и как снять регистрацию.
- Перед выключением: прекратить новые вызовы, drain/cancel активные (с таймаутом), вызвать `$stop` старого поколения в обратном порядке, удалить его регистрации, только затем подключить новые. Ошибки и частичный rollback показывать явно. Top-level side effects или внешний побочный эффект `$start` не «откатываются» переименованием папки — документировать допустимый контракт и требовать идемпотентность.
- До этой готовности UI и API обязаны говорить «изменения требуют restart» там, где reload не освобождает старые регистрации; не обещать live uninstall/update. Определить политику смены settings во время работы (on-change hook либо restart, но не скрытый повторный start).

**Готово:** тесты доказывают, что stop версии N вызван с состоянием start версии N даже после доставки N+1; не остаются маршруты, функции, обработчики событий и таймеры версии N; текущие вызовы завершены или явно отменены. После failed update статус disk/runtime честный и восстановим после restart.

### Этап 5 — остальные источники и публикация (не блокируют этапы 1–4)

- HTTP/npm/HyperHub добавляются своими провайдерами; каждый ограничивает ввод и проверяет артефакты по тому же правилу digest/staging/review. Не давать источнику установки права менять user settings и включение плагина.
- `publish` проектируется отдельно от `search/materialize`: права издателя, точный адрес, версия, файлы, digest, dry run и человеческое подтверждение перед внешней публикацией. В Git конкретный транспорт — push; не отправлять автоматически в рамках install/update.
- Hyper Global Registry (`@scope/bundle`) — ещё один самостоятельный этап: ownership scope, неизменяемое `(name, version) → source/revision/digest`, отзыв и lock, независимость имени от URL. Утвердить его trust model и канонический digest **до** включения глобальной публикации; локальный и прямой Git-путь не обязаны ждать реестр.

**Готово:** один и тот же bundle digest даёт одинаковые результаты установки из двух разных источников; публикация без отдельного согласия невозможна; при отказе/отзыве запись остаётся аудируемой и не подменяет уже установленный код.

## 4. Сквозной пример: один bundle, два плагина

Пример ниже — **эскиз целевой структуры этапа 3**, не пакет, который уже можно установить нынешним `validateTree`. Для наглядности один Git-репозиторий хранит bundle в подкаталоге `bundles/team-tools/`; рядом могут жить независимые bundles. Содержимое после извлечения этой папки:

```text
bundles/team-tools/
  package.json                    # ЭСКИЗ будущего bundle manifest
  plugins/
    git-source/
      package.json                # plugin root: собственный procs.src
      SKILL.md
      src/gitSource/
        $plugin_provider_git.ts   # декларация источника
        search.ts                 # процедура, указанная в handlers.search
        materialize.ts            # процедура, указанная в handlers.materialize
        $setting_allowedHosts.ts  # настройки самого Git-источника
    status-board/
      package.json                # другой plugin root в том же bundle
      SKILL.md
      src/statusBoard/
        $setting_project.ts
        status.ts                 # ctx.fns.statusBoard.status({})
        $start.ts
        $stop.ts
```

Важно: доставка Git-провайдера **через самого себя** не может быть единственным путём начальной установки. Bootstrap — filesystem или заранее доверенный mount. После установки bundle можно включить `status-board` и оставить `git-source` выключенным; пока нет полноценного multi-root managed install, этот пример — только дизайн.

### Предлагаемый bundle manifest (не существующий контракт)

```json
{
  "name": "@example/team-tools",
  "version": "1.0.0",
  "hyper": {
    "bundle": {
      "schemaVersion": 1,
      "plugins": [
        { "id": "git-source", "path": "plugins/git-source" },
        { "id": "status-board", "path": "plugins/status-board" }
      ]
    }
  }
}
```

Имя поля `hyper.bundle`, scoped-имя, версия manifest, правила совпадения `id` и `package.json.name` **ещё не утверждены**. Проверять их до написания loader/migration. У каждого `plugins/<id>/package.json` уже знакомая структура плагина, например:

```json
{
  "name": "status-board",
  "private": true,
  "type": "module",
  "procs": { "src": "src", "label": "Status board", "description": "Read the project status." }
}
```

`SKILL.md` лежит в каждом plugin root; функции живут в namespace из пути под `src`, а **не** автоматически в namespace имени bundle. Пути `plugins/<id>` должны быть изолированы, не перекрываться и не содержать ссылок за пределы дерева. Декларацию bundle нельзя исполнять как JS: это данные для структурной проверки.

### Существующий provider API внутри такого плагина

Это очертания **существующего v1-контракта**. В полном пути bundle `apiVersion: 2` или адаптер ещё нужно спроектировать; пример не означает, что v1 умеет доставлять multi-plugin bundle.

```ts
// plugins/git-source/src/gitSource/$plugin_provider_git.ts
export default {
  apiVersion: 1,
  label: "Git",
  description: "Find pinned source trees in approved Git repositories.",
  handlers: {
    search: "gitSource.search",
    materialize: "gitSource.materialize",
  },
} satisfies types.plugins.Provider;
```

```ts
// plugins/git-source/src/gitSource/search.ts — эскиз; это не готовая реализация Git
/** Find candidate trees only in configured, approved Git repositories. */
export default async function (
  ctx: Context,
  _session: Session | null,
  opts: { q?: string; limit?: number },
): Promise<types.plugins.ProviderSearchResult> {
  // Псевдокод: validatedCatalog не является существующей функцией.
  const matches = await validatedCatalog({
    query: opts.q,
    limit: opts.limit ?? 30,
    allowedHosts: await ctx.fns.settings.get({
      module: "gitSource", scopeType: "global", key: "allowedHosts",
    }),
  });
  return {
    items: matches.map(m => ({
      selection: {
        provider: "git", name: m.pluginName,
        revision: m.fullCommitSha, // НЕ ветка и не передвигающийся tag
        source: { repo: m.canonicalRepoUrl, path: m.subdir },
      },
      label: m.label,
    })),
    errors: [],
  };
}
```

```ts
// plugins/git-source/src/gitSource/materialize.ts — эскиз безопасных границ
/** Copy only the selected Git commit/subdirectory into core-owned empty staging. */
export default async function (
  ctx: Context,
  _session: Session | null,
  opts: types.plugins.ProviderMaterializeOpts,
): Promise<{ path: string }> {
  const { selection, destination } = opts;
  // 1. Проверить provider, allowlist repo, full commit, относительный subdir.
  // 2. Извлечь файлы без checkout hooks / submodules / scripts;
  //    ограничить размер, время, redirects и symlink.
  // 3. Сверить точный commit и digest кандидата по согласованному контракту.
  // 4. Писать ТОЛЬКО в уже созданный пустой destination; не import и не mount.
  // Извлечение Git и его защищённые примитивы — отдельная реализация этапа 2.
  throw new Error("Эскиз: не вызывать до реализации безопасного извлечения");
}
```

**Не смешивать уровни:** v1 `ProviderSelection` говорит об одном plugin tree. Для bundle новый контракт должен передавать и хранить bundle identity, а не писать `selection.name` то как имя bundle, то как имя одного плагина. Приведённый `search.ts` — форма входа/выхода, `validatedCatalog` нарочно обозначает ещё не существующий индекс; это не рабочий пример команды установки.

### Обычный плагин: настройки, функция и lifecycle

Внутри `status-board` — реальные виды файлов и форма функции; lifecycle resource example ниже **целевой**, текущий `$stop` переимпортируется с диска, поэтому безопасное live обновление здесь пока не гарантировано.

```ts
// plugins/status-board/src/statusBoard/$setting_project.ts
export default {
  type: "string", default: "demo", title: "Project",
  description: "Project whose status is displayed.",
};
```

```ts
// plugins/status-board/src/statusBoard/status.ts
/** Read the configured project status; use to display the status board. */
export default async function (
  ctx: Context, _session: Session | null, _opts: {},
): Promise<{ project: string; status: string }> {
  const project = await ctx.fns.settings.get({
    module: "statusBoard", scopeType: "global", key: "project",
  });
  return { project: String(project ?? "demo"), status: "not configured" };
}
```

```ts
// plugins/status-board/src/statusBoard/$start.ts — эскиз ресурса для lifecycle
export default async function (ctx: Context, _session: Session | null, _opts: {}) {
  // Здесь допустимо открыть ресурс и вернуть его состояние;
  // ctx.state.statusBoard получает результат по текущему механизму.
  return { startedAt: Date.now() };
}
```

```ts
// plugins/status-board/src/statusBoard/$stop.ts — будет нужен при реальном unload
export default async function (
  ctx: Context, _session: Session | null,
  state: { startedAt: number },
) {
  // Остановить задачи/подписки именно версии $start, которая вернула state.
  // Сейчас это гарантируется лишь в плане этапа 4, не в текущем hot reload.
  ctx.fns.procs.log.info({ event: "statusBoard.stopped", startedAt: state.startedAt });
}
```

Пример конфигурации инстанса (отдельно от исходников): `~/.hyper/settings/$settings_statusBoard.json` → `{ "project": "demo" }`. Личное предпочтение пользователя, если плагин его поддерживает, — строка Postgres scope `user`, не этот файл. Секретный токен не должен попадать ни в bundle, ни в JSON; для него объявляют `type: "secret"` и используют защищённое хранилище. Git-провайдер имеет **собственные** ключи (`gitSource.*`) и не видит настройки `statusBoard.*`.

### Как выглядит команда пользователя и внутренний вызов

```text
search "team-tools" → выбрать source + immutable revision
install → provider.materialize(selection, core-owned empty staging)
        → Hyper.validateBundle + diff + review + человеческое согласие
        → Hyper сохраняет bundle, предлагает включить git-source/status-board
configure status-board → значение global/user или ссылка на секрет
update → review изменённых plugin roots; сохранить settings и enabled flags
uninstall → остановить включённое, убедиться в отсутствии локальных правок,
            удалить ТОЛЬКО управляемые файлы; настройкам — отдельная политика
```

Имена `validateBundle`, `install`, `uninstall` в этом блоке — **предлагаемая граница обязанностей**, не призыв вызывать несуществующие `ctx.fns` функции. До этапа 4 обновление включённого плагина может требовать restart; нельзя описывать его как гарантированно безопасную горячую замену.
**Ответственность в примере:** `gitSource` отвечает только за поиск и доставку, `statusBoard` — за свою функцию и настройки, Hyper — за проверку, согласие, активацию и удаление. Bundle связывает поставку, но не объединяет их настройки или lifecycle. Исходники в staging не должны исполняться.


## 5. Проверка при каждом PR

1. Unit + integration tests для нового контракта, включая негативные проверки, существующие v1 fixtures и миграцию provenance/lock; `bun test` целевых suite и общий typecheck. Не выдавать провал unrelated тестов за успех всей базы.
2. После правки runtime-функций: hot reload соответствующего namespace, `runtime.docs.validate({name, strict:true, typecheck:true})`; после новых файлов — `procs.dev.genTypes({})`; после route — `procs.http.loadRoutes({})`. Проверка `code.quality({})` и `code.boundary({})` для изменённого пути.
3. Browser check: поиск, preview, источники, карточка bundle, настройки и честное сообщение о необходимости restart. Отдельно проверить несовместимые и недоступные источники, ошибки `$stop`, повреждённый файл и офлайн-режим.
4. Документы и SKILL обновлять только после работающего поведения. Миграция старых источников и пользовательских настроек должна быть явной, обратимой там, где возможно, и без удаления unmanaged файлов.

## 6. Решения, требующие согласования

- Где искать локальные *не смонтированные* кандидаты, не превращая домашнюю папку в каталог произвольного кода?
- Manifest bundle: точное имя поля/schema, правила идентификаторов и пути нескольких bundles внутри одного Git repo; default включений — нет или явный выбор?
- Совместимость v1 providers: `apiVersion: 2` или слой адаптации, и когда/стоит ли переименовывать внутреннее `materialize` в `fetch`?
- При полном отключении/удалении должны ли значения настроек оставаться до отдельной команды очистки? Кто отвечает за миграции данных плагина?
- Нужно ли обещать live activation для всех видов `$<keyword>_` или сначала честный restart-bound режим с частичной горячей перезагрузкой?
- Публикация: общий API provider или самостоятельный publisher-контракт; кто выдаёт и подтверждает владение `@scope`?
