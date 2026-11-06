# wg-easy: форк с маршрутизацией

Состояние работы и следующий шаг — в `TASK.md`.

## Что это

- Форк [wg-easy/wg-easy](https://github.com/wg-easy/wg-easy). Сверху добавлены:
  - маршрутизация по правилам (Admin → Routing): шлюзы, правила по доменам и адресам, DNS-прокси, проброс портов;
  - изоляция клиентов.
- Пользовательская документация: `docs/content/advanced/routing.md` и раздел Isolation в `docs/content/guides/clients.md`. Поведение меняешь — правь её в том же изменении.
- Ветки:
  - `feat/router` — рабочая и основная, `origin` = amir-al-mohamad/wg-easy;
  - `upstream` = wg-easy/wg-easy, ветка `master`;
  - `backup/feat-router-pre-sync` — локальный бэкап до синхронизации 49fdf78.
- Nuxt-приложение лежит в `src/`, все `pnpm`-команды запускай оттуда.

## Отношения с upstream

- Доменную маршрутизацию upstream не примет: [#2606](https://github.com/wg-easy/wg-easy/issues/2606) закрыт как *not planned* («no plan to add dns resolution»). Это ценность форка, а не кандидат в PR.
- Кандидаты в upstream, отдельными небольшими PR:
  - изоляция: дополняет per-client firewall из [#2418](https://github.com/wg-easy/wg-easy/issues/2418);
  - затем проброс портов: [#2364](https://github.com/wg-easy/wg-easy/issues/2364) открыт, но сейчас он использует общий код routing, и его придётся отделять.
- По `contributing.md`:
  - помощь ИИ в PR нужно раскрыть фразой в описании. Это не строка Co-Authored-By — такие строки запрещены;
  - отвечать ревьюерам пользователь будет сам.
- Синхронизация: merge `upstream/master` в `feat/router`. Upstream активно перестраивает архитектуру. Сначала разберись в их новой структуре (`#db`, `createStore`, `features/*`, `shared/contracts`, `defineAuthenticatedEventHandler`), потом переноси наш код на неё. Не наоборот.

## Миграции — главная грабля при синхронизации

- Мигратор Drizzle сравнивает только `created_at`, то есть поле `when` в `meta/_journal.json`; номер и тег он не смотрит. Наши миграции должны идти после всех upstream-миграций и иметь больший `when`.
- Если upstream занял наши номера, сложи наши в одну идемпотентную миграцию после их последней. Так сделана 0011.
- libsql выполняет миграции с `PRAGMA foreign_keys=off`.
- Upstream-миграция 0010 пересобирает `clients_table`. У баз со старой версии ветки теряется флаг `isolated`; это известное и принятое ограничение.
- После правки схемы:
  - `pnpm db:generate` должен ответить «No schema changes»;
  - `pnpm exec drizzle-kit check` должен пройти чисто.
- Ручную миграцию (например, RENAME COLUMN) клади вместе со снапшотом `meta/NNNN_snapshot.json`: новый `id`, `prevId` = id предыдущего снапшота.
- Синхронизацию проверяй на трёх видах баз: свежей, upstream-базе с данными и базе со старой версии ветки с данными routing.

## Где что лежит

- Схемы валидации API: `src/shared/contracts/{gateway,routingRule,routingConfig,portForward}.ts`.
- Константы для `z.enum`: `src/shared/utils/routing.ts`; `canonical()` для адресов: `src/shared/utils/address.ts`.
- `src/server/database/repositories/*/types.ts` — только row-типы (`InferSelectModel`).
- Типы UI выводятся из ответа API в `src/app/utils/routing.ts` через `TypedInternalResponse`. Ручные дубли типов и касты в компонентах не заводи.
- Логика страницы routing: `src/server/features/routing.ts`. Ядро — `src/server/utils/routing/`:
  - `plan.ts` — чистая сборка шагов;
  - `apply.ts` — их выполнение;
  - `ipset.ts`, `dns.ts`, `interfaces.ts`, `scheduler.ts`, `marks.ts`.
- Изоляция: `isolationRules` в `src/server/utils/firewall.ts`, цепочка `WG_CLIENTS_<iface>`. Список клиентов для выбора отдаёт `/api/client/names`.

## Инварианты routing — не ломай

- Метки пакетов:
  - маршрут хранится в младших 16 битах, `MARK_MASK` = `0xffff`;
  - флаг форварда в ctmark — `FORWARD_CONNMARK` = `0x10000`, он выше маски;
  - таблицы маршрутов 100–251, приоритеты `ip rule` 100–252.
- Маршрут решается на первом пакете и закрепляется через CONNMARK:
  - правки правил действуют только на новые соединения;
  - выключение или удаление шлюза перераспределяет его соединения, потому что его метка выпадает из `liveMarks`.
- Цепочки iptables ставятся атомарно: один `iptables-restore -w --noflush` на таблицу, jump добавляется через `-C || -A`. К поштучным `-A` с предварительным flush не возвращайся.
- ipset пишется пачкой через `ipset -exist restore` (stdin, `exec(cmd, { input })`); если пачку отклонят, строки применяются по одной. Повторный `add` без timeout делает запись постоянной — так задумано для вписанных вручную адресов.
- Вывод `ip` разбирается только через `ip -j` и чистые парсеры в `interfaces.ts`.
- DNS-прокси:
  - адрес попадает в ipset до того, как ответ уходит клиенту, с бюджетом `LEARN_BUDGET_MS` = 500;
  - TCP-запрос клиента идёт наверх тоже по TCP;
  - урезанный UDP-ответ пересылается как есть, чтобы клиент повторил запрос по TCP.
- Shell-команды собираются строками, как в firewall у upstream. Всё, что в них подставляется, проверяй регулярками (`KEY`, `PEER_VALUE` в `interfaces.ts`).
- Для apply и overview БД читается одной транзакцией.
- `createError` бери из `nuxt/server`, параметры — `{ status, statusText }`.

## Проверки (из `src/`)

```sh
pnpm typecheck
pnpm test:e2e:typecheck
pnpm lint
pnpm exec prettier . --check --end-of-line auto
pnpm test:unit
pnpm build
```

- `--end-of-line auto` нужен из-за `core.autocrlf=true` на этой машине. `pnpm format:check` без этого флага ругается на каждый файл, и это не ошибка кода.
- e2e на Windows запускаются в обход скрипта, порядок — ниже.

## e2e на Windows

`pnpm test:e2e` (`scripts/test-e2e.sh`) здесь не работает: `docker.exe` не понимает `--env-file /dev/null`. Как запускалось:

1. Один раз поставь Playwright: `pnpm exec playwright install --only-shell chromium`.
2. Переведи `docker/iptables-backend.sh` в LF: `sed -i 's/\r$//' docker/iptables-backend.sh`. Git изменений не увидит, а с CRLF скрипт внутри контейнера падает.
3. Из корня собери образ: `docker build -t wg-easy-e2e:local .`
4. Создай пустой файл `empty.env` в скретчпаде и временно замени `'/dev/null'` в `src/test/e2e/fixtures.ts` на путь к нему (sed).
5. Задай `E2E_RUN_DIR` = `<скретчпад>/e2e-run` (с пустым файлом `projects` внутри) и из `src/` запусти `pnpm exec playwright test`.
6. Верни `'/dev/null'` обратным sed. Не делай `git checkout`, если в `fixtures.ts` есть незакоммиченные правки.
7. Для каждого проекта из файла `projects` выполни `docker compose --env-file <empty.env> -f ../docker-compose.test.yml -p <project> down --volumes --remove-orphans`.
