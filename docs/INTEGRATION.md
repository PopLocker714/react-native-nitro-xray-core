# Integration guide

Everything in this document is about one thing: not stranding your user behind a tunnel they
cannot turn off. A VPN client fails differently from a normal app — when it gets state handling
wrong, the user loses their internet and the app is the only thing that can give it back.

Read §1 and §2 before you ship. The rest is reference.

File references here name files and functions, never line numbers — line numbers rot on the next
commit and a stale citation is worse than none.

---

## 1. The four rules

1. **Subscribe to the state stream before you connect.** The stream reports transitions, not the
   current state, and it does not replay. `addStateListener` (`src/native.ts`) just adds your
   callback to a Set.
2. **Render `blocked` as a disconnectable state, never as an error.** It is a live tunnel with a
   dead engine. If your only action is "Connect", the user cannot get their network back. See §3.
3. **Reconcile on cold start and on foreground.** A freshly mounted JS context has missed every
   transition. Read `isConnected()` and `isEngineRunning()` once, then let the stream take over.
4. **`await disconnect()` is not a promise that the tunnel is gone forever, and `await connect()`
   is not a promise that traffic flows.** See §5 for what each actually guarantees.

---

## 2. Connection states

```ts
import { XrayClient } from 'react-native-nitro-xray-core'
import type { XrayState } from 'react-native-nitro-xray-core'

const unsubscribe = XrayClient.onState((state: XrayState, message: string) => {
  // ...
})
```

`XrayState` is a plain string union, deliberately not a native enum, so the value survives the
JS/native boundary unchanged and new states can be added without a codegen break.

**The two platforms do not emit the same set.** Android drives the stream from its own
`VpnService` lifecycle; iOS maps `NEVPNStatus`. Write your handler against the union, but do not
assume symmetry.

| State | Android | iOS | What it means | What your UI must do |
|---|---|---|---|---|
| `connecting` | yes | yes | A start was dispatched. On Android this also fires for a **server switch**, where the tunnel is never dropped | Spinner. Keep Disconnect enabled — a stop queued behind an in-flight start still wins |
| `connected` | yes | yes | Tunnel up, engine running | Green. With olcrtc on iOS this is **not** the end of the wait — see §4 |
| `disconnecting` | yes | yes | Teardown started | Spinner. Do not offer Connect yet |
| `disconnected` | yes | yes | No tunnel | Idle. Clear stats and any olcrtc sub-state |
| `reconnecting` | **never** | yes | iOS is re-establishing after a network change (Wi-Fi ↔ cellular) | Treat as a soft `connecting`: keep showing the server, keep stats, do not offer Connect |
| `error` | yes | **never** | A start failed and the tunnel is **down** — traffic is on the open network | Show the error, offer Connect |
| `blocked` | yes | **never** | A start or restart failed while a tunnel was up and the kill switch was on. Tunnel deliberately held, every packet dropped | **Offer Disconnect.** See §3 |

Consequences you have to design around:

- **On iOS you will never see `error` or `blocked`.** Connect failures surface as a rejected
  `connect()` promise. But note the gap: iOS resolves the promise as soon as `startVPNTunnel()`
  returns, so a Network Extension that then fails to bring the engine up resolves successfully
  and only shows up as the tunnel not reaching `connected`. Do not treat a resolved `connect()`
  on iOS as proof of a working tunnel.
- **On Android you will never see `reconnecting`.**
- **iOS deduplicates identical consecutive states**, Android does not. A failed Android retry
  emits `connecting` then `blocked` again; the same sequence on iOS may collapse.
- **`error` can arrive with no preceding `connecting`** on Android, when a start is dispatched
  with no config at all.

### Subscribe before you connect

On Android `connected` is emitted *before* `connect()` resolves. A listener registered after the
`await` never sees it and your UI hangs on a spinner forever.

```ts
// WRONG — the event has already been delivered by the time you subscribe
await XrayClient.connect(server)
const unsub = XrayClient.onState(handle)

// RIGHT
const unsub = XrayClient.onState(handle)
await XrayClient.connect(server)
```

---

## 3. `blocked` — the state this library exists to make visible

### What it is

Android only. The kill switch is on, a tunnel is already established, and the engine failed to
start — most often on a reconnect or a server switch. The service then keeps the interface up on
purpose: the routes `0.0.0.0/0` and `::/0` stay claimed and nothing reads the interface, so every
packet is dropped instead of leaking onto the open network. That is the kill switch working.

Precisely: it means *a start or restart failed*, not *the engine crashed*. Nothing watches for a
spontaneous engine death.

### Why rendering it as an error strands the user

`isConnected()` still returns `true` in this state, the system VPN key icon is still in the status
bar, and the device has no working network.

If you map `blocked` onto your error branch — "something went wrong, tap Connect to retry" — the
only control you have shown the user is Connect. Tapping it re-runs the start; if the cause is
still there it fails again and re-enters `blocked`. The user is in a loop, with no internet, and
the one control that would release the tunnel is not on screen.

```ts
// WRONG
if (state === 'error' || state === 'blocked') showError('Не удалось подключиться')

// RIGHT
if (state === 'blocked') {
  setStatus('Трафик заблокирован')   // honest: traffic is being withheld, not leaking
  setPrimaryAction('disconnect')     // the only control that releases the tunnel
}
```

### The trap inside the trap

**`setKillSwitch(false)` does not release a held tunnel.** On Android it only writes a
persisted flag (`KillSwitchStore`); it never touches the running service. Do not wire "turn off
the kill switch" as the escape hatch. Wire Disconnect.

### Every way out

| Exit | Trigger | Stream |
|---|---|---|
| Explicit disconnect | `XrayClient.disconnect()` | `disconnecting` → `disconnected` |
| Notification button | The foreground notification's Disconnect action | same |
| Successful reconnect | `XrayClient.connect(...)` succeeds | `connecting` → `connected` |
| Failed reconnect | Retry fails, hold still valid | `connecting` → `blocked` |
| System revoke | User enables another VPN, or kills yours in Settings | `disconnected`, message `VPN revoked by system` |
| Service destroyed | Task swipe / system kill | `disconnected` |

The hold is **deliberately not timed out**. Releasing on a timer would put the user's traffic back
on the open network, which is the one thing the kill switch exists to prevent. Offer both
Disconnect and a retry, and let the user choose.

### Traffic counters while held

`statsRaw()` returns zeros: the native side short-circuits when the engine is not running, and it
does not reject. `stats()` does not go to zero — entering `blocked` banks the previous engine
generation into the session baseline, so the session total holds its last value instead of
collapsing. If you drive a "traffic" widget off `stats()` it will simply stop growing, which is
the correct thing to show.

---

## 4. `isConnected()` vs `isEngineRunning()`

| | Means | True during a server switch | True during `blocked` |
|---|---|---|---|
| `isConnected()` | The tunnel **interface** is up — this app is capturing traffic | yes (Android never drops it) | yes |
| `isEngineRunning()` | The proxy **engine** is running behind it | briefly false | no |

`isConnected() && !isEngineRunning()` is how a reloaded JS context recovers `blocked`.

**It is not an instantaneous truth.** The same pair is briefly true while an engine is starting or
restarting, and for up to a couple of seconds after a system revoke. Only read it on cold start
and on foreground, never in a poll, and let the stream override it the moment an event arrives.

```ts
// Reconcile once, then trust the stream.
function reconcile() {
  if (!XrayClient.isConnected()) return setState('disconnected')
  setState(XrayClient.isEngineRunning() ? 'connected' : 'blocked')
}
```

On iOS `isEngineRunning()` is identical to `isConnected()`: the engine lives inside the Network
Extension and cannot outlive its tunnel.

---

## 5. What the API actually guarantees

**`await connect(server, options?)`**
- Android: resolves after the engine reported a successful start. `connected` has already been
  emitted by then.
- iOS: resolves once `startVPNTunnel()` returned. The extension may still fail afterwards.
- Neither platform promises that traffic flows. With olcrtc chained, `connected` fires while the
  WebRTC handshake is still running; wait for the `proxy-ready` sub-state on the `message`
  argument before telling the user the bypass is up.

**`await disconnect()`**
- Android: resolves when the tunnel is actually down and the notification is gone — or after a
  7-second timeout, or if a newer start superseded the stop. The slow parts (engine shutdown,
  olcrtc's WebRTC teardown) run after the resolve and nothing waits on them.
- Older versions resolved as soon as the stop intent was dispatched. If you wrote polling loops to
  work around that, delete them.

**Server switch (`connect()` while connected)**
- Android reuses the established tunnel when the DNS servers are unchanged: `establish()` is not
  called again, the interface and its routes are continuous, and the system VPN key icon never
  blinks. Verified on device.
- iOS restarts the Network Extension tunnel, so `isConnected()` briefly goes false.
- Traffic counters from `stats()` keep accumulating across a switch by design. Use `statsRaw()` if
  you want the raw per-engine counters that reset.

**Not guaranteed**
- That the state stream replays anything on subscribe.
- That a state you saw is still true — always reconcile after a JS reload.
- That `error` and `blocked` exist on iOS, or `reconnecting` on Android.

---

## 6. Common mistakes

**1. Polling flags instead of using the stream.** The flags are a reconcile mechanism, not an
event source, and some of them are transiently misleading during a start. Subscribe; reconcile
once on mount and on foreground.

**2. Calling `stopOlcrtc()` right after `disconnect()`.** The native teardown already stops
olcrtc. On Android your extra call is at best redundant and at worst serializes behind the WebRTC
shutdown; on iOS it is only needed if you want to clear the armed config so the next plain connect
does not carry it. Prefer passing the right `options.olcrtc` to `connect()` instead.

**3. Assuming a server switch tears the tunnel down.** On Android it does not, which is the point.
Do not reset your own UI state on `connecting` if the previous state was `connected` — you will
flash "disconnected" during a switch that never dropped.

**4. Assuming your JS lock covers everything.** `XrayClient` serializes its own calls, but the
Android notification's Disconnect button dispatches a stop straight to the service without
touching JS. Your UI must survive a disconnect it did not initiate — which is another reason to
drive state from the stream.

**5. Treating a resolved iOS `connect()` as success.** See §5.

**6. Ignoring the typed errors.** `XrayError` carries a stable `code` and a `retryable` flag.
Branch on the code, not on the message text, which differs across platforms.

---

## 7. Contributor invariants (Android service)

These are load-bearing. Each one was arrived at the hard way; do not undo them without reading the
reason.

**Teardown order is engine → descriptor and notification → olcrtc.** The descriptor cannot be
closed before the engine stops. xray-core's Android tun inbound is built on gvisor's `fdbased`
endpoint, which does **not** take ownership of the descriptor and keeps issuing `readv`/`writev`
on that raw fd *number* until the endpoint is detached. Close it first and the number goes back to
the process, so a wedged reader lands on somebody else's socket. (The repo's older note that "the
app owns the fd" answers who *closes* it, not when it stops being *used*.)

**The engine stop is bounded.** A tun reader that never wakes would otherwise turn into a
permanent VPN key icon with a dead network. On timeout the engine is marked wedged, later calls
fail fast with a real error instead of hanging, and the descriptor is parked on `/dev/null`
rather than closed — parking removes the interface while keeping the fd number out of circulation.

**Raw JNI bindings are private and lock-serialized.** The Go entry points mutate package-level
globals with no mutex on the Go side, and they are reachable from the service's workers, the
destroy path, and JS at the same time. Two locks, not one: the olcrtc start blocks for tens of
seconds and must never hold up an xray teardown.

**Synchronous readers must never block.** `version()`, `isBypassRunning()` and
`bypassSocksPort()` run on the JS thread. They use a cached value or a `tryLock`, because waiting
on the same lock as a multi-second WebRTC teardown freezes the UI for exactly that long.

**Commands carry a sequence, starts carry a token.** A queued command that is no longer the newest
must not touch the engine, and a stop must not settle a start promise that was armed after it.
Without the token, a stop queued behind a slow start rejects the promise of a *newer* start.

**`isRunning` tracks the interface, `isEngineRunning` tracks the engine.** Conflating them is what
produced the original bug: the flag was cleared while a tunnel was still established, so the app
reported "disconnected" over a live blackhole and offered Connect.
