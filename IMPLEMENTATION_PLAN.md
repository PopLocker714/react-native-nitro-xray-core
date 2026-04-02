# План реализации VPN-библиотеки на React Native + Nitro Modules + Xray-core

Цель: Создать кроссплатформенный (Android & iOS) React Native модуль, обеспечивающий полноценное системное VPN-соединение (маршрутизация всего трафика устройства) с использованием движка Xray-core и высокопроизводительного моста Nitro Modules.

## Архитектура решения

1. **JS/TS слой**: React Native приложение общается с нативной частью через Nitro Modules. Пользователь передает конфигурацию (в формате JSON).
2. **Native Мост (Nitro)**: Nitro-объекты на Kotlin (Android) и Swift (iOS) принимают команды и управляют системными VPN-API.
3. **Системные VPN API**:
   - Android: `VpnService` для создания TUN-интерфейса и захвата трафика.
   - iOS: `NetworkExtension` (`NEPacketTunnelProvider`) для аналогичных задач.
4. **Go-Bridge**: Прослойка на C/C++ или gomobile, которая связывает нативный код (Kotlin/Swift) с бинарником Xray, написанным на Go.
5. **Xray-core**: Получает файловый дескриптор (FD) TUN-интерфейса, читает/пишет в него пакеты и проксирует трафик через настроенные outbounds (VLESS, Shadowsocks и т.д.).

---

## Фаза 1: Подготовка Xray-core и сборка (Go -> Mobile)

Самый критичный шаг — собрать Xray так, чтобы он мог работать внутри мобильного приложения и принимать системный TUN.

1. **Создание Go-обертки (`libxray`)**:
   - Написание кода на Go (с использованием `cgo`), экспортирующего методы:
     - `func StartXray(configJson *C.char) C.int`
     - `func StopXray() C.int`
     - Управление логированием (callback или запись в файл).
   *Примечание*: Xray должен быть сконфигурирован на использование встроенного inbound для TUN (ожидается поддержка кастомных файловых дескрипторов или использование `tun://`).
2. **Скрипты сборки**:
   - Создание `.sh` или `Makefile` скриптов.
   - **Android**: Сборка `.so` библиотек (через `go build -buildmode=c-shared`) или `.aar` (через `gomobile bind`) для архитектрур: `arm64-v8a`, `armeabi-v7a`, `x86`, `x86_64`.
   - **iOS**: Сборка `.xcframework` для `arm64` (устройства) и `x86_64`/`arm64` (симуляторы).

## Фаза 2: Проектирование интерфейса Nitro (TypeScript)

Определение API, доступного в JavaScript.

1. **Обновление `nitro-xray-core.nitro.ts`**:
   ```typescript
   export interface NitroXrayCore extends HybridObject<{ ios: 'swift', android: 'kotlin' }> {
     // Запрашивает разрешение у системы на создание VPN
     prepare(): Promise<boolean>;
     // Запускает сервис с переданным JSON-конфигом
     start(config: string): Promise<boolean>;
     // Останавливает VPN
     stop(): void;
     // Возвращает текущий статус (подключен, разорван, ошибка)
     getState(): string; 
   }
   ```
2. Генерация нативного кода (кодогенерация Nitro).

## Фаза 3: Реализация на Android (Kotlin + C++)

1. **Интеграция библиотек**:
   - Добавление собранных библиотек (из Фазы 1) в папку `android/libs`.
   - Настройка `CMakeLists.txt` и `build.gradle` для линковки Xray с Nitro.
2. **`XrayVpnService.kt`**:
   - Наследование от Android `VpnService`.
   - Использование `VpnService.Builder` для настройки интерфейса (IP, MTU, DNS, Routes -> `0.0.0.0/0`).
   - Получение `ParcelFileDescriptor` туннеля.
   - Создание Foreground Service Notification (обязательно для Android, чтобы сервис не убила система).
3. **`HybridNitroXrayCore.kt`**:
   - Вызов `VpnService.prepare(context)` через Activity.
   - Запуск `XrayVpnService` через Intent и передача JSON-конфига.

## Фаза 4: Реализация на iOS (Swift)

На iOS VPN должен работать в отдельном Target-расширении процесса основного приложения.

1. **Интеграция библиотек**:
   - Подключение `Xray.xcframework` к iOS-проекту.
   - Настройка `Podspec` для правильной линковки.
2. **Настройка NetworkExtension Target (вне модуля Nitro)**:
   - В итоговом приложении потребуется создать Target `Packet Tunnel Provider`.
   - Мы должны подготовить классы/файлы, которые разработчик приложения добавит в свой Extension.
3. **`Packet Tunnel Provider` реализация**:
   - Настройка `NEPacketTunnelNetworkSettings` (IP туннеля, маршруты до `0.0.0.0/0`, DNS).
   - Инъекция FD (файлового дескриптора) из `packetFlow` в Xray или создание пайпа между `packetFlow.readPackets` и `io.Reader/Writer` внутри Go-кода (специфично для iOS).
4. **`HybridNitroXrayCore.swift`**:
   - Использование `NETunnelProviderManager`.
   - Установка и сохранение VPN-профиля (`loadAllFromPreferences`, `saveToPreferences`).
   - Отправка команды запуска (с JSON-конфигом) расширению через `startVPNTunnel(options:)`.

## Фаза 5: Интеграция и тестирование (Приложение Example)

1. Обновление React Native кода в папке `example`.
2. Подготовка валидного тестового JSON-конфига (например, VLESS конфигурация + Inbound для TUN).
3. Тестирование:
   - Авторизация VPN (вызов `prepare()`).
   - Успешный запуск туннеля.
   - Проверка изменения IP-адреса устройства на сторонних сайтах.
   - Корректная остановка и очистка маршрутов.
