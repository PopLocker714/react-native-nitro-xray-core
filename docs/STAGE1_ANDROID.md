# Этап 1 — Харднинг + observability (Android)

Статус: реализовано, собирается (Go + Kotlin + CMake/JNI). Требует прогона на реальном устройстве.

## Что изменилось

### Публичный API (`src/specs/nitro-xray-core.nitro.ts`)
Добавлено:
- `getVersion(): string` — версия xray-core.
- `getStats(outboundTag: string): Promise<TrafficStats>` — накопительные байты uplink/downlink по тегу outbound.
- `onStateChange(cb: (state, message) => void)` — единственный нативный слот колбэка состояния.
- Типы `TrafficStats { uplink, downlink }` и `XrayState`.

### TS-фасад (`src/index.ts`)
- `addStateListener(listener): () => void` — мультиплексор поверх единственного нативного колбэка (много JS-подписчиков, один native), возвращает функцию отписки.

### Go-ядро (`go-core/libxray/main.go`, только Android build tag)
- `runningServer` теперь `*core.Instance` (доступ к фичам ядра).
- Новые экспорты: `GetVersion`, `QueryStats(tag)` (возвращает JSON `{"uplink":N,"downlink":N}` через `stats.Manager`), `FreeString`.

### JNI (`android/src/main/cpp/cpp-adapter.cpp`)
- Обёртки `getVersion` и `queryStats` с корректным освобождением C-строк через `FreeString`.

### Kotlin
- `XrayEngine.kt`: `external fun getVersion()`, `queryStats(tag)`.
- `XrayStateBus.kt` (новый): шина состояний + one-shot completion старта между сервисом и Hybrid.
- `XrayVpnService.kt`:
  - эмитит `connecting → connected` / `error`, `disconnecting → disconnected`;
  - **достоверный старт**: резолвит pending-completion только по реальному результату движка;
  - DNS для TUN больше не зашит на Google — берётся из extra `DNS_SERVERS`, дефолт Cloudflare (`1.1.1.1/1.0.0.1`).
- `HybridNitroXrayCore.kt`:
  - `startXray` теперь **ждёт** реального старта (suspendCancellableCoroutine + pending completion) и reject'ит с настоящей ошибкой Go (коды -1..-4);
  - реализованы `getVersion`, `getStats` (парсинг JSON → `TrafficStats`), `onStateChange`.

## Исправленные проблемы (из аудита)
- ❌→✅ Android `startXray` резолвил Promise до реального старта движка. Теперь ждёт.
- ❌→✅ Нет событий состояния. Теперь `connecting/connected/disconnecting/disconnected/error`.
- ❌→✅ Нет статистики трафика. Теперь `getStats(tag)` через StatsService ядра.
- ❌→✅ Google-DNS зашит в TUN. Теперь конфигурируемо, нейтральный дефолт.
- (iOS-часть этих фиксов — второй проход, API уже платформо-нейтрален.)

## Как проверить на устройстве
1. Пересобрать нативное (уже собрано локально; для APK — обычный `bun run android` в `example/`).
2. Конфиг в примере уже содержит `stats: {}` + `policy` (иначе `getStats` вернёт нули).
3. Сценарий в UI примера:
   - при старте видно `Xray-core version: ...`;
   - строка State меняется `connecting → connected`;
   - при трафике растут `↑/↓ KB` (poll 1с, тег `proxy`);
   - неверный конфиг → `startXray` реджектит с текстом ошибки, State = `error`;
   - Stop → `disconnecting → disconnected`.

## ⚠️ Gotcha: пакет Kotlin-реализации Nitro
`nitrogen` 0.35.2 **жёстко** генерирует JNI-дескриптор реализации как
`Lcom/margelo/nitro/<androidNamespace>/<implementationClassName>;`, т.е. класс
`HybridNitroXrayCore` ОБЯЗАН лежать в пакете `com.margelo.nitro.nitroxraycore`.
Если он в `com.nitroxraycore` (как было изначально), после любого `bunx nitrogen`
рантайм падает с `ClassNotFoundException: com.margelo.nitro.nitroxraycore.HybridNitroXrayCore`.
Поэтому файл перенесён в
`android/src/main/java/com/margelo/nitro/nitroxraycore/HybridNitroXrayCore.kt`.
Остальные классы (`XrayVpnService`, `XrayEngine`, `XrayStateBus`, `VpnRequestActivity`,
`NitroXrayCorePackage`) остаются в `com.nitroxraycore` — на них ссылаемся по импорту/FQN.
**Не** править сгенерированный `NitroXrayCoreOnLoad.cpp` вручную — следующий codegen
(Этап 4 добавит методы olcrtc) снова перезапишет его.
После регенерации нужно нативно пересобрать/переустановить приложение (не просто reload JS).

## Известные ограничения (осознанные, не баги)
- `pendingStart` — один слот: два одновременных `startXray` не поддержаны (модель одного соединения). При необходимости — очередь/отмена в Этапе 3.
- `getStats` читает `outbound>>>{tag}>>>traffic>>>...`; тег должен совпадать с тегом proxy-outbound в конфиге (в билдере Этапа 2 зафиксируем `proxy`).
