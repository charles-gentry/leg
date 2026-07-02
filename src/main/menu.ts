import { Menu, shell, type BrowserWindow, type MenuItemConstructorOptions } from 'electron'

/**
 * Native application menu. App-specific items delegate to the renderer via
 * `webContents.send('menu', <action>)` so all dialog/snapshot logic stays in one
 * place (the renderer's window.arm flows + store).
 */
export function buildMenu(win: BrowserWindow): Menu {
  const isDev = !!process.env['ELECTRON_RENDERER_URL']
  const send = (action: string) => (): void => win.webContents.send('menu', action)

  const template: MenuItemConstructorOptions[] = [
    {
      label: 'File',
      submenu: [
        { label: 'New Protocol', accelerator: 'CmdOrCtrl+N', click: send('protocol.new') },
        { label: 'Open…', accelerator: 'CmdOrCtrl+O', click: send('file.open') },
        { label: 'Open Trial…', click: send('trial.open') },
        { type: 'separator' },
        { label: 'New Trial from Protocol…', click: send('trial.newFromProtocol') },
        {
          id: 'trial-from-current',
          label: 'New Trial from Current Protocol',
          enabled: false,
          click: send('trial.newFromCurrent')
        },
        { type: 'separator' },
        { label: 'Close File', accelerator: 'CmdOrCtrl+W', click: send('file.close') },
        { type: 'separator' },
        { role: 'quit' }
      ]
    },
    {
      label: 'View',
      submenu: [
        { label: 'Toggle Sidebar', accelerator: 'CmdOrCtrl+B', click: send('sidebar.toggle') },
        { type: 'separator' },
        ...(isDev
          ? ([{ role: 'reload' }, { role: 'toggleDevTools' }, { type: 'separator' }] as MenuItemConstructorOptions[])
          : []),
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      role: 'help',
      submenu: [
        {
          label: 'Open ARM on GitHub',
          click: () => {
            shell.openExternal('https://github.com/charles-gentry/leg')
          }
        }
      ]
    }
  ]

  return Menu.buildFromTemplate(template)
}

/** Enable/disable a menu item by id (used to gate "New Trial from Current Protocol"). */
export function setMenuEnabled(id: string, enabled: boolean): void {
  const item = Menu.getApplicationMenu()?.getMenuItemById(id)
  if (item) item.enabled = enabled
}
