import { describe, expect, it } from 'bun:test'
import { pseudoVersionIdentity, xrayDisplayVersion } from '../parse'
import { CORE_VERSIONS } from '../../generated/core-versions'

describe('xrayDisplayVersion', () => {
  it('maps the pinned module version to what core.Version() reports', () => {
    // XTLS/Xray-core@v1.260327.0 core/core.go: Version_x/y/z = 26/3/27
    expect(xrayDisplayVersion('v1.260327.0')).toBe('26.3.27')
  })

  it('strips leading zeros from month and day', () => {
    expect(xrayDisplayVersion('v1.260105.0')).toBe('26.1.5')
  })

  it('accepts a non-zero patch component', () => {
    expect(xrayDisplayVersion('v1.260327.1')).toBe('26.3.27')
  })

  it('returns null for a plain semver tag rather than inventing a date', () => {
    expect(xrayDisplayVersion('v1.8.24')).toBeNull()
  })

  it('returns null for junk', () => {
    expect(xrayDisplayVersion('')).toBeNull()
    expect(xrayDisplayVersion('v1.26032.0')).toBeNull()
    expect(xrayDisplayVersion('1.260327.0')).toBeNull()
  })
})

describe('pseudoVersionIdentity', () => {
  it('splits the pinned olcrtc pseudo-version into commit and date', () => {
    expect(pseudoVersionIdentity('v0.0.0-20260704192300-1255cf8248ee')).toEqual({
      commit: '1255cf8',
      date: '2026-07-04',
    })
  })

  it('handles the base-version form of a pseudo-version', () => {
    expect(pseudoVersionIdentity('v1.2.3-0.20260101000000-abcdef123456')).toEqual({
      commit: 'abcdef1',
      date: '2026-01-01',
    })
  })

  it('passes a real tag through untouched with no date', () => {
    expect(pseudoVersionIdentity('v0.0.1')).toEqual({ commit: 'v0.0.1', date: '' })
  })
})

describe('CORE_VERSIONS', () => {
  it('is populated for every field the UI renders', () => {
    for (const key of ['xray', 'xrayModule', 'olcrtc', 'olcrtcModule', 'olcrtcDate'] as const) {
      expect(CORE_VERSIONS[key]).toBeTruthy()
    }
  })

  it('stays internally consistent — derived fields match their module versions', () => {
    expect(CORE_VERSIONS.xray).toBe(
      xrayDisplayVersion(CORE_VERSIONS.xrayModule) ?? CORE_VERSIONS.xrayModule
    )
    const olcrtc = pseudoVersionIdentity(CORE_VERSIONS.olcrtcModule)
    expect(CORE_VERSIONS.olcrtc).toBe(olcrtc.commit)
    expect(CORE_VERSIONS.olcrtcDate).toBe(olcrtc.date)
  })
})

describe('xrayDisplayVersion — pseudo-versions', () => {
  it('derives the release name from a pseudo-version commit date', () => {
    // XTLS tags no v1.YYMMDD.0 companion for prereleases, so any pin past the
    // last stable release is a pseudo-version. 20260728 -> the 26.7.28 release.
    expect(
      xrayDisplayVersion('v1.260327.1-0.20260728075948-5ca6f4b7d4dc')
    ).toBe('26.7.28')
  })

  it('still prefers a real tag when one exists', () => {
    expect(xrayDisplayVersion('v1.260327.0')).toBe('26.3.27')
  })

  it('returns null for a shape it does not understand', () => {
    expect(xrayDisplayVersion('v2.0.0')).toBeNull()
    expect(xrayDisplayVersion('garbage')).toBeNull()
  })
})
