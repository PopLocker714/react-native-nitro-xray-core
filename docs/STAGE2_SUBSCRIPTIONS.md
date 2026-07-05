# Этап 2 — Подписки + config builder

Статус: реализовано, 18 unit-тестов (`bun test`), typecheck + `bob build` зелёные. Чистый TS.

## Новые модули

| Файл | Назначение |
|------|-----------|
| `src/subscription/types.ts` | `ParsedServer` — нормализованное представление сервера (протокол-агностичное). |
| `src/subscription/base64.ts` | Портируемый base64 (URL-safe + UTF-8) без `atob`/`Buffer`/`TextDecoder` — надёжно в Hermes/Node/Bun. |
| `src/subscription/parse.ts` | `parseShareLink(uri)`, `parseSubscription(payload)`. Ручной парсинг URI (RN `URL` неполный). |
| `src/config/build.ts` | `buildXrayConfig(server, options)` — `ParsedServer` → полный Xray JSON. |
| `src/native.ts` | Нативный hybrid + `addStateListener` (вынесено из index, чтобы `client` не импортил index → без циклов). |
| `src/client.ts` | `XrayClient` — высокоуровневый фасад. |

## Поддерживаемые форматы ссылок
- `vless://` — tcp/ws/grpc/httpupgrade/xhttp/h2/kcp; security none/tls/reality; flow, sni, fp, pbk, sid, spx, alpn.
- `vmess://` — base64 JSON (v/ps/add/port/id/aid/scy/net/type/host/path/tls/sni/alpn/fp).
- `trojan://` — по умолчанию TLS; те же stream-параметры.
- `ss://` — SIP002 (`base64(method:password)@host:port`) и legacy (`base64(method:password@host:port)`).
- Подписка: base64-блоб ИЛИ newline-список ссылок; неразбираемые строки пропускаются.
- IPv6-хосты (`[..]:port`), не-ASCII имена (#fragment, vmess ps).

## Публичный API (фасад)
```ts
import { XrayClient } from 'react-native-nitro-xray-core'

const servers = await XrayClient.fromSubscription('https://sub.example/link')
await XrayClient.ensurePermission()
const off = XrayClient.onState((s, msg) => console.log(s, msg))
await XrayClient.connect(servers[0])          // строит конфиг + стартует, ждёт реального старта
const { uplink, downlink } = await XrayClient.stats()
await XrayClient.disconnect()

// escape-hatch — сырой JSON как раньше:
await XrayClient.startRaw(myRawXrayJson)
```
Низкоуровневый `NitroXrayCore` и `addStateListener` тоже экспортируются (обратная совместимость).

## Гарантии/инварианты
- Proxy-outbound всегда тегается `proxy` (переопределяемо) — совпадает с тегом `stats()`, поэтому учёт трафика работает «из коробки».
- Конфиг всегда содержит `stats`+`policy` (если не отключить) — иначе `getStats` вернёт нули.
- DNS в билдере конфигурируемый (дефолт `1.1.1.1`+`localhost`), приватные диапазоны идут `direct`.

## Что осознанно НЕ сделано в этом этапе
- QR-код: декодирование QR → это UI-слой приложения (камера), библиотека принимает уже строку. Парсер строки готов.
- Clash/sing-box YAML, SIP008 JSON-подписки — редкие для Xray-экосистемы; добавим при необходимости.
- Плагины shadowsocks (obfs/v2ray-plugin) — параметр `?plugin=` сейчас игнорируется.

## Тесты
`src/subscription/__tests__/parse.test.ts` — vless(reality/ws/grpc), trojan, vmess, ss(оба формата), IPv6, base64-подписка, UTF-8, и сборка конфига (outbound/routing/streamSettings/stats/кастомный тег+DNS). Папка `__tests__` исключена из публикуемого пакета (bob default) и из `tsc`.
