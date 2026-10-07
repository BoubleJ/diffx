export class AutoCheckPolicy {
  private lastCheckedAt: number | null = null
  private dismissed = new Set<string>()

  constructor(private minIntervalMs: number) {}

  shouldCheck(now: number): boolean {
    return this.lastCheckedAt === null || now - this.lastCheckedAt >= this.minIntervalMs
  }

  markChecked(now: number): void {
    this.lastCheckedAt = now
  }

  dismiss(version: string): void {
    this.dismissed.add(version)
  }

  isDismissed(version: string): boolean {
    return this.dismissed.has(version)
  }
}
