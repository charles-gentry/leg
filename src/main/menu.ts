import { Menu, shell, type BrowserWindow, type MenuItemConstructorOptions } from 'electron'

/**
 * Native application menu. App-specific items delegate to the renderer via
 * `webContents.send('menu', <action>)` so all dialog/snapshot logic stays in one
 * place (the renderer's window.art flows + store).
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
      label: 'Tools',
      submenu: [
        // Utility destinations live here (not the workflow sidebar); enabled when a document is open.
        { id: 'nav-library', label: 'Library', enabled: false, click: send('view.library') },
        { id: 'nav-audit', label: 'Audit', enabled: false, click: send('view.audit') }
      ]
    },
    {
      label: 'Print',
      submenu: [
        // Printable documents are a utility (not a workflow step), reached from this top-level menu.
        // Each navigates to its print-ready view; enabled once a trial is open.
        { id: 'print-fieldmap', label: 'Field Map', enabled: false, click: send('print.fieldmap') },
        { id: 'print-labels', label: 'Plot Labels', enabled: false, click: send('print.labels') },
        { id: 'print-datasheet', label: 'Data Collection Sheets', enabled: false, click: send('print.datasheet') },
        { id: 'print-spray', label: 'Spray Record', enabled: false, click: send('print.spray') },
        { type: 'separator' },
        { id: 'print-summary', label: 'Trial Summary', enabled: false, click: send('print.summary') },
        { id: 'print-report', label: 'Report', enabled: false, click: send('print.report') }
      ]
    },
    {
      role: 'help',
      submenu: [
        {
          label: 'ART on GitHub',
          click: () => {
            shell.openExternal('https://github.com/charles-gentry/ART')
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
