import { describe, it, expect } from 'vitest'
import { conversationLabel, formatLastAt, parseRetentionInput } from './reviewConversations'

describe('conversationLabel', () => {
  it('names branch comparisons and MRs', () => {
    expect(conversationLabel('branch:develop...feature/login')).toBe('feature/login → develop')
    expect(conversationLabel('mr:128')).toBe('MR !128')
    expect(conversationLabel('unknown')).toBe('unknown')
  })
})

describe('formatLastAt', () => {
  it('formats local time as YYYY-MM-DD HH:mm', () => {
    expect(formatLastAt(new Date(2026, 8, 3, 7, 5).getTime())).toBe('2026-09-03 07:05')
  })
})

describe('parseRetentionInput', () => {
  it('reads empty and 0 as no deletion and positive integers as days', () => {
    expect(parseRetentionInput('')).toBeNull()
    expect(parseRetentionInput(' 0 ')).toBeNull()
    expect(parseRetentionInput('30')).toBe(30)
  })

  it('returns undefined for other input', () => {
    expect(parseRetentionInput('abc')).toBeUndefined()
    expect(parseRetentionInput('-1')).toBeUndefined()
    expect(parseRetentionInput('1.5')).toBeUndefined()
  })
})
