export function createRequestGate() {
  let latest = 0
  return {
    next: () => ++latest,
    isLatest: (id: number) => id === latest,
  }
}
