export interface MrShas {
  baseSha: string
  startSha: string
  headSha: string
}

export interface GitlabPosition {
  position_type: 'text'
  base_sha: string
  start_sha: string
  head_sha: string
  old_path: string
  new_path: string
  old_line?: number
  new_line?: number
}

type Side = 'additions' | 'deletions'

const HUNK_HEADER = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/

export function findFilePatch(patch: string, filePath: string): { oldPath: string; newPath: string; body: string[] } | null {
  for (const chunk of patch.split(/^(?=diff --git )/m)) {
    if (!chunk.startsWith('diff --git ')) continue
    const lines = chunk.split('\n')
    let oldPath: string | null = null
    let newPath: string | null = null
    let bodyStart = lines.length
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      if (line.startsWith('@@')) {
        bodyStart = i
        break
      }
      if (line.startsWith('rename from ')) oldPath = line.slice('rename from '.length)
      else if (line.startsWith('rename to ')) newPath = line.slice('rename to '.length)
      else if (line.startsWith('--- a/')) oldPath = line.slice(6).replace(/\t$/, '')
      else if (line.startsWith('+++ b/')) newPath = line.slice(6).replace(/\t$/, '')
    }
    if (oldPath === null && newPath === null) continue
    const resolvedOld = oldPath ?? newPath!
    const resolvedNew = newPath ?? oldPath!
    if (filePath !== resolvedNew && filePath !== resolvedOld) continue
    return { oldPath: resolvedOld, newPath: resolvedNew, body: lines.slice(bodyStart) }
  }
  return null
}

export function locateLine(body: string[], side: Side, lineNumber: number): { old_line?: number; new_line?: number } {
  let delta = 0
  let oldNo = 0
  let newNo = 0
  let inHunk = false
  for (const line of body) {
    const header = line.match(HUNK_HEADER)
    if (header) {
      const oldStart = Number(header[1])
      const newStart = Number(header[2])
      if (lineNumber < (side === 'additions' ? newStart : oldStart)) break
      oldNo = oldStart
      newNo = newStart
      inHunk = true
      continue
    }
    if (!inHunk) continue
    if (line.startsWith('+')) {
      if (side === 'additions' && newNo === lineNumber) return { new_line: newNo }
      newNo++
    } else if (line.startsWith('-')) {
      if (side === 'deletions' && oldNo === lineNumber) return { old_line: oldNo }
      oldNo++
    } else if (line.startsWith(' ')) {
      if ((side === 'additions' ? newNo : oldNo) === lineNumber) return { old_line: oldNo, new_line: newNo }
      oldNo++
      newNo++
    }
    delta = newNo - oldNo
  }
  return side === 'additions'
    ? { old_line: lineNumber - delta, new_line: lineNumber }
    : { old_line: lineNumber, new_line: lineNumber + delta }
}

export function buildPosition(patch: string, filePath: string, side: Side, lineNumber: number, shas: MrShas): GitlabPosition | null {
  const file = findFilePatch(patch, filePath)
  if (!file) return null
  return {
    position_type: 'text',
    base_sha: shas.baseSha,
    start_sha: shas.startSha,
    head_sha: shas.headSha,
    old_path: file.oldPath,
    new_path: file.newPath,
    ...locateLine(file.body, side, lineNumber),
  }
}
