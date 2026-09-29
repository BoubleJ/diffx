const openButton = document.getElementById('open-folder')
const errorEl = document.getElementById('error')
const listEl = document.getElementById('recent')
const emptyEl = document.getElementById('recent-empty')

function showError(message) {
  errorEl.textContent = message
  errorEl.hidden = !message
}

function renderRecent(list) {
  listEl.replaceChildren()
  emptyEl.hidden = list.length > 0
  for (const repo of list) {
    const item = document.createElement('li')
    const open = document.createElement('button')
    open.className = 'recent-open'
    const name = document.createElement('span')
    name.className = 'recent-name'
    name.textContent = repo.name
    const path = document.createElement('span')
    path.className = 'recent-path'
    path.textContent = repo.path
    open.append(name, path)
    open.addEventListener('click', async () => {
      showError('')
      const result = await window.diffx.openRepo(repo.path)
      if (!result.ok) showError(result.error)
    })
    const remove = document.createElement('button')
    remove.className = 'recent-remove'
    remove.title = '목록에서 지우기'
    remove.textContent = '×'
    remove.addEventListener('click', async () => renderRecent(await window.diffx.removeRecent(repo.path)))
    item.append(open, remove)
    listEl.append(item)
  }
}

openButton.addEventListener('click', async () => {
  showError('')
  const result = await window.diffx.selectFolder()
  if (!result.ok && result.error !== 'cancelled') showError(result.error)
})

window.diffx.getRecent().then(renderRecent)
