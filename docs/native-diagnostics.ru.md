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
поздние события могут пропасть. Публичный API пока читает живой NE; reader/TTL/
доставка checkpoint — следующая consumer-задача. Clear требует доступного NE.
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

Проверено: 114 Bun tests, прежние 103 сохранены. Guard отказал codegen/typecheck:
сначала pressure=2/disk=0,74 GiB; затем disk=2,15 GiB при минимуме 4 GiB.
Go race tests, Kotlin policy runner, native builds/device matrix не запускались.
Generated Nitrogen, C headers, .so/.a/XCFramework не обновлены. Требуется CI:
генерация → host collector/policy tests → все нативные артефакты → сборка bridge/NE →
device checks. Новые Go symbols должны пережить static dead-strip и быть доступны
через dlsym в NE; это отдельный обязательный CI gate. Точные шаги и список символов
даны в основном документе. Push/PR/release/workflow dispatch не выполнялись.
