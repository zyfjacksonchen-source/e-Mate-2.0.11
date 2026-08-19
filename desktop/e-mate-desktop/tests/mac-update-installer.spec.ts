import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  performMacUpdateSwap,
  readMacUpdateStartupResult,
  writeMacUpdateStartupAck,
  type MacUpdateRequest,
  type MacUpdateSwapAdapter,
} from '../src/mac-update-installer.ts'

const temporaryRoots: string[] = []

function request(): MacUpdateRequest {
  return {
    schemaVersion: 1,
    transactionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    parentPid: 123,
    currentApp: '/Applications/e-Mate.app',
    currentVersion: '2.0.10',
    targetVersion: '2.0.11',
    stagedApp: '/Applications/.e-Mate-2.0.11-aaaaaaaa.staged.app',
    backupApp: '/Applications/.e-Mate-2.0.10-aaaaaaaa.backup.app',
    failedApp: '/Applications/.e-Mate-2.0.11-aaaaaaaa.failed.app',
    trashApp: '/Users/test/.Trash/e-Mate 2.0.10 Update Backup aaaaaaaa.app',
    receiptPath: '/tmp/update/receipt.json',
    helperReadyPath: '/tmp/update/helper-ready.json',
    shutdownReadyPath: '/tmp/update/shutdown-ready.json',
    ackPath: '/tmp/update/startup-ack.json',
    ackToken: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  }
}

function adapter(events: string[], healthy: () => Promise<void>): MacUpdateSwapAdapter {
  return {
    validateTarget: (path, version) => { events.push(`validate-target:${path}:${version}`) },
    validateInstalled: (path, version) => { events.push(`validate-installed:${path}:${version}`) },
    assertMissing: path => { events.push(`missing:${path}`) },
    rename: (from, to) => { events.push(`rename:${from}:${to}`) },
    remove: path => { events.push(`remove:${path}`) },
    launch: (path, _update, updated) => {
      events.push(`launch:${path}:${updated ? 'update' : 'rollback'}`)
      return { exitCode: null, signalCode: null } as never
    },
    waitForHealthy: async () => { await healthy() },
    writeReceipt: (_update, status) => { events.push(`receipt:${status}`) },
  }
}

afterEach(() => {
  vi.restoreAllMocks()
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('detached macOS update replacement', () => {
  it('moves the validated old app to Trash only after the new app reports healthy', async () => {
    const events: string[] = []
    const update = request()

    await performMacUpdateSwap(update, adapter(events, async () => { events.push('healthy') }))

    expect(events).toEqual([
      `validate-target:${update.stagedApp}:2.0.11`,
      `validate-installed:${update.currentApp}:2.0.10`,
      `missing:${update.backupApp}`,
      `missing:${update.failedApp}`,
      `missing:${update.trashApp}`,
      `rename:${update.currentApp}:${update.backupApp}`,
      `rename:${update.stagedApp}:${update.currentApp}`,
      'receipt:installed-awaiting-health',
      `launch:${update.currentApp}:update`,
      'healthy',
      `rename:${update.backupApp}:${update.trashApp}`,
      'receipt:completed',
    ])
  })

  it('restores and relaunches the old app when healthy startup is not observed', async () => {
    const events: string[] = []
    const update = request()

    await expect(performMacUpdateSwap(update, adapter(events, async () => {
      throw new Error('startup timeout')
    }))).rejects.toThrow('startup timeout')

    expect(events).toEqual(expect.arrayContaining([
      `rename:${update.currentApp}:${update.failedApp}`,
      `rename:${update.backupApp}:${update.currentApp}`,
      `remove:${update.failedApp}`,
      `launch:${update.currentApp}:rollback`,
      'receipt:rolled-back',
    ]))
    expect(events).not.toContain(`rename:${update.backupApp}:${update.trashApp}`)
  })

  it('never rolls back a healthy update when post-commit cleanup fails', async () => {
    const events: string[] = []
    const update = request()
    const base = adapter(events, async () => { events.push('healthy') })
    const operations: MacUpdateSwapAdapter = {
      ...base,
      rename: (from, to) => {
        events.push(`rename:${from}:${to}`)
        if (from === update.backupApp && to === update.trashApp) throw new Error('Trash unavailable')
      },
      remove: path => {
        events.push(`remove:${path}`)
        if (path === update.backupApp) throw new Error('cleanup blocked')
      },
    }

    await expect(performMacUpdateSwap(update, operations)).resolves.toBeUndefined()

    expect(events).toContain('receipt:completed-cleanup-failed')
    expect(events).not.toContain(`rename:${update.currentApp}:${update.failedApp}`)
    expect(events).not.toContain(`launch:${update.currentApp}:rollback`)
  })

  it('writes the update acknowledgement only inside the matching update transaction', () => {
    const root = mkdtempSync(join(tmpdir(), 'e-mate-update-ack-'))
    temporaryRoots.push(root)
    const transaction = join(root, 'updates', '2.0.11', 'install-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')
    mkdirSync(transaction, { recursive: true })
    const path = join(transaction, 'startup-ack.json')
    const token = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

    expect(writeMacUpdateStartupAck(root, '2.0.11', {
      EMATE_MAC_UPDATE_ACK_PATH: path,
      EMATE_MAC_UPDATE_ACK_TOKEN: token,
      EMATE_MAC_UPDATE_ACK_VERSION: '2.0.11',
    })).toEqual({ status: 'installed', currentVersion: '2.0.11', targetVersion: '2.0.11' })

    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual(expect.objectContaining({
      schemaVersion: 1,
      status: 'healthy',
      token,
      version: '2.0.11',
    }))
    expect(() => writeMacUpdateStartupAck(root, '2.0.11', {
      EMATE_MAC_UPDATE_ACK_PATH: join(root, '..', 'startup-ack.json'),
      EMATE_MAC_UPDATE_ACK_TOKEN: token,
      EMATE_MAC_UPDATE_ACK_VERSION: '2.0.11',
    })).toThrow('path is invalid')
  })

  it('reports a persisted rollback after the restored app becomes healthy', async () => {
    const root = mkdtempSync(join(tmpdir(), 'e-mate-update-result-'))
    temporaryRoots.push(root)
    const transaction = join(root, 'updates', '2.0.11', 'install-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')
    mkdirSync(transaction, { recursive: true })
    const path = join(transaction, 'receipt.json')
    const token = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
    writeFileSync(path, JSON.stringify({
      schemaVersion: 1,
      status: 'rolled-back',
      token,
      targetVersion: '2.0.11',
    }))

    await expect(readMacUpdateStartupResult(root, '2.0.10', {
      EMATE_MAC_UPDATE_RESULT_PATH: path,
      EMATE_MAC_UPDATE_RESULT_TOKEN: token,
      EMATE_MAC_UPDATE_RESULT_VERSION: '2.0.11',
    })).resolves.toEqual({ status: 'rolled-back', currentVersion: '2.0.10', targetVersion: '2.0.11' })
  })
})
