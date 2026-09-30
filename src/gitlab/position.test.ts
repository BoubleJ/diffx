import { describe, it, expect } from 'vitest'
import { buildPosition, locateLine, findFilePatch } from './position'

const SHAS = { baseSha: 'b'.repeat(40), startSha: 's'.repeat(40), headSha: 'h'.repeat(40) }
const SHA_FIELDS = { position_type: 'text', base_sha: SHAS.baseSha, start_sha: SHAS.startSha, head_sha: SHAS.headSha }

const PATCH = [
  'diff --git a/src/a.ts b/src/a.ts',
  'index 1111111..2222222 100644',
  '--- a/src/a.ts',
  '+++ b/src/a.ts',
  '@@ -2,4 +2,5 @@ header',
  ' line2',
  '-line3',
  '+line3 changed',
  '+inserted',
  ' line4',
  ' line5',
  '@@ -20,3 +21,2 @@',
  ' line20',
  '-line21',
  ' line22',
  'diff --git a/old/name.ts b/new/name.ts',
  'similarity index 90%',
  'rename from old/name.ts',
  'rename to new/name.ts',
  'index 3333333..4444444 100644',
  '--- a/old/name.ts',
  '+++ b/new/name.ts',
  '@@ -1,2 +1,2 @@',
  '-a',
  '+b',
  ' c',
  'diff --git a/n.ts b/n.ts',
  'new file mode 100644',
  'index 0000000..5555555',
  '--- /dev/null',
  '+++ b/n.ts',
  '@@ -0,0 +1,2 @@',
  '+x',
  '+y',
  'diff --git a/d.ts b/d.ts',
  'deleted file mode 100644',
  'index 6666666..0000000',
  '--- a/d.ts',
  '+++ /dev/null',
  '@@ -1 +0,0 @@',
  '-gone',
  'diff --git a/i.png b/i.png',
  'index 7777777..8888888 100644',
  'Binary files a/i.png and b/i.png differ',
  '',
].join('\n')

const body = findFilePatch(PATCH, 'src/a.ts')!.body

describe('locateLine inside hunks', () => {
  it('maps added, deleted and context lines', () => {
    expect(locateLine(body, 'additions', 3)).toEqual({ new_line: 3 })
    expect(locateLine(body, 'additions', 4)).toEqual({ new_line: 4 })
    expect(locateLine(body, 'deletions', 3)).toEqual({ old_line: 3 })
    expect(locateLine(body, 'deletions', 21)).toEqual({ old_line: 21 })
    expect(locateLine(body, 'additions', 5)).toEqual({ old_line: 4, new_line: 5 })
    expect(locateLine(body, 'deletions', 20)).toEqual({ old_line: 20, new_line: 21 })
  })
})

describe('locateLine outside hunks (expanded context)', () => {
  it('uses the offset of the preceding hunk', () => {
    expect(locateLine(body, 'additions', 1)).toEqual({ old_line: 1, new_line: 1 })
    expect(locateLine(body, 'additions', 10)).toEqual({ old_line: 9, new_line: 10 })
    expect(locateLine(body, 'deletions', 9)).toEqual({ old_line: 9, new_line: 10 })
    expect(locateLine(body, 'additions', 30)).toEqual({ old_line: 30, new_line: 30 })
  })
})

describe('buildPosition', () => {
  it('fills shas and paths', () => {
    expect(buildPosition(PATCH, 'src/a.ts', 'additions', 3, SHAS))
      .toEqual({ ...SHA_FIELDS, old_path: 'src/a.ts', new_path: 'src/a.ts', new_line: 3 })
  })

  it('uses both paths for renamed files', () => {
    expect(buildPosition(PATCH, 'new/name.ts', 'additions', 1, SHAS))
      .toEqual({ ...SHA_FIELDS, old_path: 'old/name.ts', new_path: 'new/name.ts', new_line: 1 })
  })

  it('uses the new path on both sides for added files', () => {
    expect(buildPosition(PATCH, 'n.ts', 'additions', 2, SHAS))
      .toEqual({ ...SHA_FIELDS, old_path: 'n.ts', new_path: 'n.ts', new_line: 2 })
  })

  it('uses the old path on both sides for deleted files', () => {
    expect(buildPosition(PATCH, 'd.ts', 'deletions', 1, SHAS))
      .toEqual({ ...SHA_FIELDS, old_path: 'd.ts', new_path: 'd.ts', old_line: 1 })
  })

  it('returns null for binary and unknown files', () => {
    expect(buildPosition(PATCH, 'i.png', 'additions', 1, SHAS)).toBeNull()
    expect(buildPosition(PATCH, 'nope.ts', 'additions', 1, SHAS)).toBeNull()
  })
})
