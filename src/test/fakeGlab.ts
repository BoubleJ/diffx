import type { GlabClient, GlabRequest } from '../gitlab/glab'

type Route = unknown | Error | ((request: GlabRequest, path: string) => unknown)

export function fakeGlab(routes: Record<string, Route>) {
  const calls: { path: string; request: GlabRequest }[] = []
  const glab: GlabClient = async (path, request = {}) => {
    calls.push({ path, request })
    const key = `${request.method ?? 'GET'} ${path.split('?')[0]}`
    if (!(key in routes)) throw new Error(`unexpected glab call: ${key}`)
    const route = routes[key]
    if (route instanceof Error) throw route
    return typeof route === 'function' ? (route as (r: GlabRequest, p: string) => unknown)(request, path) : route
  }
  return { glab, calls }
}
