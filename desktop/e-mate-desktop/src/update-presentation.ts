/** User-facing Profile update copy derived without exposing internal identities. */

import type { UpdateDownloadErrorCode } from './update-download.ts'

export function profileUpdateCapabilitySummary(changedCount: number): string {
  return changedCount === 0
    ? '本次仅更新发布回执，无需下载新的能力文件。'
    : `本次包含 ${changedCount} 项办公能力与体验优化。`
}

export function formatUpdateBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`
}

/** Stable updater projection consumed by Shell surfaces without owning transaction state. */
export type DesktopUpdateStage =
  | 'checking'
  | 'available'
  | 'confirming'
  | 'downloading'
  | 'verifying'
  | 'staging'
  | 'waiting-shutdown'
  | 'replacing'
  | 'restarting'
  | 'health-check'
  | 'completed'
  | 'rolling-back'
  | 'rolled-back'
  | 'failed'

export type DesktopUpdateFailureCode = Exclude<UpdateDownloadErrorCode, 'aborted'>
  | 'cancelled'
  | 'check-failed'
  | 'confirmation-failed'
  | 'download-failed'
  | 'verification-failed'
  | 'staging-failed'
  | 'helper-timeout'
  | 'mac-preflight-failed'
  | 'health-check-failed'
  | 'rollback-failed'
  | 'transaction-failed'

export interface DesktopUpdateState {
  readonly stage: DesktopUpdateStage
  readonly updateKind?: 'base' | 'components'
  readonly version?: string
  readonly bytes?: number
  readonly total?: number
  readonly cached?: true
  readonly mandatory?: boolean
  readonly minimumSupportedVersion?: string
  readonly code?: DesktopUpdateFailureCode
  readonly diagnosticId?: string
}

/** Existing context-isolated Main/Preload carrier; it never owns updater state. */
export const DESKTOP_UPDATE_BRIDGE = '__EMATE_DESKTOP_UPDATES__'
export const DESKTOP_UPDATE_STATE_READ = 'emate:desktop-update-state-read'
export const DESKTOP_UPDATE_STATE_CHANGED = 'emate:desktop-update-state-changed'
export const DESKTOP_UPDATE_CANCEL = 'emate:desktop-update-cancel'
export const DESKTOP_UPDATE_RUN_INTERACTIVE = 'emate:desktop-update-run-interactive'

export interface DesktopUpdateBridge {
  runInteractiveUpdate(): Promise<void>
  getState(): DesktopUpdateState | undefined
  subscribe(listener: (state: DesktopUpdateState) => void): () => void
  cancel(): boolean
}

export interface DesktopUpdateBridgeWindow extends Window {
  __EMATE_DESKTOP_UPDATES__?: DesktopUpdateBridge
}
