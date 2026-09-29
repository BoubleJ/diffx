import { describe, it, expect } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RecentStore } from './recent'

const newStore = () => new RecentStore(join(mkdtempSync(join(tmpdir(), 'diffx-recent-')), 'recent.json'))

describe('RecentStore', () => {
  it('keeps most recent first, keeps ports, and caps at 10', () => {
    const store = newStore()
    expect(store.list()).toEqual([])
    store.touch('/a', 'a')
    store.setPort('/a', 4100)
    store.touch('/b', 'b')
    const list = store.touch('/a', 'a')
    expect(list.map((r) => r.path)).toEqual(['/a', '/b'])
    expect(list[0].port).toBe(4100)
    for (let i = 0; i < 12; i++) store.touch(`/r${i}`, `r${i}`)
    expect(store.list()).toHaveLength(10)
    expect(store.list()[0].path).toBe('/r11')
  })

  it('removes entries and survives a broken file', () => {
    const store = newStore()
    store.touch('/a', 'a')
    expect(store.remove('/a')).toEqual([])
    const broken = new RecentStore('/nonexistent/dir/recent.json')
    expect(broken.list()).toEqual([])
  })
})
