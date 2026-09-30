// 테스트용 glab. FAKE_GLAB_MODE 환경변수로 동작을 고른다.
const mode = process.env.FAKE_GLAB_MODE

let stdin = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (d) => { stdin += d })
process.stdin.on('end', () => {
  const args = process.argv.slice(2)
  if (mode === 'echo') {
    console.log(JSON.stringify({ args, stdin, cwd: process.cwd() }))
  } else if (mode === 'empty') {
    process.exit(0)
  } else if (mode === 'not_gitlab') {
    console.error('\n   ERROR  \n\n  Unable to expand placeholder in path: none of the git remotes configured for this repository point to a known GitLab\n  host. Please use `glab auth login` to authenticate and configure a new host for glab.\n')
    process.exit(1)
  } else if (mode === 'auth') {
    console.error('\n   ERROR  \n\n  Unauthenticated.\n')
    process.exit(1)
  } else if (mode === 'not_found') {
    console.log('{"message":"404 Project Not Found"}')
    console.error('glab: 404 Project Not Found (HTTP 404)')
    process.exit(1)
  } else if (mode === 'garbage') {
    console.log('not json')
  } else if (mode === 'hang') {
    setInterval(() => {}, 1000)
  }
})
