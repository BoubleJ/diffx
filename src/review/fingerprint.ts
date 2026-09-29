import { createHash } from 'node:crypto'
import type { ResolvedComparison } from '../comparison.js'

export function fingerprint(resolved: ResolvedComparison): string {
  if (resolved.mode === 'branch') return `${resolved.sourceSha}:${resolved.targetSha}`
  return createHash('sha1').update(resolved.patch).digest('hex')
}
