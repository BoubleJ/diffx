import { parseVersion } from './version.js'

export const LATEST_RELEASE_URL = 'https://api.github.com/repos/BoubleJ/diffx/releases/latest'
const NOTES_LIMIT = 1500

export type LatestRelease =
  | { kind: 'release'; version: string; notes: string; zipUrl: string | null }
  | { kind: 'none' }
  | { kind: 'error'; message: string }

interface ReleaseAsset {
  name?: unknown
  browser_download_url?: unknown
}

interface ReleaseResponse {
  tag_name?: unknown
  body?: unknown
  assets?: unknown
}

export async function fetchLatestRelease(fetchFn: typeof fetch = fetch, timeoutMs = 10_000): Promise<LatestRelease> {
  try {
    const res = await fetchFn(LATEST_RELEASE_URL, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'reviewHelper' },
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (res.status === 404) return { kind: 'none' }
    if (!res.ok) return { kind: 'error', message: `GitHub 응답 ${res.status}` }
    const data = (await res.json()) as ReleaseResponse
    const tag = typeof data.tag_name === 'string' ? data.tag_name : ''
    if (!parseVersion(tag)) return { kind: 'error', message: `태그 형식이 올바르지 않습니다: ${tag}` }
    const version = tag.replace(/^v/, '')
    const assets: ReleaseAsset[] = Array.isArray(data.assets) ? data.assets : []
    const zip = assets.find((asset) => asset?.name === `reviewHelper-${version}.zip`)
    return {
      kind: 'release',
      version,
      notes: typeof data.body === 'string' ? data.body : '',
      zipUrl: typeof zip?.browser_download_url === 'string' ? zip.browser_download_url : null,
    }
  } catch (err) {
    return { kind: 'error', message: (err as Error).message }
  }
}

export function releaseDetail(current: string, notes: string): string {
  const trimmed = notes.trim()
  const header = `현재 버전: ${current}`
  if (!trimmed) return header
  const body = trimmed.length > NOTES_LIMIT ? `${trimmed.slice(0, NOTES_LIMIT)}...` : trimmed
  return `${header}\n\n${body}`
}
