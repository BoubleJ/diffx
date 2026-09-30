import { app, Menu, type MenuItemConstructorOptions } from 'electron'
import type { RecentRepo } from './recent.js'

export function buildMenu(deps: {
  openFolder: () => void
  openRecent: (path: string) => void
  checkForUpdates: () => void
  recent: RecentRepo[]
}): Menu {
  const recentItems: MenuItemConstructorOptions[] = deps.recent.length
    ? deps.recent.map((r) => ({ label: `${r.name}  ${r.path}`, click: () => deps.openRecent(r.path) }))
    : [{ label: '최근 저장소 없음', enabled: false }]

  const template: MenuItemConstructorOptions[] = [
    {
      label: app.name,
      submenu: [
        { role: 'about' },
        { label: '업데이트 확인...', click: deps.checkForUpdates },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: '파일',
      submenu: [
        { label: '저장소 열기...', accelerator: 'CmdOrCtrl+O', click: deps.openFolder },
        { label: '최근 저장소', submenu: recentItems },
        { type: 'separator' },
        { role: 'close', label: '창 닫기' },
      ],
    },
    { role: 'editMenu' },
    {
      label: '보기',
      submenu: [
        { role: 'reload', label: '새로고침', accelerator: 'CmdOrCtrl+R' },
        { role: 'toggleDevTools', label: '개발자 도구' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    { role: 'windowMenu' },
  ]
  return Menu.buildFromTemplate(template)
}
