import { describe, expect, it } from 'bun:test'
import { buildXrayConfig } from '../build'
import type { ParsedServer } from '../../subscription/types'

const VLESS_REALITY: ParsedServer = {
  protocol: 'vless',
  tag: 'srv',
  address: 'example.com',
  port: 443,
  id: '11111111-2222-3333-4444-555555555555',
  encryption: 'none',
  flow: 'xtls-rprx-vision',
  network: 'tcp',
  security: 'reality',
  sni: 'www.microsoft.com',
  fingerprint: 'chrome',
  publicKey: 'PUBKEY',
  shortId: 'abcd',
  raw: 'vless://...',
}

type Outbound = {
  tag?: string
  protocol?: string
  settings?: Record<string, unknown>
  streamSettings?: Record<string, unknown>
}

function outbounds(config: Record<string, unknown>): Outbound[] {
  return config.outbounds as Outbound[]
}

function byTag(config: Record<string, unknown>, tag: string): Outbound | undefined {
  return outbounds(config).find((o) => o.tag === tag)
}

describe('buildXrayConfig — olcrtc chaining', () => {
  it('adds no sockopt and no socks outbound when olcrtc is absent', () => {
    const config = buildXrayConfig(VLESS_REALITY)
    const proxy = byTag(config, 'proxy')!
    expect(proxy.streamSettings).not.toHaveProperty('sockopt')
    expect(byTag(config, 'olcrtc-out')).toBeUndefined()
  })

  it('sets dialerProxy on the proxy outbound when olcrtc is present', () => {
    const config = buildXrayConfig(VLESS_REALITY, { olcrtc: { socksPort: 10808 } })
    const proxy = byTag(config, 'proxy')!
    expect(proxy.streamSettings!.sockopt).toEqual({ dialerProxy: 'olcrtc-out' })
  })

  it('appends a socks outbound targeting the olcrtc local listener', () => {
    const config = buildXrayConfig(VLESS_REALITY, { olcrtc: { socksPort: 10808 } })
    const hop = byTag(config, 'olcrtc-out')!
    expect(hop.protocol).toBe('socks')
    expect(hop.settings).toEqual({
      servers: [{ address: '127.0.0.1', port: 10808 }],
    })
  })

  it('honors a custom socksHost and tag, wiring dialerProxy to the same tag', () => {
    const config = buildXrayConfig(VLESS_REALITY, {
      olcrtc: { socksPort: 1080, socksHost: '10.0.0.2', tag: 'bypass' },
    })
    const proxy = byTag(config, 'proxy')!
    expect(proxy.streamSettings!.sockopt).toEqual({ dialerProxy: 'bypass' })
    const hop = byTag(config, 'bypass')!
    expect(hop.settings).toEqual({
      servers: [{ address: '10.0.0.2', port: 1080 }],
    })
    // Only one extra outbound is added.
    expect(byTag(config, 'olcrtc-out')).toBeUndefined()
  })

  it('dialerProxy tag resolves to an existing outbound (no dangling reference)', () => {
    const config = buildXrayConfig(VLESS_REALITY, { olcrtc: { socksPort: 10808 } })
    const proxy = byTag(config, 'proxy')!
    const referenced = (proxy.streamSettings!.sockopt as { dialerProxy: string })
      .dialerProxy
    expect(byTag(config, referenced)).toBeDefined()
  })

  it('respects a custom proxyTag while still chaining through olcrtc', () => {
    const config = buildXrayConfig(VLESS_REALITY, {
      proxyTag: 'main',
      olcrtc: { socksPort: 10808 },
    })
    const proxy = byTag(config, 'main')!
    expect(proxy.streamSettings!.sockopt).toEqual({ dialerProxy: 'olcrtc-out' })
  })
})
