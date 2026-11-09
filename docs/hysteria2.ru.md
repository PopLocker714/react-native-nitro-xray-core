# Hysteria2

`parseShareLink` и `parseSubscription` принимают ссылки `hysteria2://` и `hy2://`.
Полученный `ParsedServer` содержит `protocol: 'hysteria2'`, `network: 'hysteria'`
и `security: 'tls'`. `XrayClient.connect` использует существующее нативное ядро Xray.

```ts
const server = parseShareLink(
  'hy2://auth@example.com:443/?sni=example.com#Hysteria2'
)
if (server) await XrayClient.connect(server)
```

Порт по умолчанию — 443. Поддерживаются IPv6 в квадратных скобках и авторизация
с percent-encoding. `obfs=salamander&obfs-password=...` включает обфускацию пакетов.
Проверка TLS включена. Поставляемое ядро не поддерживает её отключение: ссылки
с `insecure=1` или `insecure=true` возвращают `null`. Используйте сертификаты
от доверенного удостоверяющего центра.

Поддерживается фиксированный порт. Ссылки с переключением портов или `pinSHA256`
возвращают `null`, чтобы эти ограничения не потерялись молча. Неизвестные режимы
обфускации также возвращают `null`. Разбор ссылок Hysteria v1 не поддерживается.

Для подключения нужен доступ по UDP. При цепочке через SOCKS ретранслятор должен
поддерживать UDP ASSOCIATE; эту возможность следует проверить до цепочки с olcrtc.
