# olcrtc server (docker compose)

The exit side of the WebRTC side-channel. The mobile app runs the olcrtc
**client** natively (`XrayClient.startOlcrtc`); this container is the **server**
it connects to. `carrier`, `transport`, `room`, and `key` must be identical on
both sides.

> **There is no official olcrtc image, and the canonical repo has no Dockerfile.**
> Verified 2026-07-05: nothing on Docker Hub / GHCR, CI has no image-push job, and
> `openlibrecommunity/olcrtc` (where the mobile client is pinned) removed its
> Docker files upstream. The Docker infra survives only in the `alananisimov`
> fork at commit `24ca5b3`, which this compose builds from via a remote git
> context — Dokploy builds it straight from GitHub, no local clone.
>
> ⚠️ **Version skew:** that fork commit is ~207 commits behind the canonical
> repo the mobile client links. For guaranteed protocol compatibility, pin the
> mobile client's `go-core/go.mod` olcrtc dependency to the SAME commit
> `24ca5b354c3e7215c937d966c26b2526411e3043` and rebuild. Verified locally: the
> image builds (207 MB) and the server boots, generates a key, and reaches the
> carrier.

## Run (Dokploy or plain compose)

```bash
# 1. Configure
cp .env.example .env
#   edit .env: set OLCRTC_CARRIER, OLCRTC_ROOM_ID (leave OLCRTC_KEY empty)

# 2. Build (from GitHub, no local clone) + start
docker compose up -d --build

# 3. Grab the auto-generated key from the logs
docker compose logs | grep OLCRTC_KEY
#   -> OLCRTC_KEY=<64 hex chars>
```

### On Dokploy

Two equivalent ways, both without a published image:

1. **Compose service** (this file) — paste it / point Dokploy at this repo path.
   The `build.context: https://github.com/openlibrecommunity/olcrtc.git#master`
   makes Dokploy build from GitHub. Set the env vars from `.env.example` in the
   Dokploy service's Environment tab.
2. **Application** — new Dokploy *Application*, Source = the GitHub repo
   `openlibrecommunity/olcrtc`, Build Type = **Dockerfile**, and add the same
   env vars. No compose needed; Dokploy clones and builds the Dockerfile.

If you'd rather pull an image than build, the only way is to publish one
yourself (build the Dockerfile, push to your GHCR/registry, then swap the
`build:` block for `image: <your-registry>/olcrtc:<tag>`).

## Pair the mobile client

Put the same four values into the client config, then chain xray through it:

```ts
await XrayClient.startOlcrtc({
  carrier: 'wbstream',            // = OLCRTC_CARRIER
  roomId:  '<room-id>',           // = OLCRTC_ROOM_ID
  clientId:'mobile-1',            // any device identifier
  keyHex:  '<64 hex from logs>',  // = OLCRTC_KEY
  transport: 'vp8channel',        // = OLCRTC_TRANSPORT (must match)
})

const port = XrayClient.getOlcrtcSocksPort()
await XrayClient.connect(server, { olcrtc: { socksPort: port } })
```

## Notes

- **Transport must match.** The native client defaults to `vp8channel`; `.env`
  defaults to the same. If you change one, change both.
- **Key.** Auto-generated on first `srv` run and persisted in the
  `olcrtc-state` volume. To rotate, clear the volume or set `OLCRTC_KEY`.
- **Room.** Create it on the carrier's site first (e.g. stream.wb.ru for
  wbstream) and use its ID/URL.
- The server needs outbound network to both the carrier's WebRTC service and
  wherever it egresses (your xray/VLESS server).
- olcrtc is early beta — WebRTC DataChannel throughput is limited; treat this as
  the optional RF-mobile bypass path, not the default route.
```
