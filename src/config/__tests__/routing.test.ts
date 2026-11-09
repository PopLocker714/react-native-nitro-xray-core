import { describe, expect, test } from 'bun:test'
import { buildOlcrtcTunnelConfig, buildXrayConfig } from '../build'
import { parseShareLink } from '../../subscription/parse'

describe('opt-in direct domain routing', () => {
  for (const uri of [
    'vless://11111111-2222-3333-4444-555555555555@example.com:443?type=grpc',
    'vless://11111111-2222-3333-4444-555555555555@example.com:443?type=xhttp',
    'hy2://test@example.com:443?sni=example.com',
  ]) {
    test(`adds domain rule ahead of the tunnel catchall: ${uri.split('?')[1]}`, () => {
      const server = parseShareLink(uri)!
      const config = buildXrayConfig(server, { directDomains: ['SBER.RU', 'sber.ru'] }) as any
      expect(config.routing.rules[2]).toEqual({ type: 'field', domain: ['domain:sber.ru'], outboundTag: 'direct' })
      expect(config.routing.rules[3]).toMatchObject({ inboundTag: ['tun-in'], outboundTag: 'proxy' })
      expect((buildXrayConfig(server) as any).routing.rules).toHaveLength(3)
    })
  }
  test('olcrtc remains unchanged unless explicitly opted in', () => {
    expect((buildOlcrtcTunnelConfig({ socksPort: 1080 }) as any).routing.rules).toHaveLength(3)
    expect((buildOlcrtcTunnelConfig({ socksPort: 1080, directDomains: ['gosuslugi.ru'] }) as any).routing.rules[2].domain).toEqual(['domain:gosuslugi.ru'])
  })
  test.each(['', '.ru', 'a..ru', 'domain:ru', 'a.ru/path', 'a.ru\n', '-a.ru', 'a'.repeat(64) + '.ru'])(
    'rejects malformed or special syntax suffix %j', (domain) => {
      expect(() => buildOlcrtcTunnelConfig({ socksPort: 1080, directDomains: [domain] })).toThrow('Invalid direct domain suffix')
    },
  )
})
