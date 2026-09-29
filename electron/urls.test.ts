import { describe, expect, it } from 'vitest'
import { isExternalHttpUrl, isSameOrigin } from './urls.js'

describe('isSameOrigin', () => {
  const origin = 'http://127.0.0.1:5000'
  it('같은 origin 이면 true', () => {
    expect(isSameOrigin('http://127.0.0.1:5000/a?b=1', origin)).toBe(true)
  })
  it('포트가 접두사로만 일치하면 false', () => {
    expect(isSameOrigin('http://127.0.0.1:50001/', origin)).toBe(false)
  })
  it('다른 호스트나 스킴이면 false', () => {
    expect(isSameOrigin('https://127.0.0.1:5000/', origin)).toBe(false)
    expect(isSameOrigin('http://evil.com/', origin)).toBe(false)
  })
  it('파싱할 수 없으면 false', () => {
    expect(isSameOrigin('not a url', origin)).toBe(false)
  })
})

describe('isExternalHttpUrl', () => {
  it('http 와 https 만 true', () => {
    expect(isExternalHttpUrl('http://example.com')).toBe(true)
    expect(isExternalHttpUrl('https://example.com/x')).toBe(true)
  })
  it('file, smb, 커스텀 스킴은 false', () => {
    expect(isExternalHttpUrl('file:///etc/passwd')).toBe(false)
    expect(isExternalHttpUrl('smb://host/share')).toBe(false)
    expect(isExternalHttpUrl('myapp://open')).toBe(false)
  })
  it('파싱할 수 없으면 false', () => {
    expect(isExternalHttpUrl('::::')).toBe(false)
  })
})
