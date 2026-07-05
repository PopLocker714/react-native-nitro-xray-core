import { describe, expect, test } from 'bun:test'
import { base64ToString } from '../base64'
import { parseShareLink, parseSubscription } from '../parse'
import { buildXrayConfig } from '../../config/build'

describe('vless', () => {
  test('parses reality tcp vision link', () => {
    const uri =
      'vless://11111111-2222-3333-4444-555555555555@example.com:443' +
      '?type=tcp&security=reality&sni=www.microsoft.com&fp=chrome' +
      '&pbk=PUBKEY123&sid=ab12&flow=xtls-rprx-vision#My%20Server'
    const s = parseShareLink(uri)
    expect(s).not.toBeNull()
    expect(s!.protocol).toBe('vless')
    expect(s!.tag).toBe('My Server')
    expect(s!.address).toBe('example.com')
    expect(s!.port).toBe(443)
    expect(s!.id).toBe('11111111-2222-3333-4444-555555555555')
    expect(s!.security).toBe('reality')
    expect(s!.network).toBe('tcp')
    expect(s!.sni).toBe('www.microsoft.com')
    expect(s!.publicKey).toBe('PUBKEY123')
    expect(s!.shortId).toBe('ab12')
    expect(s!.flow).toBe('xtls-rprx-vision')
    expect(s!.encryption).toBe('none')
  })

  test('parses ws+tls link with host/path', () => {
    const uri =
      'vless://uuid-here@1.2.3.4:8443?type=ws&security=tls' +
      '&sni=cdn.example.com&host=cdn.example.com&path=%2Fwspath#ws-node'
    const s = parseShareLink(uri)!
    expect(s.network).toBe('ws')
    expect(s.security).toBe('tls')
    expect(s.path).toBe('/wspath')
    expect(s.host).toBe('cdn.example.com')
  })

  test('parses grpc link', () => {
    const uri =
      'vless://uuid@host.tld:443?type=grpc&security=tls&serviceName=mygrpc#g'
    const s = parseShareLink(uri)!
    expect(s.network).toBe('grpc')
    expect(s.serviceName).toBe('mygrpc')
  })
})

describe('trojan', () => {
  test('parses trojan link, defaults to tls', () => {
    const s = parseShareLink('trojan://pass123@host.tld:443#trj')!
    expect(s.protocol).toBe('trojan')
    expect(s.password).toBe('pass123')
    expect(s.security).toBe('tls')
    expect(s.port).toBe(443)
  })
})

describe('vmess', () => {
  test('parses base64 json ws link', () => {
    const json = {
      v: '2',
      ps: 'vmess-node',
      add: 'v.example.com',
      port: '443',
      id: 'abcd-1234',
      aid: '0',
      scy: 'auto',
      net: 'ws',
      type: 'none',
      host: 'v.example.com',
      path: '/vm',
      tls: 'tls',
      sni: 'v.example.com',
    }
    const uri = 'vmess://' + Buffer.from(JSON.stringify(json)).toString('base64')
    const s = parseShareLink(uri)!
    expect(s.protocol).toBe('vmess')
    expect(s.tag).toBe('vmess-node')
    expect(s.address).toBe('v.example.com')
    expect(s.port).toBe(443)
    expect(s.network).toBe('ws')
    expect(s.security).toBe('tls')
    expect(s.path).toBe('/vm')
    expect(s.alterId).toBe(0)
  })
})

describe('shadowsocks', () => {
  test('parses SIP002 form', () => {
    const userinfo = Buffer.from('aes-256-gcm:secretpass').toString('base64')
    const uri = `ss://${userinfo}@ss.example.com:8388#ss-node`
    const s = parseShareLink(uri)!
    expect(s.protocol).toBe('shadowsocks')
    expect(s.method).toBe('aes-256-gcm')
    expect(s.password).toBe('secretpass')
    expect(s.address).toBe('ss.example.com')
    expect(s.port).toBe(8388)
  })

  test('parses legacy base64 form', () => {
    const whole = Buffer.from('aes-128-gcm:pw@1.2.3.4:8388').toString('base64')
    const s = parseShareLink(`ss://${whole}#legacy`)!
    expect(s.method).toBe('aes-128-gcm')
    expect(s.password).toBe('pw')
    expect(s.address).toBe('1.2.3.4')
    expect(s.port).toBe(8388)
  })
})

describe('robustness', () => {
  test('returns null for unknown scheme', () => {
    expect(parseShareLink('http://example.com')).toBeNull()
  })

  test('returns null for garbage', () => {
    expect(parseShareLink('not a link')).toBeNull()
  })

  test('ipv6 host', () => {
    const s = parseShareLink('vless://uuid@[2606:4700::1111]:443?type=tcp#v6')!
    expect(s.address).toBe('2606:4700::1111')
    expect(s.port).toBe(443)
  })
})

describe('parseSubscription', () => {
  const links = [
    'vless://uuid1@a.com:443?type=tcp&security=reality&pbk=k#A',
    'trojan://pw@b.com:443#B',
    'ss://' + Buffer.from('aes-256-gcm:p').toString('base64') + '@c.com:8388#C',
  ].join('\n')

  test('parses raw newline list', () => {
    const servers = parseSubscription(links)
    expect(servers).toHaveLength(3)
    expect(servers.map((s) => s.protocol)).toEqual([
      'vless',
      'trojan',
      'shadowsocks',
    ])
  })

  test('parses base64-wrapped subscription', () => {
    const b64 = Buffer.from(links).toString('base64')
    const servers = parseSubscription(b64)
    expect(servers).toHaveLength(3)
  })

  test('skips unparseable lines', () => {
    const mixed = 'garbage\n' + links + '\nhttp://nope'
    expect(parseSubscription(mixed)).toHaveLength(3)
  })
})

describe('base64 utf-8', () => {
  test('decodes non-ascii names', () => {
    const b64 = Buffer.from('Привет 🚀', 'utf-8').toString('base64')
    expect(base64ToString(b64)).toBe('Привет 🚀')
  })
})

describe('buildXrayConfig', () => {
  test('vless reality → valid outbound + routing', () => {
    const s = parseShareLink(
      'vless://uuid@ex.com:443?type=tcp&security=reality&sni=microsoft.com&pbk=PK&sid=00&flow=xtls-rprx-vision#n'
    )!
    const cfg = buildXrayConfig(s) as any
    const outbound = cfg.outbounds[0]
    expect(outbound.tag).toBe('proxy')
    expect(outbound.protocol).toBe('vless')
    expect(outbound.settings.vnext[0].users[0].id).toBe('uuid')
    expect(outbound.settings.vnext[0].users[0].flow).toBe('xtls-rprx-vision')
    expect(outbound.streamSettings.security).toBe('reality')
    expect(outbound.streamSettings.realitySettings.publicKey).toBe('PK')
    expect(outbound.streamSettings.realitySettings.serverName).toBe('microsoft.com')
    // stats enabled by default
    expect(cfg.stats).toBeDefined()
    expect(cfg.policy).toBeDefined()
    // routing points tun → proxy
    const rule = cfg.routing.rules.find((r: any) => r.inboundTag)
    expect(rule.outboundTag).toBe('proxy')
  })

  test('ws vless emits wsSettings with host header', () => {
    const s = parseShareLink(
      'vless://uuid@ex.com:8443?type=ws&security=tls&host=h.com&path=%2Fp#n'
    )!
    const cfg = buildXrayConfig(s) as any
    const ws = cfg.outbounds[0].streamSettings.wsSettings
    expect(ws.path).toBe('/p')
    expect(ws.headers.Host).toBe('h.com')
  })

  test('trojan builds servers[] settings', () => {
    const s = parseShareLink('trojan://pw@ex.com:443#n')!
    const cfg = buildXrayConfig(s) as any
    expect(cfg.outbounds[0].protocol).toBe('trojan')
    expect(cfg.outbounds[0].settings.servers[0].password).toBe('pw')
  })

  test('respects custom proxyTag and dns', () => {
    const s = parseShareLink('trojan://pw@ex.com:443#n')!
    const cfg = buildXrayConfig(s, { proxyTag: 'vpn', dns: ['9.9.9.9'] }) as any
    expect(cfg.outbounds[0].tag).toBe('vpn')
    expect(cfg.dns.servers).toEqual(['9.9.9.9'])
    const rule = cfg.routing.rules.find((r: any) => r.inboundTag)
    expect(rule.outboundTag).toBe('vpn')
  })
})
