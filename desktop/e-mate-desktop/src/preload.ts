/** Minimal context-isolated bridge for resolving operating-system drag payloads. */

import { contextBridge, ipcRenderer, webUtils } from 'electron'
import {
  DESKTOP_BOOTSTRAP_BRIDGE,
  parseDesktopRendererBootstrapArgument,
} from './desktop-bootstrap-contract.ts'
import { DESKTOP_FILE_PATH_BRIDGE } from './file-path-bridge-contract.ts'
import {
  DESKTOP_UPDATE_BRIDGE,
  DESKTOP_UPDATE_CANCEL,
  DESKTOP_UPDATE_RUN_INTERACTIVE,
  DESKTOP_UPDATE_STATE_CHANGED,
  DESKTOP_UPDATE_STATE_READ,
  type DesktopUpdateBridge,
  type DesktopUpdateState,
} from './update-presentation.ts'

contextBridge.exposeInMainWorld(
  DESKTOP_BOOTSTRAP_BRIDGE,
  parseDesktopRendererBootstrapArgument(process.argv),
)

contextBridge.exposeInMainWorld(DESKTOP_FILE_PATH_BRIDGE, {
  /** Resolve only genuine disk-backed Web File objects selected by the operator. */
  getPathForFile(file: File): string {
    return webUtils.getPathForFile(file)
  },
})

const updates: DesktopUpdateBridge = {
  runInteractiveUpdate: async () => { await ipcRenderer.invoke(DESKTOP_UPDATE_RUN_INTERACTIVE) },
  getState: () => ipcRenderer.sendSync(DESKTOP_UPDATE_STATE_READ) as DesktopUpdateState | undefined,
  subscribe(listener) {
    const receive = (_event: Electron.IpcRendererEvent, state: DesktopUpdateState): void => { listener(state) }
    ipcRenderer.on(DESKTOP_UPDATE_STATE_CHANGED, receive)
    return () => { ipcRenderer.removeListener(DESKTOP_UPDATE_STATE_CHANGED, receive) }
  },
  cancel: () => ipcRenderer.sendSync(DESKTOP_UPDATE_CANCEL) === true,
}
contextBridge.exposeInMainWorld(DESKTOP_UPDATE_BRIDGE, updates)
