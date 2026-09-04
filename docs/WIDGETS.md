# Home-screen widgets

Everything here was learned by shipping a widget on both platforms and watching
it fail on real devices. Read it before you write one, not after.

## The one rule that decides the design

**A widget runs when your JS does not.** The user taps it with the app swiped
away, so there is no React Native runtime, no store, no hooks — nothing you
wrote in JS is alive. Every capability the widget needs must exist natively.

That single constraint explains everything below.

## Quick connect: replay, not rebuild

A widget cannot build a config: building one needs your subscription, your
server list, your JS. So it replays the last config that worked.

```ts
// Opt in once, e.g. at app start. Nothing is stored until you do.
await XrayClient.setQuickConnectEnabled(true)

// Whether a one-tap reconnect is possible right now.
const ready = await XrayClient.isQuickConnectReady()
```

Android stores the payload after every **successful** start, so a widget can
never replay a config already known to fail.

### The bypass needs two halves

If you offer an olcrtc bypass, note that its xray config dials
`127.0.0.1:<socks>` — a port that exists only while olcrtc runs. Replaying that
config alone raises a tunnel pointing at nothing: connected, silent, no error
anywhere.

The library stores the olcrtc client config **alongside** the xray one and
starts the bypass **before** the engine on a quick-connect start. You get this
for free; the thing to remember is that you must connect through the bypass
from the app **at least once**, so there is a working pair to replay.

## Android

### Wiring

```kotlin
// Start from the stored payload. Dispatch with startForegroundService —
// the service enters the foreground itself, and a widget tap is an accepted
// exemption from the background-start restriction.
ContextCompat.startForegroundService(context, XrayVpnService.quickConnectIntent(context))

// Stop. Plain startService — the stop path deliberately never goes foreground.
context.startService(XrayVpnService.stopIntent(context))
```

Check `QuickConnectStore.isReady(context)` first, and check
`VpnService.prepare(context)` — the system consent dialog needs an Activity, so
from a receiver you must open the app instead of failing silently.

### Keeping the label honest

The service broadcasts `<applicationId>.XRAY_STATE_CHANGED` on every state
change. Subscribe in the manifest:

```xml
<receiver android:name=".widget.VpnWidgetProvider" android:exported="false">
    <intent-filter>
        <action android:name="android.appwidget.action.APPWIDGET_UPDATE"/>
        <action android:name="${applicationId}.XRAY_STATE_CHANGED"/>
    </intent-filter>
</receiver>
```

This exists because the library's state listener is a **single slot** already
taken by the JS bridge. A second subscriber would silently kill updates
everywhere. The broadcast is how a non-JS entry point learns about state, and a
manifest-declared receiver survives a dead JS process.

### End the transition on the ENGINE, not the tunnel

The TUN comes up in ~200 ms. A bypass then negotiates with the relay for
another second or two. If you decide "connected" by the tunnel, that window has
`isRunning == true` and `isEngineRunning == false` — which the library defines
as *kill-switch blackhole*, and your widget will say "traffic blocked" over a
perfectly healthy connect.

```kotlin
val settled = if (connecting) XrayVpnService.isEngineRunning else !XrayVpnService.isRunning
```

### Haptics need HARDWARE_FEEDBACK

A widget handles its tap in a background receiver, and since Android 12 the
system drops background vibrations whose usage is `TOUCH`
(`Ignoring incoming vibration as process is background`). Use
`VibrationAttributes.USAGE_HARDWARE_FEEDBACK`, which describes feedback for a
physical action and is allowed from the background.

## iOS

### WidgetKit redraws once per tap

At the moment `perform()` **returns**. That reload is the only one exempt from
the refresh budget. Everything else is throttled into irrelevance:

| Mechanism | Reality |
|---|---|
| `reloadAllTimelines()` from the app, foregrounded | works — the app being in the foreground is a documented exemption |
| `reloadAllTimelines()` from a Network Extension, app dead | does **not** land — not on the exemption list |
| `.after(n)` with n below ~5 minutes | not honoured; Apple asks for entries ~5 minutes apart |
| `.never` | means "until the app asks", i.e. never while the app is dead |

So: **do not return from `perform()` until the state is worth showing.** Return
early and the guaranteed reload paints a transient state that then sticks.

"Worth showing" means **terminal**, not merely informative. Returning on an
intermediate state ("bringing up the bypass") looks reasonable and is the same
bug in a nicer costume: the one free redraw goes to a caption that is already
obsolete, and the truth waits on the budget. Measured on device: the extension
asked for a reload 2.3 s after the tap, `chronod` logged that request as
`budgeted`, and the widget changed only 34 s later — by timeline advance, not by
the request. After the intent was made to wait for a terminal state, tap to
final caption took 2.77 s.

Size the wait against the real handshake time, and keep an optimistic future
timeline entry as the fallback for when the wait times out.

Never use `.never` here. Give terminal states an `.after(15 min)` floor so a
tunnel that drops on its own eventually self-heals.

### NEVPNStatus is not enough

It goes `connected` in a fraction of a second, while a bypass may need
seconds — up to ~30 on a bad day. A green "Connected" over a tunnel that cannot
carry traffic yet is worse than an honest "bringing up the bypass".

The bypass phase must travel on its own channel. Write it from the Network
Extension into the App Group as a **file** — `UserDefaults` has a cross-process
cache that makes NE→app delivery unreliable; `Data(contentsOf:)` has no such
cache.

### Confirming the tap

There is no public API for haptics from a widget extension:
`UIImpactFeedbackGenerator` needs a `UIWindowScene` and silently does nothing
without one. `AudioServicesPlaySystemSound(kSystemSoundID_Vibrate)` does work,
but it is a full vibration with no way to soften it — we tried it and removed
it as too harsh for a toggle.

Confirm the tap with the **label** instead: write the user's intent somewhere
shared, render it immediately, and clear it before returning so the guaranteed
reload paints the truth.

### Filter the profile

`loadAllFromPreferences()` returns every VPN profile on the device. Match on
`providerBundleIdentifier`, exactly as the library does internally, or you will
eventually drive somebody else's VPN.

### Restore what you take away

If you disable an on-demand rule so an explicit stop sticks, stash a marker in
`providerConfiguration` and restore it on the next start. Otherwise a single
widget tap permanently drops the user's always-on setting.

## The notification (Android)

`setNotificationConfig({ text })` accepts a `{connection}` placeholder,
substituted with the live connection: an explicit `label`, else the server tag.

```ts
XrayClient.setNotificationConfig({ text: 'Connected · {connection}' })

// olcrtc-only has no server tag, so name it yourself:
await XrayClient.connectOlcrtcOnly({ label: 'Bypass' })
```

Without the placeholder the text is used verbatim, so this changes nothing for
existing integrations.

## Checklist

- [ ] Quick connect is opted in, and the user has connected once
- [ ] Bypass connected from the app at least once (both halves stored)
- [ ] Android: manifest subscribes to `XRAY_STATE_CHANGED`
- [ ] Android: transition ends on the engine, not the tunnel
- [ ] Android: vibration uses `USAGE_HARDWARE_FEEDBACK`
- [ ] iOS: `perform()` awaits a showable state before returning
- [ ] iOS: no `.never`, no `.after` below 5 minutes
- [ ] iOS: bypass phase travels via an App Group file, not `UserDefaults`
- [ ] iOS: profile matched by `providerBundleIdentifier`
