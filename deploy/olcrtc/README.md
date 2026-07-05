# olcrtc server (docker compose)

The exit side of the WebRTC side-channel. The mobile app runs the olcrtc
**client** natively (`XrayClient.startOlcrtc`); this container is the **server**
it connects to. `carrier`, `transport`, `room`, and `key` must be identical on
both sides.

> olcrtc has no published Docker image, so this builds from source. The repo
> already ships `docker-compose.server.yml` / `docker-compose.client.yml` at its
> root — this folder is a trimmed, documented server setup with a `.env`.

## Run

```bash
# 1. Clone olcrtc source next to this file
git clone https://github.com/openlibrecommunity/olcrtc ./olcrtc

# 2. Configure
cp .env.example .env
#   edit .env: set OLCRTC_CARRIER, OLCRTC_ROOM_ID (leave OLCRTC_KEY empty)

# 3. Build + start
docker compose up -d --build

# 4. Grab the auto-generated key from the logs
docker compose logs | grep OLCRTC_KEY
#   -> OLCRTC_KEY=<64 hex chars>
```

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
