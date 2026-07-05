# olcrtc server (prebuilt image → Dokploy pull)

The exit side of the WebRTC side-channel. The mobile app runs the olcrtc
**client** natively (`XrayClient.startOlcrtc`); this container is the **server**
it pairs with. `carrier`, `transport`, `room`, and `key` must be identical on
both sides.

> **No official olcrtc image exists** (verified: nothing on Docker Hub / GHCR,
> CI has no publish job), and the canonical repo has no Dockerfile. So this
> folder ships its own `Dockerfile` that builds **canonical olcrtc pinned to the
> same commit the mobile client links** (`1255cf8`) — server and client share
> the protocol. The `Dockerfile` vendors the entrypoint/healthcheck (the config
> schema is identical to the old fork's, verified).

## Why prebuilt (don't build on the deploy server)

The build is a full Go compile of pion/webrtc + olcrtc — too heavy for a small
VPS. So **build once on a dev box, push to your registry, and Dokploy just
pulls.** No compilation on the server.

## 1. Build + push (dev box, one time)

Build **multi-arch** — Dokploy servers are usually `linux/amd64`; a Mac-only
build is `linux/arm64` and the server errors with `no matching manifest for
linux/amd64`. One-time emulator setup, then buildx:

```bash
docker run --privileged --rm tonistiigi/binfmt --install all   # once (adds amd64/rosetta)
docker buildx create --name olcrtc-multi --driver docker-container --use   # once
docker login

docker buildx build --builder olcrtc-multi \
  --platform linux/amd64,linux/arm64 \
  -t <YOUR_DOCKERHUB_USER>/olcrtc:latest \
  --push deploy/olcrtc
```

Verified: multi-arch manifest (amd64 + arm64) pushed, `docker pull --platform
linux/amd64` succeeds, and the amd64 image boots, generates a key, and connects
to the carrier.

> **jitsi gotcha:** the public `meet.jit.si` now requires a JWT (`token
> required`) — the anonymous guest flow olcrtc uses is rejected there. Use a
> **self-hosted Jitsi** with anonymous access enabled (jitsi's default), or a
> jitsi server that allows guests, or set `OLCRTC_...` auth token. If you'd
> rather not run Jitsi, switch to `wbstream`/`telemost` with `vp8channel`
> (datachannel doesn't work on those).

## 2. Deploy on Dokploy (pull-only)

Point Dokploy at this compose (or paste it). Set these in the service's
Environment / `.env`:

```
OLCRTC_IMAGE=<YOUR_DOCKERHUB_USER>/olcrtc:latest
OLCRTC_CARRIER=wbstream
OLCRTC_TRANSPORT=vp8channel
OLCRTC_ROOM_ID=<room-id>
# OLCRTC_KEY left empty → auto-generated on first run, printed to logs
```

Dokploy pulls the image and runs it — no build step. Grab the generated key:

```bash
docker compose logs | grep OLCRTC_KEY   # -> OLCRTC_KEY=<64 hex chars>
```

## 3. Pair the mobile client

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

- **Transport must match** on both sides (native client defaults to vp8channel).
- **Rebuild** only when bumping the olcrtc version: change `OLCRTC_REF` in the
  `Dockerfile` (keep it equal to the client's `go-core/go.mod` olcrtc commit),
  rebuild, push, and `docker compose pull && up -d` on Dokploy.
- **Room** must be created on the carrier's site first (e.g. stream.wb.ru).
- olcrtc is early beta — treat this as the optional RF-mobile bypass path.
