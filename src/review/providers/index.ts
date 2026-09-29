import type { ReviewProvider } from '../types.js'
import { claudeProvider } from './claude.js'

export const PROVIDERS: ReviewProvider[] = [claudeProvider]

export function getProvider(id: string): ReviewProvider | undefined {
  return PROVIDERS.find((p) => p.id === id)
}
