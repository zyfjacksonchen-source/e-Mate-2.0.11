/** Context-isolated command that triggers the one native desktop update lifecycle. */

export const DESKTOP_UPDATE_TRIGGER_BRIDGE = '__EMATE_DESKTOP_UPDATES__'
export const DESKTOP_UPDATE_RUN_INTERACTIVE = 'emate:desktop-update-run-interactive'

export interface DesktopUpdateTriggerBridge {
  runInteractiveUpdate(): Promise<void>
}

export interface DesktopUpdateTriggerBridgeWindow extends Window {
  __EMATE_DESKTOP_UPDATES__?: DesktopUpdateTriggerBridge
}
