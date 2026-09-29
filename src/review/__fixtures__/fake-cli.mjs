// 테스트용 CLI. FAKE_MODE 환경변수로 동작을 고른다.
import { writeFileSync } from 'node:fs'

const mode = process.env.FAKE_MODE
const result = { summary: '요약', findings: [{ severity: 'minor', file: 'a.ts', line: 1, side: 'new', title: 't', body: 'b' }] }

let stdin = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (d) => { stdin += d })
process.stdin.on('end', () => {
  if (mode === 'ok') {
    console.log(JSON.stringify({ type: 'progress', text: 'a.ts 읽는 중' }))
    console.log(JSON.stringify({ type: 'final', json: result }))
  } else if (mode === 'text') {
    console.log(JSON.stringify({ type: 'final', text: '결과:\n```json\n' + JSON.stringify(result) + '\n```' }))
  } else if (mode === 'outfile') {
    writeFileSync(process.env.FAKE_OUT, JSON.stringify(result))
  } else if (mode === 'echo') {
    console.log(JSON.stringify({ type: 'final', json: { summary: stdin.slice(0, 20), findings: [] } }))
  } else if (mode === 'garbage') {
    console.log(JSON.stringify({ type: 'final', text: '정리하면 문제 없습니다' }))
  } else if (mode === 'auth') {
    console.error('Error: Please log in first. Run login.')
    process.exit(1)
  } else if (mode === 'crash') {
    console.error('boom')
    process.exit(3)
  } else if (mode === 'hang') {
    setInterval(() => {}, 1000)
  }
})
