import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

export interface RecentRepo {
  path: string
  name: string
  port: number | null
  openedAt: number
}

const MAX = 10

export class RecentStore {
  constructor(private file: string) {}

  list(): RecentRepo[] {
    try {
      const data = JSON.parse(readFileSync(this.file, 'utf-8'))
      return Array.isArray(data) ? data : []
    } catch {
      return []
    }
  }

  private write(list: RecentRepo[]): RecentRepo[] {
    const sorted = [...list].sort((a, b) => b.openedAt - a.openedAt).slice(0, MAX)
    try {
      mkdirSync(dirname(this.file), { recursive: true })
      writeFileSync(this.file, JSON.stringify(sorted, null, 2))
    } catch {}
    return sorted
  }

  touch(path: string, name: string): RecentRepo[] {
    const list = this.list()
    const existing = list.find((r) => r.path === path)
    const rest = list.filter((r) => r.path !== path)
    const openedAt = Math.max(Date.now(), ...list.map((r) => r.openedAt + 1))
    return this.write([{ path, name, port: existing?.port ?? null, openedAt }, ...rest])
  }

  setPort(path: string, port: number): void {
    this.write(this.list().map((r) => (r.path === path ? { ...r, port } : r)))
  }

  remove(path: string): RecentRepo[] {
    return this.write(this.list().filter((r) => r.path !== path))
  }
}
