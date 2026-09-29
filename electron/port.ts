export async function startOnPreferredPort<T>(start: (port: number) => Promise<T>, preferred: number | null): Promise<T> {
  if (preferred === null) return start(0)
  try {
    return await start(preferred)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw err
    return start(0)
  }
}
