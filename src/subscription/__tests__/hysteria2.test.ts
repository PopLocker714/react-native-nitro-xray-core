import { describe, expect, test } from 'bun:test'
import { parseShareLink, parseSubscription } from '../parse'
import { buildXrayConfig } from '../../config/build'

describe('Hysteria2 share links', () => {
  test('builds the Xray v2 UDP transport from a Remnawave-style link', () => {
    const uri =
      'hysteria2://user%3Asecret@203.0.113.7:15448/' +
      '?sni=h2.example.com&obfs=salamander&obfs-password=packet%26secret#Private%20Hysteria2'
    const server = parseShareLink(uri)
    expect(server).toMatchObject({
      protocol: 'hysteria2',
      tag: 'Private Hysteria2',
      address: '203.0.113.7',
      port: 15448,
      password: 'user:secret',
      network: 'hysteria',
      security: 'tls',
      sni: 'h2.example.com',
      obfsPassword: 'packet&secret',
    })
    if (!server) throw new Error('Expected Hysteria2 server')
    const config = buildXrayConfig(server)
    expect(config.outbounds).toContainEqual({
      tag: 'proxy',
      protocol: 'hysteria',
      settings: { address: '203.0.113.7', port: 15448, version: 2 },
      streamSettings: {
        network: 'hysteria',
        security: 'tls',
        tlsSettings: {
          serverName: 'h2.example.com',
          alpn: ['h3'],
        },
        hysteriaSettings: { version: 2, auth: 'user:secret' },
        finalmask: {
          udp: [
            { type: 'salamander', settings: { password: 'packet&secret' } },
          ],
        },
      },
    })
  })

  test('accepts hy2 alias, default port and bracketed IPv6', () => {
    expect(
      parseShareLink('hy2://auth@[2001:db8::1]/?sni=example.com')
    ).toMatchObject({
      protocol: 'hysteria2',
      address: '2001:db8::1',
      port: 443,
    })
    expect(parseShareLink('hy2://auth@example.com')).toMatchObject({
      port: 443,
    })
  })

  test('keeps TLS verification and omits absent obfuscation', () => {
    const server = parseShareLink('hy2://auth@example.com?insecure=0')
    if (!server) throw new Error('Expected Hysteria2 server')
    const config = JSON.stringify(buildXrayConfig(server))
    expect(config).not.toContain('allowInsecure')
    expect(config).not.toContain('finalmask')
  })

  test.each([
    'hy2://example.com:443',
    'hy2://auth@example.com:0',
    'hy2://auth@example.com:65536',
    'hy2://auth@example.com:443oops',
    'hy2://auth@example.com:abc',
    'hy2://auth@example.com:443,8443',
    'hy2://auth@example.com?obfs=unknown',
    'hy2://auth@example.com?obfs=salamander',
    'hy2://auth@example.com?insecure=invalid',
    'hy2://auth@example.com?insecure=1',
    'hy2://auth@example.com?insecure=true',
    'hy2://auth@example.com?pinSHA256=unsupported-pin',
    'hy2://auth@example.com?pinSHA256=',
    'hy2://auth@example.com?pinSHA256=unsupported-pin&pinSHA256=',
    'hy2://auth@example.com?mport=443-8443',
    'hy2://auth@example.com?mport=',
    'hy2://auth@example.com?mport=443-8443&mport=',
  ])('rejects unsupported or malformed URI %s', (uri) => {
    expect(parseShareLink(uri)).toBeNull()
  })

  test('retains old protocols in a base64 mixed subscription', () => {
    const text =
      'vless://id@example.com:443?type=grpc#old\n' +
      'hy2://secret@example.com:8443#new\nhysteria://legacy@example.com:443'
    expect(
      parseSubscription(Buffer.from(text).toString('base64')).map(
        (s) => s.protocol
      )
    ).toEqual(['vless', 'hysteria2'])
  })
})
