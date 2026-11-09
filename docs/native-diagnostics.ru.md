# Основа нативной диагностики (не опубликована)

Основной контракт и точный список CI-проверок: [English](native-diagnostics.md).
Версия остаётся 1.7.0, но ABI исходников изменена. Опубликованные бинарники 1.7.0
не реализуют новые методы. До генерации Nitrogen и пересборки всех платформенных
артефактов этот commit нельзя выдавать за готовый SDK/app build или OTA.

Публичные методы: getDiagnosticSnapshot(after=0), clearDiagnostics(),
getSystemVpnStatus(). Wrapper проверяет поля DTO по allowlist; неизвестные поля,
произвольный текст, старый binary и недоступный NE дают available=false.
Snapshot возвращает events/next/more/dropped/truncated/probe. Cursor — только
внутри одного процесса; после перезапуска нужен 0. Clear не сбрасывает identity.

Буфер Go: 1024 events / 256 KiB сериализованных записей, запись 512 B, TTL 10 минут,
страница до 32 KiB. Это лимит payload, не heap с overhead. Шум ограничен 896 events /
192 KiB; terminal errors/fatal сохраняются при менее серьёзном шуме. dropped
объединяет неизвестные строки, вытеснение и TTL; truncated — oversized events.
Access/DNS/raw config/адреса/ключи/URL/email не записываются. logcat/syslog/stderr
не собираются. Upstream строки принимаются только по точным известным шаблонам;
неизвестные ошибки также отбрасываются. Wrapper движка даёт фиксированные outcomes.
Retry warning не равен окончательному отказу.

Источники app/xray/olcrtc, producers android_service/ios_ne/go. UTC — wall clock,
elapsedMs — monotonic Go, clockScope — процесс. Разные scopes нельзя вычитать.
Native starts создают локальные attempts; блокирующие wrapper calls захватывают
attempt до запуска. Асинхронные upstream logs имеют attempt=0: принадлежность
не доказана. Android olcrtc, начатый JS до сервиса, тоже может иметь attempt=0.
Буфер ios_app не реализован. JS/cross-process связи не выдумываются.

NE IPC ограничен 256 B входа / 32 KiB ответа, timeout app bridge 2 секунды.
В App Group атомарно сохраняется защищённый от backup очищенный bounded хвост
native-diagnostics.json на lifecycle/snapshot границах. При убийстве процесса
поздние события могут пропасть. При недоступном NE cursor=0 читает checkpoint до 72 часов; checkpointUtc явно
помечает исторический снимок. Такой снимок не запускает диагностику живого сбоя.
Доставка отчёта остаётся consumer-задачей. Clear требует доступного NE.
Реальный PacketTunnelProvider приложения и пример SDK обновлены.

Android app killSwitch отдельно от системных Always-on/lockdown. System replay
разрешён только с opted-in сохранённым успешным QuickConnectStore payload.
API29+ проверяет isAlwaysOn; null restart без этого признака не подключает VPN.
API24–28 status неизвестен, replay допустим только для явного SERVICE_INTERFACE.
Manual stop сохраняет запрет system replay; явный app/widget start разрешает снова.
Widget replay сохранён. Logout: сначала stopXray, потом clearStoredConfig.
Нет конфига/opt-in — безопасный отказ, никакого direct fallback.
UI открывает Settings.ACTION_VPN_SETTINGS (android.settings.VPN_SETTINGS),
пользователь включает OS setting сам. supported не означает настройку включённой;
alwaysOn/lockdown=null при отсутствии возможности узнать статус. iOS on-demand
и includeAllNetworks не менялись.

probe=unavailable. Idle, zero bytes, один ping, RN fetch через underlay и engine_chain
не доказывают потерю TUN. Автоотчёты и backend delivery здесь не реализуются.

Проверено удалённо в CI42596289093: Nitrogen, TypeScript, 114 Bun tests, Go race и
Kotlin policy tests; собраны iOS device/simulator archives. Bindings и iOS
артефакты перенесены из CI с проверкой хешей. Generated whitespace сохранён как
выдал Nitrogen. Локально теперь 115 Bun tests (добавлена проверка checkpoint).

CI42597366177 ещё выполняется: исправляет установку Android SDK, собирает четыре
Android ABI и Android/iOS example bridge/NE. Эти native consumer checks пока не
объявлены успешными. В iOS provider прямые C references вместо dlsym: matching
Go header/archive обязательны. Old installed SDK по-прежнему даёт unavailable
через optional-capability JS wrapper. Native device/Always-on/boot/logout matrix
остаётся release gate. Ничего не опубликовано в npm/магазинах/OTA. Локальная
тяжёлая сборка запрещена guard при недостатке памяти или диска; проверки
перенесены в branch-only CI, исходники не выдают за установленное приложение.
