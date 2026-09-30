import { describe, it, expect, vi } from 'vitest'
import { fetchLatestRelease, LATEST_RELEASE_URL, releaseDetail } from './github'

const respond = (body: unknown, status = 200) =>
  vi.fn(async () => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status })) as unknown as typeof fetch

const zipAsset = (version: string) => ({
  name: `reviewHelper-${version}.zip`,
  browser_download_url: `https://github.com/BoubleJ/diffx/releases/download/v${version}/reviewHelper-${version}.zip`,
})

describe('fetchLatestRelease', () => {
  it('requests the latest release with GitHub headers', async () => {
    const fetchFn = respond({ tag_name: 'v1.0.1', body: '', assets: [] })
    await fetchLatestRelease(fetchFn)
    const [url, init] = (fetchFn as unknown as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(url).toBe(LATEST_RELEASE_URL)
    expect(init.headers).toEqual({ Accept: 'application/vnd.github+json', 'User-Agent': 'reviewHelper' })
  })

  it('returns the version without v, the notes and the matching zip url', async () => {
    const result = await fetchLatestRelease(respond({
      tag_name: 'v1.0.1',
      body: '- 표 렌더링 수정',
      assets: [{ name: 'reviewHelper-1.0.1.zip.blockmap', browser_download_url: 'x' }, zipAsset('1.0.1')],
    }))
    expect(result).toEqual({ kind: 'release', version: '1.0.1', notes: '- 표 렌더링 수정', zipUrl: zipAsset('1.0.1').browser_download_url })
  })

  it('returns a null zip url when the release has no matching zip', async () => {
    const result = await fetchLatestRelease(respond({ tag_name: 'v1.0.1', body: '', assets: [zipAsset('1.0.0')] }))
    expect(result).toMatchObject({ kind: 'release', zipUrl: null })
  })

  it('treats a missing assets list as no zip', async () => {
    const result = await fetchLatestRelease(respond({ tag_name: 'v1.0.1', body: '' }))
    expect(result).toMatchObject({ kind: 'release', zipUrl: null })
  })

  it('treats a null body as empty notes', async () => {
    const result = await fetchLatestRelease(respond({ tag_name: 'v1.0.1', body: null, assets: [] }))
    expect(result).toMatchObject({ kind: 'release', notes: '' })
  })

  it('returns none for 404', async () => {
    expect(await fetchLatestRelease(respond({ message: 'Not Found' }, 404))).toEqual({ kind: 'none' })
  })

  it('returns an error for other error statuses', async () => {
    expect(await fetchLatestRelease(respond({ message: 'boom' }, 500))).toEqual({ kind: 'error', message: 'GitHub 응답 500' })
  })

  it('returns an error for a network failure', async () => {
    const fetchFn = vi.fn(async () => { throw new Error('getaddrinfo ENOTFOUND api.github.com') }) as unknown as typeof fetch
    expect(await fetchLatestRelease(fetchFn)).toEqual({ kind: 'error', message: 'getaddrinfo ENOTFOUND api.github.com' })
  })

  it('returns an error for a non-JSON body', async () => {
    expect(await fetchLatestRelease(respond('<html>'))).toMatchObject({ kind: 'error' })
  })

  it('returns an error for a malformed tag', async () => {
    expect(await fetchLatestRelease(respond({ tag_name: 'nightly', body: '', assets: [] }))).toEqual({
      kind: 'error',
      message: '태그 형식이 올바르지 않습니다: nightly',
    })
  })
})

describe('releaseDetail', () => {
  it('puts the current version above the notes', () => {
    expect(releaseDetail('1.0.0', '- 수정')).toBe('현재 버전: 1.0.0\n\n- 수정')
  })

  it('omits the notes section when notes are empty', () => {
    expect(releaseDetail('1.0.0', '  ')).toBe('현재 버전: 1.0.0')
  })

  it('cuts notes longer than 1500 characters', () => {
    const detail = releaseDetail('1.0.0', 'a'.repeat(1600))
    expect(detail).toBe(`현재 버전: 1.0.0\n\n${'a'.repeat(1500)}...`)
  })
})
