import type { ResolvedComparison } from '../comparison.js'

export function fingerprint(resolved: ResolvedComparison): string {
  return `${resolved.sourceSha}:${resolved.targetSha}`
}
