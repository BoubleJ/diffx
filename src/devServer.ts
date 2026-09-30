import { resolve } from 'node:path'
import { getRepoRoot, isGitRepo } from './git.js'
import { startServer } from './server.js'

const PORT = 3433

if (!isGitRepo(process.cwd())) {
  console.error('git 저장소가 아닙니다. 저장소 폴더에서 실행해 주세요.')
  process.exit(1)
}

const repoPath = getRepoRoot(process.cwd())
const clientDir = resolve(process.cwd(), 'dist/client')
const { close } = await startServer({ repoPath, clientDir, port: PORT, host: '127.0.0.1' })
console.log(`개발용 서버: http://127.0.0.1:${PORT} (${repoPath})`)

const shutdown = async () => {
  await Promise.race([close(), new Promise((r) => setTimeout(r, 1000))])
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
