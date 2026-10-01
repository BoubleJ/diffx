import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { APP_DATA_DIR } from './appData.js'

const CONFIG_DIR = APP_DATA_DIR
const SETTINGS_FILE = join(CONFIG_DIR, 'settings.json')

export interface Settings {
  diffStyle: 'split' | 'unified'
  defaultTabSize: number
  softWrap?: boolean
  terminalApp?: string
  reviewRetentionDays: number | null
}

const DEFAULTS: Settings = {
  diffStyle: 'split',
  defaultTabSize: 4,
  reviewRetentionDays: 30,
}

function pick(value: Record<string, unknown>): Partial<Settings> {
  const out: Partial<Settings> = {}
  if (value.diffStyle === 'split' || value.diffStyle === 'unified') out.diffStyle = value.diffStyle
  if (typeof value.defaultTabSize === 'number') out.defaultTabSize = value.defaultTabSize
  if (typeof value.softWrap === 'boolean') out.softWrap = value.softWrap
  if (typeof value.terminalApp === 'string') out.terminalApp = value.terminalApp.trim()
  const days = value.reviewRetentionDays
  if (days === null || days === 0) out.reviewRetentionDays = null
  else if (typeof days === 'number' && Number.isInteger(days) && days > 0) out.reviewRetentionDays = days
  return out
}

export function loadSettings(): Settings {
  try {
    const data = readFileSync(SETTINGS_FILE, 'utf-8')
    return { ...DEFAULTS, ...pick(JSON.parse(data)) }
  } catch {
    return { ...DEFAULTS }
  }
}

export function saveSettings(settings: Partial<Settings>): Settings {
  const current = loadSettings()
  const merged = { ...current, ...pick(settings) }
  mkdirSync(CONFIG_DIR, { recursive: true })
  writeFileSync(SETTINGS_FILE, JSON.stringify(merged, null, 2))
  return merged
}
