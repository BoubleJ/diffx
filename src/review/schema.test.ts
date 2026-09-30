import { describe, it, expect } from 'vitest'
import { validateResult, extractJson, REVIEW_JSON_SCHEMA } from './schema'

const valid = {
  answer: '요약',
  locations: [{ file: 'a.ts', line: 3, side: 'new', title: '제목', body: '내용' }],
}

describe('validateResult', () => {
  it('accepts a valid result', () => {
    expect(validateResult(valid)).toEqual(valid)
  })

  it('accepts null line', () => {
    const v = { ...valid, locations: [{ ...valid.locations[0], line: null }] }
    expect(validateResult(v)).toEqual(v)
  })

  it('rejects wrong shapes', () => {
    expect(validateResult(null)).toBeNull()
    expect(validateResult({ answer: 1, locations: [] })).toBeNull()
    expect(validateResult({ summary: 's', findings: [] })).toBeNull()
    expect(validateResult({ answer: 's', locations: [{ ...valid.locations[0], line: 1.5 }] })).toBeNull()
    expect(validateResult({ answer: 's', locations: [{ ...valid.locations[0], side: 'left' }] })).toBeNull()
  })

  it('drops unknown extra fields including severity', () => {
    const v = { ...valid, extra: 1, locations: [{ ...valid.locations[0], severity: 'major' }] }
    expect(validateResult(v)).toEqual(valid)
  })
})

describe('extractJson', () => {
  it('parses plain JSON', () => {
    expect(extractJson(JSON.stringify(valid))).toEqual(valid)
  })

  it('parses a fenced json block surrounded by prose', () => {
    const text = `리뷰 결과입니다.\n\n\`\`\`json\n${JSON.stringify(valid, null, 2)}\n\`\`\`\n끝.`
    expect(extractJson(text)).toEqual(valid)
  })

  it('parses the outermost object when prose surrounds it without a fence', () => {
    expect(extractJson(`Here: ${JSON.stringify(valid)} done`)).toEqual(valid)
  })

  it('returns undefined when there is no JSON', () => {
    expect(extractJson('no json here')).toBeUndefined()
  })
})

describe('REVIEW_JSON_SCHEMA', () => {
  it('is strict', () => {
    const s = REVIEW_JSON_SCHEMA as unknown as { additionalProperties: boolean; required: string[]; properties: { locations: { items: { additionalProperties: boolean; required: string[] } } } }
    expect(s.additionalProperties).toBe(false)
    expect(s.required).toEqual(['answer', 'locations'])
    expect(s.properties.locations.items.additionalProperties).toBe(false)
    expect(s.properties.locations.items.required).toEqual(['file', 'line', 'side', 'title', 'body'])
  })
})
