# Implementation Plan

> Основано на решениях от 2026-07-04 (см. DESIGN_NOTES.md).
> Принцип: каждый этап заканчивается рабочей сборкой и проверкой на реальном устройстве/подписке.

## Платформенный фокус (2026-07-04)

**Android-first.** Проходим все этапы (1→4) сначала на Android, доводим до рабочего состояния на реальном устройстве. iOS проектируем параллельно (spec/API общие, кроссплатформенные), но нативную реализацию iOS делаем вторым проходом после того, как Android заведён. Все изменения в `.nitro.ts` спеке держим платформо-нейтральными, чтобы iOS-слой лёг сверху без переделки API.

> **iOS — второй проход ЗАВЕРШЁН (2026-07-06, проверено на iPhone 11 / iOS 18.4.1).** Паритет с Android достигнут, включая olcrtc-обход: старт/стоп, события состояния (`NEVPNStatusDidChange`), `getStats` через provider-message в NE, kill-switch (`NEOnDemandRule` + `includeAllNetworks`), Keychain для секретов, конфигурируемый DNS, надёжный TUN fd, и olcrtc в NE (merged-core ~57MB, работает). Полная документация iOS-слоя — **`docs/IOS.md`**. Упоминания «iOS — второй проход / стабы» ниже по тексту относятся к исходному плану и уже неактуальны.

## Этап 1 — Харднинг ядра + observability

> **Статус (Android): реализовано, компилируется во всех слоях (Go/Kotlin/JNI/TS).** Детали и чек-лист прогона на устройстве — `docs/STAGE1_ANDROID.md`. iOS — второй проход.

Цель: текущий клиент перестаёт «молча» падать и начинает сообщать состояние/трафик.

### 1.1 Достоверный старт (native)
- **Android:** `startXray` резолвит Promise только после реального результата движка. `XrayVpnService` возвращает статус старта (LocalBroadcast/`Messenger`/callback), `HybridNitroXrayCore` ждёт и `resolve/reject`. Ошибки Go (коды -1..-4) пробрасываются в JS с текстом.
- **iOS:** `startXray` уже ждёт `startVPNTunnel`; добавить обработку сбоя расширения (наблюдать переход в `.disconnected` с ошибкой сразу после старта).

### 1.2 События состояния (native → JS)
- Новый метод в spec: `addStateListener(cb: (state) => void): () => void`, где state = `disconnected|connecting|connected|disconnecting|error` + опциональное сообщение.
- **Android:** VpnService шлёт состояния; Hybrid эмитит в JS.
- **iOS:** подписка на `NEVPNStatusDidChangeNotification`.

### 1.3 Достоверный `isVpnConnected`
- **iOS:** грузить `NETunnelProviderManager.loadAllFromPreferences` (async-геттер `getConnectionState()`), не полагаться на in-process `manager`.
- **Android:** оставить флаг, но синхронизировать с реальным событием туннеля.

### 1.4 Статистика трафика (native)
- Включить `stats`+`policy` в генерируемом конфиге; в Go добавить экспорт `QueryStats()` через `stats.Manager` из запущенного `core.Server`.
- Новый метод: `getStats(): Promise<{ uplink: number; downlink: number }>` (байты, суммарно/по тегам).

### 1.5 Мелочи
- Пробросить `getVersion()` (Go `GetVersion` уже есть).
- Стрим логов в JS (опционально в этом этапе): уровень + строки через тот же listener-механизм.

**DoD этапа 1:** на Android и iOS: старт даёт корректный resolve/reject, JS видит `connecting→connected`, `getStats` растёт при трафике, статус верен после перезапуска апки.

---

## Этап 2 — Subscription layer + config builder (чистый TS)

> **Статус: реализовано и покрыто тестами (18 тестов, `bun test`), typecheck + сборка пакета зелёные.** Детали — `docs/STAGE2_SUBSCRIPTIONS.md`. Чистый TS, не зависит от устройства.

Цель: «вставил ссылку/QR → список серверов → подключился». Ядро продукта.

### 2.1 Парсеры URI (`src/subscription/`)
- `vless://`, `vmess://` (base64 JSON), `ss://` (SIP002 + legacy base64), `trojan://`.
- Разбор query-параметров: `type` (tcp/ws/grpc/httpupgrade/xhttp), `security` (none/tls/reality), `sni`, `pbk`, `sid`, `fp`, `flow`, `path`, `host`, `serviceName`, `alpn`.
- Тип `ParsedServer` (нормализованное представление).

### 2.2 Подписки
- `parseSubscription(raw)`: base64-decode → список URI → `ParsedServer[]`.
- `fetchSubscription(url)`: HTTP GET (+ поддержка заголовка profile-update-interval/user-info, если есть).

### 2.3 Config builder (`src/config/`)
- `buildXrayConfig(server, options)`: `ParsedServer` → полный Xray JSON (outbound + streamSettings под нужный транспорт/security, tun-inbound, routing, dns).
- DNS **конфигурируемый** (не зашитый Google), опция «DNS через туннель».

### 2.4 Фасад
- `XrayClient.fromSubscription(url) → ParsedServer[]`
- `XrayClient.connect(server, options)` (строит конфиг + `startXray`)
- `XrayClient.startRaw(json)` — escape-hatch, обратная совместимость.

**DoD этапа 2:** реальная подписка Ильи парсится, серверы поднимаются через `connect()`, старый `startXray(json)` работает как раньше.

---

## Этап 3 — Kill-switch + URLTest

> **Статус (Android): реализовано** — spec (`setKillSwitch`/`isKillSwitchEnabled`), Kotlin-энфорсмент, URLTest на TS (+6 тестов), UI в example. Детали и чек-лист устройства — `docs/STAGE3_ANDROID.md`. iOS — второй проход (стабы стоят).
> **Отклонение:** `Builder.setBlocking(true)` из плана — не kill-switch (это режим I/O fd; xray сам форсит non-blocking). Реальный механизм: удержание установленного tun (blackhole) при смерти движка + бесшовная замена tun при переключении (establish нового до закрытия старого — окно утечки устранено).

### 3.1 Kill-switch / on-demand
- **iOS:** `NEOnDemandRule` (always-on) + `includeAllNetworks`/`enforceRoutes`; трафик блокируется при отключённом туннеле. *(второй проход)*
- **Android:** ~~`Builder.setBlocking(true)`~~ удержание tun при падении движка (см. выше) + инструкция по системному Always-on/Lockdown. ✅
- API: `setKillSwitch(enabled: boolean)`. ✅

### 3.2 URLTest / выбор быстрейшего
- MVP: TS-замер (HTTP HEAD до `server:port`, время до settle ≈ DNS+TCP RTT), сортировка серверов по задержке. ✅ `XrayClient.urlTest()`
- V2: реальный прокси-пинг через xray observatory (native), если MVP недостаточно.

**DoD этапа 3:** при обрыве туннеля трафик не течёт; список серверов сортируется по пингу.

---

## Этап 4 — olcrtc integration (единый core, один npm-пакет)

> Упаковка: остаёмся в `react-native-nitro-xray-core`. olcrtc — опциональный подмодуль/entry-point (`react-native-nitro-xray-core/olcrtc`). Нативно — один merged Go-бинарник (см. DESIGN_NOTES: два Go-рантайма не линкуются).

### 4.0 Гейт
- **Проверить лицензию olcrtc/olcbox** перед бандлингом в платный продукт. Без этого — не начинаем 4.2+.

### 4.1 PoC сцепки (Android first)
- Собрать olcrtc как локальный SOCKS5; xray outbound через `dialerProxy` → olcrtc SOCKS5.
- Замерить память и пропускную способность.

### 4.2 Единый Go-core
- Один Go-модуль импортит `xtls/xray-core` **и** olcrtc, собирается в ОДИН c-archive, экспортит `StartXray/StopXray` + `StartOlcrtc(config)/StopOlcrtc`/`GetOlcrtcSocksPort` (SOCKS-only, без TUN — TUN владеет xray).
- Пересобрать `libcore.so` / `Core.xcframework` из объединённого core (в CI, воспроизводимо). Один Go-рантайм на процесс.

### 4.3 TS-подмодуль `.../olcrtc`
- Отдельный Nitro-spec поверх общего core: `startOlcrtc(config)`, `stopOlcrtc()`, `getOlcrtcSocksPort()`. TS tree-shakeable — кто не импортит, тот не тянет.
- Документация: как включить «Russia bypass» — поднять olcrtc, затем `XrayClient.connect(server, { via: 'olcrtc' })` (билдер добавит `dialerProxy`).

**DoD этапа 4:** на реальной РФ-мобильной сети трафик идёт xray→olcrtc→сервер, туннель стабилен, память NE в пределах лимита iOS.

---

## Сквозные задачи (параллельно/после)

- **Безопасность:** секреты конфига iOS → Keychain (вместо App Group plist); конфигурируемый DNS; воспроизводимая CI-сборка нативных бинарников с публикацией хешей.
- **Документация реализации:** архитектура, iOS NE setup, схема конфига, API reference, гайд по подпискам.
- **Тесты:** unit на парсеры подписок (фикстуры реальных форматов), интеграционный прогон на устройстве.
