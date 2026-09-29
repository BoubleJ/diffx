import { describe, it, expect } from 'vitest'
import { excludeFilesFromPatch } from './filterPatch'

const modified = (path: string) => `diff --git a/${path} b/${path}
index 1111111..2222222 100644
--- a/${path}
+++ b/${path}
@@ -1 +1 @@
-old
+new
`

const deleted = (path: string) => `diff --git a/${path} b/${path}
deleted file mode 100644
index 1111111..0000000
--- a/${path}
+++ /dev/null
@@ -1 +0,0 @@
-gone
`

const binary = (path: string) => `diff --git a/${path} b/${path}
index 1111111..2222222 100644
Binary files a/${path} and b/${path} differ
`

const renamed = (from: string, to: string) => `diff --git a/${from} b/${to}
similarity index 90%
rename from ${from}
rename to ${to}
index 1111111..2222222 100644
--- a/${from}
+++ b/${to}
@@ -1 +1 @@
-old
+new
`

describe('excludeFilesFromPatch', () => {
  it('returns the original patch when exclude is empty', () => {
    const patch = modified('a.ts') + modified('b.ts')
    expect(excludeFilesFromPatch(patch, [])).toBe(patch)
  })

  it('removes only the chunk of the excluded file', () => {
    const patch = modified('a.ts') + modified('b.ts') + modified('c.ts')
    expect(excludeFilesFromPatch(patch, ['b.ts'])).toBe(modified('a.ts') + modified('c.ts'))
  })

  it('handles paths with spaces', () => {
    const patch = modified('my dir/a b.ts') + modified('c.ts')
    expect(excludeFilesFromPatch(patch, ['my dir/a b.ts'])).toBe(modified('c.ts'))
  })

  it('handles paths containing " b/"', () => {
    const patch = modified('x b/y.ts') + modified('y.ts')
    expect(excludeFilesFromPatch(patch, ['x b/y.ts'])).toBe(modified('y.ts'))
  })

  it('removes deleted files using the --- header', () => {
    const patch = modified('a.ts') + deleted('old.ts')
    expect(excludeFilesFromPatch(patch, ['old.ts'])).toBe(modified('a.ts'))
  })

  it('removes binary chunks using the diff --git line', () => {
    const patch = binary('img/logo.png') + modified('a.ts')
    expect(excludeFilesFromPatch(patch, ['img/logo.png'])).toBe(modified('a.ts'))
  })

  it('matches renamed files by the new path', () => {
    const patch = renamed('old.ts', 'new.ts') + modified('a.ts')
    expect(excludeFilesFromPatch(patch, ['old.ts'])).toBe(patch)
    expect(excludeFilesFromPatch(patch, ['new.ts'])).toBe(modified('a.ts'))
  })

  it('ignores excluded paths that are not in the patch', () => {
    const patch = modified('a.ts')
    expect(excludeFilesFromPatch(patch, ['zzz.ts'])).toBe(patch)
  })
})
