/**
 * Pure parsers for the Go module versions embedded in the shipped native
 * artifacts. Used at build time by `scripts/gen-core-versions.ts`; kept here
 * (not in the script) so they are unit-testable without touching 200 MB of
 * binaries.
 */

/**
 * `v1.260327.0` -> `26.3.27`.
 *
 * XTLS dual-tags every release: the Go module version is `v1.YYMMDD.0` while
 * `core.Version()` is built from `Version_x/y/z = YY/M/D` — verified against
 * XTLS/Xray-core@v1.260327.0 `core/core.go`, which pins 26/3/27. Matching that
 * shape means the version shown before the engine is reachable looks the same
 * as the one shown after.
 *
 * Returns null for any other shape: an honest module version beats a
 * confidently wrong pretty one.
 */
export function xrayDisplayVersion(moduleVersion: string): string | null {
  const tagged = /^v1\.(\d{2})(\d{2})(\d{2})\.\d+$/.exec(moduleVersion)
  if (tagged) {
    const [, yy, mm, dd] = tagged as unknown as [string, string, string, string]
    return `${Number(yy)}.${Number(mm)}.${Number(dd)}`
  }

  // Pseudo-version, e.g. v1.260327.1-0.20260728075948-5ca6f4b7d4dc.
  //
  // XTLS only mints the `v1.YYMMDD.0` companion tag for STABLE releases, so any
  // pin newer than the last stable one is necessarily a pseudo-version on an
  // untagged commit. Its embedded timestamp is the commit date, and XTLS cuts a
  // release the same day it tags — so `20260728` is the `26.7.28` release. That
  // is a convention, not a guarantee: if upstream ever commits on a day it does
  // not release, this shows the commit date instead of a release name. Better
  // than rendering a forty-character blob in a settings screen, and the runtime
  // value from the engine takes precedence anyway wherever it is available.
  const pseudo = /[-.](\d{4})(\d{2})(\d{2})\d{6}-[0-9a-f]{12}$/.exec(moduleVersion)
  if (pseudo) {
    const [, yyyy, mm, dd] = pseudo as unknown as [string, string, string, string]
    return `${Number(yyyy) % 100}.${Number(mm)}.${Number(dd)}`
  }

  return null
}

/** Commit identity behind a Go pseudo-version. */
export interface PseudoVersionIdentity {
  /** Short commit hash, or the raw input when it is not a pseudo-version. */
  commit: string
  /** Commit date as `YYYY-MM-DD`, or '' when the input is not a pseudo-version. */
  date: string
}

/**
 * `v0.0.0-20260704192300-1255cf8248ee` -> `{ commit: '1255cf8', date: '2026-07-04' }`.
 *
 * olcrtc publishes no usable tag (its single tag `v0.0.1` is not what is
 * pinned), so the commit is the only honest identifier for the protocol build.
 *
 * Go builds pseudo-versions in three shapes, and the separator before the
 * timestamp is a dot when there is a base tag (`v1.2.3-0.<ts>-<sha>`) but a
 * dash when there is none (`v0.0.0-<ts>-<sha>`) — both are accepted.
 */
export function pseudoVersionIdentity(moduleVersion: string): PseudoVersionIdentity {
  const m = /[-.](\d{4})(\d{2})(\d{2})\d{6}-([0-9a-f]{12})$/.exec(moduleVersion)
  if (!m) return { commit: moduleVersion, date: '' }
  const [, y, mo, d, sha] = m as unknown as [string, string, string, string, string]
  return { commit: sha.slice(0, 7), date: `${y}-${mo}-${d}` }
}
