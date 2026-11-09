# Hysteria2

`parseShareLink` and `parseSubscription` accept `hysteria2://` and `hy2://` links.
The resulting `ParsedServer` uses `protocol: 'hysteria2'`, `network: 'hysteria'`
and `security: 'tls'`. `XrayClient.connect` uses the existing native Xray core.

```ts
const server = parseShareLink(
  'hy2://auth@example.com:443/?sni=example.com#Hysteria2'
)
if (server) await XrayClient.connect(server)
```

Omitted ports default to 443. Bracketed IPv6 and percent-encoded authentication
are supported. `obfs=salamander&obfs-password=...` enables packet obfuscation.
TLS verification stays enabled. The shipped core does not support disabling
verification; links with `insecure=1` or `insecure=true` return `null`.
Use certificates trusted by the system CA store.

Fixed ports are supported; port hopping and `pinSHA256` links return `null`
instead of silently dropping those policies. Unknown obfuscation modes also
return `null`. Hysteria v1 is not supported by these share-link parsers.

The server must be reachable over UDP. Chaining through SOCKS requires a relay
that implements UDP ASSOCIATE; verify that capability before using olcrtc chaining.
