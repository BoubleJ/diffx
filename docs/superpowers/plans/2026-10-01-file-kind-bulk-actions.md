# 파일 종류별 리뷰 제외와 Viewed 일괄 처리 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 사이드바 검색줄 오른쪽 버튼으로 여는 팝오버에서 파일 종류(테스트 파일, 확장자)별로 `리뷰 제외`와 `Viewed`를 한 번에 체크하고 해제한다.

**Architecture:** 파일 종류 판별과 체크 상태 계산은 `src/ui/fileKinds.ts`의 순수 함수로 둔다. `FileKindPopover.tsx`는 버튼과 팝오버 열기, 닫기를 맡고, 표는 같은 파일의 `FileKindTable`이 그린다. `App.tsx`가 모든 diff 파일 경로, 리뷰 제외 집합, Viewed 집합과 여러 파일 처리 함수를 넘기고, `FileTree`는 받은 팝오버를 검색줄 오른쪽에 그린다.

**Tech Stack:** TypeScript, React 19, lucide-react, vitest, react-dom/server `renderToStaticMarkup`

**Spec:** `docs/superpowers/specs/2026-10-01-file-kind-bulk-actions-design.md`

## Global Constraints

- 새 npm 의존성을 추가하지 않는다.
- 적용 범위는 지금 열린 diff뿐이다. 다른 브랜치나 MR에 자동으로 적용하는 규칙을 만들지 않는다.
- 리뷰 제외 저장은 기존 `loadExcluded`, `saveExcluded`(localStorage)를, Viewed 저장은 기존 `useViewed`의 `setViewed`를 그대로 쓴다.
- 화면 문구(그대로 쓴다): 팝오버 제목 `파일 종류`, 열 머리 `리뷰 제외`, `Viewed`, 종류 이름 `테스트 파일`, `확장자 없음`, 개수 `N개`, 버튼 `title`과 `aria-label` `파일 종류별 처리`
- 체크박스 `aria-label`: `<종류 이름> 리뷰 제외`, `<종류 이름> Viewed` (예: `.md 리뷰 제외`)
- 버튼 아이콘: lucide-react `ListFilter`
- 커밋 메시지는 한글, type prefix만 영문. `Co-Authored-By` 트레일러를 넣지 않는다.
- 코드 주석은 꼭 필요한 곳에만 단다. 새 주석이 필요하면 사용자에게 먼저 묻는다.
- 로컬 개발 서버와 앱은 사용자가 직접 실행한다.
- 테스트: `pnpm test`. 타입 검사: `pnpm exec tsc --noEmit -p .`. 클라이언트 빌드: `pnpm run build:electron`. 작업 시작 시점에 테스트 400개가 통과한다.
- 작업 위치: `main`에서 worktree `../reviewHelper-file-kinds`와 브랜치 `feature/file-kind-bulk-actions`를 만들어 작업한다. 작업 시작 전 `main`에 커밋하지 않은 `리뷰 제외` 문구 수정(`ExcludeButton.tsx`, `FileTree.tsx`)이 있으면 사용자에게 먼저 커밋할지 묻는다.

## Review Focus

1. 사이드바는 `.sidebar`와 `.sidebar-content`에 `overflow: hidden`이 있어서 `position: absolute` 팝오버는 사이드바 폭에서 잘린다. 팝오버는 버튼 위치로 계산한 `position: fixed`로 그려야 사이드바 밖으로 펼쳐진다. Task 2에서 처리하고 Task 3 앱 확인 1번에서 확인한다.
2. diff의 파일을 모두 리뷰 제외해도 팝오버에는 모든 종류가 남아 있어서 다시 포함할 수 있어야 한다. Task 2 테스트 `keeps kinds whose files are all excluded and disables their Viewed box`가 확인한다.
3. 한 종류의 파일 중 일부만 리뷰 제외됐을 때 `Viewed`는 남은 파일만 대상으로 해야 한다. 리뷰 제외된 파일 때문에 `Viewed`가 일부 체크 상태로 보이면 안 된다. Task 2 테스트 `uses only files that are not excluded for the Viewed box`가 확인한다.
4. `README.MD`처럼 대문자 확장자가 `.md`와 다른 줄로 나뉘면 안 된다. Task 1 테스트 `uses the last extension in lower case`가 확인한다.
5. `.gitignore`나 `src/.env` 같은 점 파일이 확장자 줄로 잘못 묶이면 안 된다. Task 1 테스트 `returns an empty kind for files without an extension`이 확인한다.

---

### Task 1: 파일 종류 판별과 체크 상태

**Files:**
- Create: `src/ui/fileKinds.ts`
- Test: `src/ui/fileKinds.test.ts`

**Interfaces:**
- Produces:
  - `TEST_KIND: 'test'`
  - `type CheckState = 'all' | 'some' | 'none'`
  - `interface FileKindGroup { kind: string; label: string; paths: string[] }`
  - `fileKind(path: string): string` (`'test'`, `'.md'` 같은 소문자 확장자, 확장자가 없으면 `''`)
  - `groupFileKinds(paths: string[]): FileKindGroup[]`
  - `checkState(paths: string[], selected: Set<string>): CheckState`

- [ ] **Step 1: worktree 만들기**

```bash
cd /Users/byeonjaejeong/Desktop/reviewHelper
git status --short
git worktree add ../reviewHelper-file-kinds -b feature/file-kind-bulk-actions
cd ../reviewHelper-file-kinds
pnpm install --frozen-lockfile
```

`git status --short`에 출력이 있으면 멈추고 사용자에게 먼저 커밋할지 묻는다. 이후 모든 단계는 `../reviewHelper-file-kinds`에서 실행한다.

- [ ] **Step 2: `fileKinds.test.ts` 작성**

```ts
import { describe, it, expect } from 'vitest'
import { checkState, fileKind, groupFileKinds } from './fileKinds'

describe('fileKind', () => {
  it('detects test files by .test., .spec. and __tests__', () => {
    expect(fileKind('src/App.test.tsx')).toBe('test')
    expect(fileKind('e2e/login.spec.ts')).toBe('test')
    expect(fileKind('src/__tests__/util.ts')).toBe('test')
    expect(fileKind('src/testing.ts')).toBe('.ts')
  })

  it('uses the last extension in lower case', () => {
    expect(fileKind('docs/guide.md')).toBe('.md')
    expect(fileKind('README.MD')).toBe('.md')
    expect(fileKind('src/types.d.ts')).toBe('.ts')
  })

  it('returns an empty kind for files without an extension', () => {
    expect(fileKind('Makefile')).toBe('')
    expect(fileKind('.gitignore')).toBe('')
    expect(fileKind('src/.env')).toBe('')
  })
})

describe('groupFileKinds', () => {
  it('puts test files first and does not count them under their extension', () => {
    const groups = groupFileKinds(['src/a.ts', 'src/b.ts', 'src/a.test.ts'])
    expect(groups).toEqual([
      { kind: 'test', label: '테스트 파일', paths: ['src/a.test.ts'] },
      { kind: '.ts', label: '.ts', paths: ['src/a.ts', 'src/b.ts'] },
    ])
  })

  it('orders the other kinds by file count then label', () => {
    const groups = groupFileKinds(['a.md', 'b.json', 'c.ts', 'd.ts', 'e.css'])
    expect(groups.map((g) => g.label)).toEqual(['.ts', '.css', '.json', '.md'])
  })

  it('puts files without an extension last', () => {
    const groups = groupFileKinds(['Makefile', 'Dockerfile', 'LICENSE', 'a.md'])
    expect(groups.map((g) => g.label)).toEqual(['.md', '확장자 없음'])
    expect(groups[1].paths).toEqual(['Makefile', 'Dockerfile', 'LICENSE'])
  })
})

describe('checkState', () => {
  it('reports whether all, some or none of the paths are selected', () => {
    const selected = new Set(['a', 'b'])
    expect(checkState(['a', 'b'], selected)).toBe('all')
    expect(checkState(['a', 'c'], selected)).toBe('some')
    expect(checkState(['c'], selected)).toBe('none')
    expect(checkState([], selected)).toBe('none')
  })
})
```

- [ ] **Step 3: 테스트 실패 확인**

Run: `pnpm vitest run src/ui/fileKinds.test.ts`
Expected: FAIL, `Cannot find module './fileKinds'`

- [ ] **Step 4: `fileKinds.ts` 구현**

```ts
export const TEST_KIND = 'test'

export type CheckState = 'all' | 'some' | 'none'

export interface FileKindGroup {
  kind: string
  label: string
  paths: string[]
}

export function fileKind(path: string): string {
  const name = path.slice(path.lastIndexOf('/') + 1)
  if (/\.(test|spec)\./.test(name) || /(^|\/)__tests__\//.test(path)) return TEST_KIND
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot).toLowerCase() : ''
}

function kindLabel(kind: string): string {
  if (kind === TEST_KIND) return '테스트 파일'
  if (kind === '') return '확장자 없음'
  return kind
}

function kindRank(kind: string): number {
  if (kind === TEST_KIND) return 0
  if (kind === '') return 2
  return 1
}

export function groupFileKinds(paths: string[]): FileKindGroup[] {
  const byKind = new Map<string, string[]>()
  for (const path of paths) {
    const kind = fileKind(path)
    const list = byKind.get(kind)
    if (list) list.push(path)
    else byKind.set(kind, [path])
  }
  return [...byKind]
    .map(([kind, list]) => ({ kind, label: kindLabel(kind), paths: list }))
    .sort((a, b) => kindRank(a.kind) - kindRank(b.kind) || b.paths.length - a.paths.length || a.label.localeCompare(b.label))
}

export function checkState(paths: string[], selected: Set<string>): CheckState {
  const count = paths.filter((path) => selected.has(path)).length
  if (count === 0) return 'none'
  return count === paths.length ? 'all' : 'some'
}
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `pnpm vitest run src/ui/fileKinds.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 6: 커밋**

```bash
git add src/ui/fileKinds.ts src/ui/fileKinds.test.ts
git commit -m "feat: 파일 종류 판별과 종류별 체크 상태 계산 추가"
```

---

### Task 2: 팝오버와 표

**Files:**
- Create: `src/ui/components/FileKindPopover.tsx`
- Modify: `src/ui/components/FileTree.tsx` (`FileTreeProps`, 펼친 상태의 `ft-search`), `src/ui/styles/global.css` (`.ft-search-input:focus` 규칙 아래)
- Test: `src/ui/components/FileKindPopover.test.ts`

**Interfaces:**
- Consumes: Task 1의 `groupFileKinds`, `checkState`, `CheckState`, `FileKindGroup`
- Produces:
  - `interface FileKindActions { excluded: Set<string>; viewed: Set<string>; onExcludeMany: (paths: string[]) => void; onIncludeMany: (paths: string[]) => void; onViewedMany: (paths: string[], viewed: boolean) => void }`
  - `FileKindTable(props: FileKindActions & { groups: FileKindGroup[] })`
  - `FileKindPopover(props: FileKindActions & { paths: string[] })`
  - `FileTreeProps.searchAction?: ReactNode`

spec은 열린 버튼에 `btn-active`를 붙인다고 적었지만, `btn-active`는 파란 배경이고 `.sidebar-toggle:hover`가 뒤에 선언되어 있어 마우스를 올리면 배경이 덮어써진다. 그래서 `fk-btn-open` 클래스로 `--bg-tertiary` 배경을 준다. 팝오버는 Review Focus 1번 때문에 `position: fixed`로 그린다.

- [ ] **Step 1: `FileKindPopover.test.ts` 작성**

```ts
import { describe, it, expect } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { FileKindTable } from './FileKindPopover'
import { groupFileKinds } from '../fileKinds'

const noop = () => {}

function render(paths: string[], excluded: string[], viewed: string[]) {
  return renderToStaticMarkup(
    createElement(FileKindTable, {
      groups: groupFileKinds(paths),
      excluded: new Set(excluded),
      viewed: new Set(viewed),
      onExcludeMany: noop,
      onIncludeMany: noop,
      onViewedMany: noop,
    }),
  )
}

function checkbox(html: string, label: string): string {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = html.match(new RegExp(`<input[^>]*aria-label="${escaped}"[^>]*>`))
  if (!match) throw new Error(`checkbox not found: ${label}`)
  return match[0]
}

describe('FileKindTable', () => {
  it('renders a row per kind with its file count', () => {
    const html = render(['a.test.ts', 'b.test.ts', 'c.md'], [], [])
    expect(html).toContain('<th scope="row">테스트 파일</th><td class="fk-count">2개</td>')
    expect(html).toContain('<th scope="row">.md</th><td class="fk-count">1개</td>')
  })

  it('checks the exclude box only when every file of the kind is excluded', () => {
    const html = render(['a.md', 'b.md', 'c.ts', 'd.ts'], ['a.md', 'b.md', 'c.ts'], [])
    expect(checkbox(html, '.md 리뷰 제외')).toContain('checked=""')
    expect(checkbox(html, '.ts 리뷰 제외')).not.toContain('checked=""')
  })

  it('keeps kinds whose files are all excluded and disables their Viewed box', () => {
    const html = render(['a.md', 'b.ts'], ['a.md', 'b.ts'], [])
    expect(checkbox(html, '.md 리뷰 제외')).toContain('checked=""')
    expect(checkbox(html, '.md Viewed')).toContain('disabled=""')
    expect(checkbox(html, '.md Viewed')).not.toContain('checked=""')
  })

  it('uses only files that are not excluded for the Viewed box', () => {
    const html = render(['a.ts', 'b.ts'], ['a.ts'], ['b.ts'])
    expect(checkbox(html, '.ts Viewed')).toContain('checked=""')
    expect(checkbox(html, '.ts Viewed')).not.toContain('disabled=""')
  })
})
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `pnpm vitest run src/ui/components/FileKindPopover.test.ts`
Expected: FAIL, `Cannot find module './FileKindPopover'`

- [ ] **Step 3: `FileKindPopover.tsx` 구현**

```tsx
import { useEffect, useMemo, useRef, useState } from 'react'
import { ListFilter } from 'lucide-react'
import { checkState, groupFileKinds, type CheckState, type FileKindGroup } from '../fileKinds'

export interface FileKindActions {
  excluded: Set<string>
  viewed: Set<string>
  onExcludeMany: (paths: string[]) => void
  onIncludeMany: (paths: string[]) => void
  onViewedMany: (paths: string[], viewed: boolean) => void
}

function TriCheckbox({ label, state, disabled, onChange }: { label: string; state: CheckState; disabled?: boolean; onChange: () => void }) {
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = state === 'some'
  }, [state])
  return <input ref={ref} type="checkbox" aria-label={label} checked={state === 'all'} disabled={disabled} onChange={onChange} />
}

function FileKindRow({ group, excluded, viewed, onExcludeMany, onIncludeMany, onViewedMany }: FileKindActions & { group: FileKindGroup }) {
  const excludeState = checkState(group.paths, excluded)
  const viewTargets = group.paths.filter((path) => !excluded.has(path))
  const viewState = checkState(viewTargets, viewed)
  return (
    <tr>
      <th scope="row">{group.label}</th>
      <td className="fk-count">{group.paths.length}개</td>
      <td className="fk-check">
        <TriCheckbox
          label={`${group.label} 리뷰 제외`}
          state={excludeState}
          onChange={() => (excludeState === 'all' ? onIncludeMany(group.paths) : onExcludeMany(group.paths))}
        />
      </td>
      <td className="fk-check">
        <TriCheckbox
          label={`${group.label} Viewed`}
          state={viewState}
          disabled={viewTargets.length === 0}
          onChange={() =>
            viewState === 'all'
              ? onViewedMany(viewTargets, false)
              : onViewedMany(viewTargets.filter((path) => !viewed.has(path)), true)
          }
        />
      </td>
    </tr>
  )
}

export function FileKindTable({ groups, ...actions }: FileKindActions & { groups: FileKindGroup[] }) {
  return (
    <table className="fk-table">
      <thead>
        <tr>
          <th className="fk-title" colSpan={2}>파일 종류</th>
          <th className="fk-check">리뷰 제외</th>
          <th className="fk-check">Viewed</th>
        </tr>
      </thead>
      <tbody>
        {groups.map((group) => (
          <FileKindRow key={group.kind} group={group} {...actions} />
        ))}
      </tbody>
    </table>
  )
}

export function FileKindPopover({ paths, ...actions }: FileKindActions & { paths: string[] }) {
  const [anchor, setAnchor] = useState<DOMRect | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const groups = useMemo(() => groupFileKinds(paths), [paths])

  useEffect(() => {
    if (!anchor) return
    const handleMouseDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setAnchor(null)
    }
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setAnchor(null)
    }
    document.addEventListener('mousedown', handleMouseDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handleMouseDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [anchor])

  return (
    <div className="fk" ref={ref}>
      <button
        type="button"
        className={`sidebar-toggle ${anchor ? 'fk-btn-open' : ''}`}
        title="파일 종류별 처리"
        aria-label="파일 종류별 처리"
        aria-expanded={anchor !== null}
        disabled={paths.length === 0}
        onClick={(e) => setAnchor(anchor ? null : e.currentTarget.getBoundingClientRect())}
      >
        <ListFilter size={16} />
      </button>
      {anchor && (
        <div className="fk-popover" style={{ top: anchor.bottom + 4, left: anchor.left }}>
          <FileKindTable groups={groups} {...actions} />
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `pnpm vitest run src/ui/components/FileKindPopover.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: `FileTree.tsx`에 `searchAction` 자리 추가**

첫 줄 import를 바꾼다.

```ts
import { useState, useMemo, type ReactNode } from 'react'
```

`FileTreeProps`의 `onToggleCollapse?: () => void` 아래에 추가한다.

```ts
  searchAction?: ReactNode
```

`export function FileTree({ ... })`의 구조 분해에 `searchAction`을 추가한다.

```ts
export function FileTree({ files, activeFile, commentCounts, viewedFiles, onFileClick, onExclude, collapsed, onToggleCollapse, searchAction }: FileTreeProps) {
```

펼친 상태의 `ft-search` 안에서 `ft-search-wrapper` div가 닫힌 바로 다음 줄에 추가한다. 접힌 상태(`if (collapsed)` 블록)에는 추가하지 않는다.

```tsx
        {searchAction}
```

- [ ] **Step 6: 스타일 추가**

`src/ui/styles/global.css`의 `.ft-search-input:focus { ... }` 규칙 바로 아래에 추가한다.

```css
.fk {
    display: flex;
    flex-shrink: 0;
}

.fk .sidebar-toggle:disabled {
    opacity: 0.4;
    cursor: default;
}

.fk .fk-btn-open {
    background: var(--bg-tertiary);
    color: var(--text);
}

.fk-popover {
    position: fixed;
    z-index: 200;
    min-width: 260px;
    max-height: 60vh;
    overflow-y: auto;
    padding: 4px 0;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 6px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
}

@media (prefers-color-scheme: dark) {
    .fk-popover {
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    }
}

.fk-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 12px;
    color: var(--text);
}

.fk-table th,
.fk-table td {
    padding: 4px 12px;
    text-align: left;
    white-space: nowrap;
}

.fk-table thead th {
    font-weight: 500;
    color: var(--text-secondary);
}

.fk-table .fk-title {
    font-weight: 600;
    color: var(--text);
}

.fk-table tbody th {
    font-weight: 400;
}

.fk-table .fk-count {
    color: var(--text-secondary);
    text-align: right;
}

.fk-table .fk-check {
    text-align: center;
}
```

- [ ] **Step 7: 타입 검사와 전체 테스트**

Run: `pnpm exec tsc --noEmit -p . && pnpm test`
Expected: 타입 오류 없음, 테스트 411개 통과(기존 400개와 Task 1의 7개, Task 2의 4개)

- [ ] **Step 8: 커밋**

```bash
git add src/ui/components/FileKindPopover.tsx src/ui/components/FileKindPopover.test.ts src/ui/components/FileTree.tsx src/ui/styles/global.css
git commit -m "feat: 파일 종류별 리뷰 제외와 Viewed 팝오버 추가"
```

---

### Task 3: App 연결

**Files:**
- Modify: `src/ui/App.tsx` (`handleExclude`, `handleInclude` 부근, `handleViewedChange` 부근, `sidebarContent`의 `<FileTree>`)

**Interfaces:**
- Consumes: Task 2의 `FileKindPopover`, `FileTreeProps.searchAction`. 기존 `setExcludedEdit`, `loadExcluded`, `excludedSet`, `viewedFiles`, `setViewed`, `files`
- Produces: `handleExcludeMany(paths: string[])`, `handleIncludeMany(paths: string[])`, `handleViewedMany(paths: string[], viewed: boolean)`

이 Task는 `App.tsx` 연결만 바꾸므로 새 단위테스트를 쓰지 않는다. 기존 `handleExclude`, `handleInclude`를 여러 경로 함수로 옮기는 동작은 전체 테스트와 타입 검사, 앱 확인으로 본다.

- [ ] **Step 1: 리뷰 제외와 포함을 여러 경로 함수로 바꾸기**

`App.tsx`의 `handleExclude`, `handleInclude` 두 `useCallback`을 아래로 바꾼다.

```tsx
  const handleExcludeMany = useCallback((paths: string[]) => {
    if (!repoRoot || !key) return
    setExcludedEdit((prev) => {
      const current = prev && prev.repoRoot === repoRoot && prev.key === key ? prev.paths : loadExcluded(repoRoot, key)
      return { repoRoot, key, paths: [...new Set([...current, ...paths])] }
    })
  }, [repoRoot, key])
  const handleIncludeMany = useCallback((paths: string[]) => {
    if (!repoRoot || !key) return
    const removing = new Set(paths)
    setExcludedEdit((prev) => {
      const current = prev && prev.repoRoot === repoRoot && prev.key === key ? prev.paths : loadExcluded(repoRoot, key)
      return { repoRoot, key, paths: current.filter((p) => !removing.has(p)) }
    })
  }, [repoRoot, key])
  const handleExclude = useCallback((filePath: string) => handleExcludeMany([filePath]), [handleExcludeMany])
  const handleInclude = useCallback((filePath: string) => handleIncludeMany([filePath]), [handleIncludeMany])
```

- [ ] **Step 2: Viewed 여러 파일 처리와 전체 경로 목록 추가**

`handleViewedChange` `useCallback` 바로 아래에 추가한다.

```tsx
  const handleViewedMany = useCallback((paths: string[], viewed: boolean) => {
    for (const path of paths) void setViewed(path, viewed)
  }, [setViewed])

  const allPaths = useMemo(() => files.map((f) => f.name), [files])
```

- [ ] **Step 3: `FileTree`에 팝오버 넘기기**

import 목록의 `import { ExcludedFiles } from './components/ExcludedFiles'` 아래에 추가한다.

```tsx
import { FileKindPopover } from './components/FileKindPopover'
```

`sidebarContent`의 `<FileTree>`에서 `onToggleCollapse={handleToggleCollapse}` 아래에 추가한다.

```tsx
        searchAction={
          <FileKindPopover
            paths={allPaths}
            excluded={excludedSet}
            viewed={viewedFiles}
            onExcludeMany={handleExcludeMany}
            onIncludeMany={handleIncludeMany}
            onViewedMany={handleViewedMany}
          />
        }
```

`excludedSet`이 `sidebarContent`보다 아래에 선언되어 있으면 타입 검사가 `used before its declaration` 오류를 낸다. 지금 코드는 `excludedSet`(약 227줄)이 `sidebarContent`(약 412줄)보다 위에 있다.

- [ ] **Step 4: 타입 검사, 전체 테스트, 빌드**

Run: `pnpm exec tsc --noEmit -p . && pnpm test && pnpm run build:electron`
Expected: 타입 오류 없음, 테스트 411개 통과, 빌드 성공

- [ ] **Step 5: 커밋**

```bash
git add src/ui/App.tsx
git commit -m "feat: 사이드바 검색줄에 파일 종류별 처리 팝오버 연결"
```

- [ ] **Step 6: 앱 확인 (사용자)**

사용자가 worktree에서 `pnpm run dev:app`을 실행해 확인한다. 테스트 파일과 `.md`가 함께 바뀐 브랜치나 MR을 연다.

1. 사이드바 검색줄 오른쪽 버튼 클릭 시 팝오버가 사이드바 밖까지 잘리지 않고 펼쳐진다.
2. `테스트 파일`의 `리뷰 제외`를 체크하면 테스트 파일이 diff 목록과 파일 트리에서 사라지고 `제외된 파일` 목록에 나온다. 팝오버는 열린 채로 남는다.
3. 같은 체크박스를 해제하면 테스트 파일이 다시 나온다.
4. `.ts`의 `Viewed`를 체크하면 `.ts` 카드가 모두 접힌다. 카드 하나의 `Viewed`를 해제하면 팝오버의 `.ts` `Viewed` 체크박스가 일부 체크 상태(`▣`)로 보인다. 이 상태에서 클릭하면 모두 체크된다.
5. 팝오버 밖 클릭 시와 `Escape` 키 입력 시 팝오버가 닫힌다.
6. 다른 브랜치나 MR을 열면 앞에서 리뷰 제외한 종류가 적용되지 않는다.
