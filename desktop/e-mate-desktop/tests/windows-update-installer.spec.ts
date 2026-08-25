import { EventEmitter } from 'node:events'
import {
  createHash,
  randomUUID,
} from 'node:crypto'
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ChildProcess } from 'node:child_process'
import {
  beginWindowsUpdateCandidateStartup,
  completeWindowsUpdateCandidateStartup,
  admittedWindowsUpdateIdentity,
  parseWindowsUpdateRequest,
  recoverStaleWindowsUpdatePending,
  scheduleWindowsUpdateInstallation,
  type WindowsUpdateRequest,
  type WindowsUpdateRuntimeAdapter,
} from '../src/windows-update-installer.ts'

const roots: string[] = []
const sourceCommit = 'a'.repeat(40)
const manifestIdentity = 'b'.repeat(64)
const ownerSid = 'S-1-5-21-1000-1001-1002-1003'

function root(): string {
  const path = mkdtempSync(join(tmpdir(), 'emate-windows-update-'))
  roots.push(path)
  return path
}

function sha256(bytes: string | Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function child(): ChildProcess {
  const process = new EventEmitter() as EventEmitter & { unref: ReturnType<typeof vi.fn> }
  process.unref = vi.fn()
  return process as unknown as ChildProcess
}

function fixture(): {
  readonly home: string
  readonly userData: string
  readonly canonical: string
  readonly executable: string
  readonly installer: string
  readonly artifact: { url: string; bytes: number; sha256: string }
} {
  const home = root()
  const userData = join(home, 'user-data')
  const canonical = join(home, 'Programs', 'e-Mate')
  const executable = join(canonical, 'e-Mate.exe')
  const installer = join(userData, 'downloads', 'e-Mate-2.1.0-win-x64-Setup.exe')
  mkdirSync(dirname(installer), { recursive: true })
  mkdirSync(canonical, { recursive: true })
  writeFileSync(executable, 'old-executable')
  writeFileSync(installer, 'signed-setup')
  const bytes = readFileSync(installer)
  return {
    home,
    userData,
    canonical,
    executable,
    installer,
    artifact: {
      url: `https://pub-ada3f610c0234a76838f4e19fe2bb25e.r2.dev/desktop/releases/v2.1.0/${sourceCommit}/e-Mate-2.1.0-win-x64-Setup.exe`,
      bytes: bytes.byteLength,
      sha256: sha256(bytes),
    },
  }
}

function ready(request: WindowsUpdateRequest): Record<string, unknown> {
  return {
    schemaVersion: 1,
    documentType: 'emate.windows-update-ready',
    transactionId: request.transactionId,
    token: request.token,
    targetVersion: request.targetVersion,
    sourceCommit: request.sourceCommit,
    baseContractId: request.baseContractId,
    scheduleProtocolFloor: request.scheduleProtocolFloor,
    manifestIdentity: request.manifestIdentity,
    artifact: request.artifact,
    canonicalDirectory: request.canonicalDirectory,
    transactionRoot: request.transactionRoot,
    setupPid: 42,
  }
}

function candidateJournal(
  request: WindowsUpdateRequest,
  candidateExecutableSha256: string,
  phase = 'candidate-at-canonical',
): Record<string, unknown> {
  const candidateDirectory = join(request.transactionRoot, 'candidate')
  return {
    schemaVersion: 1,
    documentType: 'emate.windows-update-journal',
    phase,
    transactionId: request.transactionId,
    token: request.token,
    currentVersion: request.currentVersion,
    targetVersion: request.targetVersion,
    sourceCommit: request.sourceCommit,
    baseContractId: request.baseContractId,
    scheduleProtocolFloor: request.scheduleProtocolFloor,
    manifestIdentity: request.manifestIdentity,
    artifact: request.artifact,
    installMode: 'CurrentUser',
    canonicalDirectory: request.canonicalDirectory,
    transactionRoot: request.transactionRoot,
    candidateDirectory,
    lastGoodDirectory: join(request.transactionRoot, 'last-good'),
    failedDirectory: join(request.transactionRoot, 'failed'),
    candidateExecutable: join(candidateDirectory, 'e-Mate.exe'),
    candidateExecutableSha256,
    updatedAt: new Date().toISOString(),
  }
}

function adapter(
  onSpawn?: (request: WindowsUpdateRequest) => void,
  pendingOwnerIsLive: (request: WindowsUpdateRequest) => boolean = () => true,
): WindowsUpdateRuntimeAdapter {
  return {
    platform: 'win32',
    ownerSid: () => ownerSid,
    secureDirectory: vi.fn(),
    pendingOwnerIsLive,
    spawnInstaller: (_path, args) => {
      const requestPath = args.find(value => value.startsWith('--emate-update-request='))!.split('=')[1]!
      const token = args.find(value => value.startsWith('--emate-update-token='))!.split('=')[1]!
      const request = parseWindowsUpdateRequest(JSON.parse(readFileSync(requestPath, 'utf8')), requestPath, token)
      onSpawn?.(request)
      return child()
    },
  }
}

async function schedule(
  files: ReturnType<typeof fixture>,
  runtime: WindowsUpdateRuntimeAdapter,
  overrides: Partial<Parameters<typeof scheduleWindowsUpdateInstallation>[0]> = {},
) {
  return scheduleWindowsUpdateInstallation({
    installerPath: files.installer,
    currentExecutable: files.executable,
    userDataPath: files.userData,
    currentVersion: '2.0.12',
    targetVersion: '2.1.0',
    sourceCommit,
    baseContractId: 'e-mate-desktop-profile-v7',
    scheduleProtocolFloor: 1,
    manifestIdentity,
    artifact: files.artifact,
    parentPid: 41,
    readyTimeoutMs: 50,
    ...overrides,
  }, runtime)
}

afterEach(() => {
  for (const path of roots.splice(0)) rmSync(path, { recursive: true, force: true })
})

describe('Windows Base update private handshake', () => {
  it('does not authorize shutdown until Setup writes the exact READY identity', async () => {
    const files = fixture()
    await expect(schedule(files, adapter(), { readyTimeoutMs: 5 }))
      .rejects.toThrow('did not reach READY')
    expect(readFileSync(join(files.userData, 'updates', 'windows-base', 'pending.json'), 'utf8'))
      .toContain('requestPath')

    const prepared = await schedule(fixture(), adapter((request) => {
      writeFileSync(join(request.mailboxPath, 'ready.json'), JSON.stringify(ready(request)))
    }))
    expect(() => readFileSync(join(prepared.request.mailboxPath, 'shutdown.json'))).toThrow()
    prepared.markShutdownReady()
    expect(JSON.parse(readFileSync(join(prepared.request.mailboxPath, 'shutdown.json'), 'utf8')))
      .toMatchObject({ transactionId: prepared.request.transactionId, parentPid: 41 })
  })

  it('rejects a forged READY token or admitted identity before shutdown', async () => {
    for (const forge of [
      (request: WindowsUpdateRequest) => ({ ...ready(request), token: randomUUID() }),
      (request: WindowsUpdateRequest) => ({ ...ready(request), baseContractId: 'forged-base' }),
    ]) {
      let request: WindowsUpdateRequest | undefined
      await expect(schedule(fixture(), adapter((spawned) => {
        request = spawned
        writeFileSync(join(spawned.mailboxPath, 'ready.json'), JSON.stringify(forge(spawned)))
      }))).rejects.toThrow('READY receipt is invalid')
      expect(() => readFileSync(join(request!.mailboxPath, 'shutdown.json'))).toThrow()
    }
  })

  it('rejects a changed installer hash, a downgrade, and missing admitted identity', async () => {
    const files = fixture()
    writeFileSync(files.installer, 'tampered-setup')
    await expect(schedule(files, adapter())).rejects.toThrow('hash or size changed')
    await expect(schedule(fixture(), adapter(), { targetVersion: '2.0.11' }))
      .rejects.toThrow('identity is invalid')
    await expect(schedule(fixture(), adapter(), { manifestIdentity: '' }))
      .rejects.toThrow('identity is invalid')
  })

  it('allows only one pending transaction in the fixed user mailbox', async () => {
    const files = fixture()
    const first = await schedule(files, adapter((request) => {
      writeFileSync(join(request.mailboxPath, 'ready.json'), JSON.stringify(ready(request)))
    }))
    await expect(schedule(files, adapter((request) => {
      writeFileSync(join(request.mailboxPath, 'ready.json'), JSON.stringify(ready(request)))
    }))).rejects.toThrow('transaction is active')
    expect(readFileSync(first.request.pendingPath, 'utf8')).toContain(first.request.transactionId)
  })

  it('reclaims only an exact stale pre-Setup owner and preserves physical recovery', async () => {
    const files = fixture()
    const first = await schedule(files, adapter((request) => {
      writeFileSync(join(request.mailboxPath, 'ready.json'), JSON.stringify(ready(request)))
    }))
    const mailboxRoot = dirname(first.request.pendingPath)
    expect(recoverStaleWindowsUpdatePending(mailboxRoot, adapter(undefined, () => false))).toBe(true)
    expect(() => readFileSync(first.request.pendingPath)).toThrow()

    const second = await schedule(files, adapter((request) => {
      writeFileSync(join(request.mailboxPath, 'ready.json'), JSON.stringify(ready(request)))
    }))
    mkdirSync(second.request.transactionRoot, { recursive: true })
    expect(() => recoverStaleWindowsUpdatePending(mailboxRoot, adapter(undefined, () => false)))
      .toThrow('requires Setup recovery')
    expect(readFileSync(second.request.pendingPath, 'utf8')).toContain(second.request.transactionId)
  })

  it('isolates physical roots and stale cleanup for two transaction owners', async () => {
    const firstFiles = fixture()
    const secondUserData = join(firstFiles.home, 'second-user-data')
    mkdirSync(secondUserData)
    const secondFiles = { ...firstFiles, userData: secondUserData }
    const first = await schedule(firstFiles, adapter((request) => {
      writeFileSync(join(request.mailboxPath, 'ready.json'), JSON.stringify(ready(request)))
    }))
    const second = await schedule(secondFiles, adapter((request) => {
      writeFileSync(join(request.mailboxPath, 'ready.json'), JSON.stringify(ready(request)))
    }))

    expect(first.request.transactionRoot).not.toBe(second.request.transactionRoot)
    expect(first.request.transactionRoot).toContain(first.request.transactionId)
    expect(second.request.transactionRoot).toContain(second.request.transactionId)
    expect(recoverStaleWindowsUpdatePending(dirname(first.request.pendingPath), adapter(undefined, () => false))).toBe(true)
    expect(readFileSync(second.request.pendingPath, 'utf8')).toContain(second.request.transactionId)
    expect(readFileSync(join(second.request.mailboxPath, 'request.json'), 'utf8')).toContain(second.request.token)
  })

  it('rejects request path escape and identity substitution', async () => {
    const files = fixture()
    const prepared = await schedule(files, adapter((request) => {
      writeFileSync(join(request.mailboxPath, 'ready.json'), JSON.stringify(ready(request)))
    }))
    const requestPath = join(prepared.request.mailboxPath, 'request.json')
    expect(() => parseWindowsUpdateRequest(
      { ...prepared.request, transactionRoot: join(files.canonical, 'nested') },
      requestPath,
      prepared.request.token,
    )).toThrow('path or identity')
    expect(() => parseWindowsUpdateRequest(
      { ...prepared.request, baseContractId: 'other-base' },
      requestPath,
      '00000000-0000-4000-8000-000000000000',
    )).toThrow('request is invalid')
    expect(() => parseWindowsUpdateRequest(
      prepared.request,
      requestPath,
      randomUUID(),
    )).toThrow('request is invalid')
    expect(() => parseWindowsUpdateRequest(
      { ...prepared.request, transactionId: '11111111-1111-1111-1111-111111111111' },
      requestPath,
      prepared.request.token,
    )).toThrow('request is invalid')
  })

  it('requires every admitted consumer identity field without a fallback', () => {
    expect(admittedWindowsUpdateIdentity({
      sourceCommit,
      baseContractId: 'e-mate-desktop-profile-v7',
      scheduleProtocolFloor: 1,
      manifestIdentity,
    })).toEqual({
      sourceCommit,
      baseContractId: 'e-mate-desktop-profile-v7',
      scheduleProtocolFloor: 1,
      manifestIdentity,
    })
    for (const key of ['sourceCommit', 'baseContractId', 'scheduleProtocolFloor', 'manifestIdentity']) {
      const identity: Record<string, unknown> = {
        sourceCommit,
        baseContractId: 'e-mate-desktop-profile-v7',
        scheduleProtocolFloor: 1,
        manifestIdentity,
      }
      delete identity[key]
      expect(() => admittedWindowsUpdateIdentity(identity)).toThrow('identity is incomplete')
    }
  })

  it('does not treat public updater flags as candidate authority', async () => {
    await expect(beginWindowsUpdateCandidateStartup({
      platform: 'win32',
      argv: ['e-Mate.exe', '--updated', '--force-run'],
    })).resolves.toBeUndefined()
    await expect(beginWindowsUpdateCandidateStartup({
      platform: 'win32',
      argv: ['e-Mate.exe', `--emate-update-token=${randomUUID()}`],
    })).rejects.toThrow('incomplete Windows update candidate identity')
  })

  it('binds candidate path, hash, version and rejects a repeated startup', async () => {
    const files = fixture()
    const prepared = await schedule(files, adapter((request) => {
      writeFileSync(join(request.mailboxPath, 'ready.json'), JSON.stringify(ready(request)))
    }))
    mkdirSync(prepared.request.transactionRoot, { recursive: true })
    const candidateHash = sha256(readFileSync(files.executable))
    writeFileSync(join(prepared.request.transactionRoot, 'journal.json'), JSON.stringify(
      candidateJournal(prepared.request, candidateHash),
    ))
    const argv = [
      files.executable,
      `--emate-update-request=${join(prepared.request.mailboxPath, 'request.json')}`,
      `--emate-update-token=${prepared.request.token}`,
    ]
    writeFileSync(join(prepared.request.transactionRoot, 'journal.json'), JSON.stringify({
      ...candidateJournal(prepared.request, candidateHash),
      manifestIdentity: 'c'.repeat(64),
    }))
    await expect(beginWindowsUpdateCandidateStartup({
      platform: 'win32', argv, currentExecutable: files.executable, currentVersion: '2.1.0',
    })).rejects.toThrow('candidate journal is invalid')
    writeFileSync(join(prepared.request.transactionRoot, 'journal.json'), JSON.stringify(
      candidateJournal(prepared.request, candidateHash),
    ))
    const session = await beginWindowsUpdateCandidateStartup({
      platform: 'win32', argv, currentExecutable: files.executable, currentVersion: '2.1.0',
    })
    expect(session?.executableSha256).toBe(candidateHash)
    await expect(beginWindowsUpdateCandidateStartup({
      platform: 'win32', argv, currentExecutable: files.executable, currentVersion: '2.1.0',
    })).rejects.toMatchObject({ code: 'EEXIST' })
    await expect(beginWindowsUpdateCandidateStartup({
      platform: 'win32', argv, currentExecutable: files.executable, currentVersion: '2.0.12',
    })).rejects.toThrow('path or version')
    writeFileSync(join(prepared.request.transactionRoot, 'journal.json'), JSON.stringify(
      candidateJournal(prepared.request, candidateHash, 'confirmed-unknown'),
    ))
    rmSync(join(prepared.request.mailboxPath, 'started.json'))
    await expect(beginWindowsUpdateCandidateStartup({
      platform: 'win32', argv, currentExecutable: files.executable, currentVersion: '2.1.0',
    })).resolves.toMatchObject({ executableSha256: candidateHash })
  })

  it('requires exact Base identity before ACK and exact Setup confirmation before APPLIED', async () => {
    const files = fixture()
    const prepared = await schedule(files, adapter((request) => {
      writeFileSync(join(request.mailboxPath, 'ready.json'), JSON.stringify(ready(request)))
    }))
    mkdirSync(prepared.request.transactionRoot, { recursive: true })
    const candidateHash = sha256(readFileSync(files.executable))
    writeFileSync(join(prepared.request.transactionRoot, 'journal.json'), JSON.stringify(
      candidateJournal(prepared.request, candidateHash),
    ))
    const session = await beginWindowsUpdateCandidateStartup({
      platform: 'win32',
      argv: [files.executable,
        `--emate-update-request=${join(prepared.request.mailboxPath, 'request.json')}`,
        `--emate-update-token=${prepared.request.token}`],
      currentExecutable: files.executable,
      currentVersion: '2.1.0',
    })
    await expect(completeWindowsUpdateCandidateStartup(session, {
      id: 'wrong-base', scheduleProtocolFloor: 1,
    }, 5)).rejects.toThrow('Base identity')

    const completion = completeWindowsUpdateCandidateStartup(session, {
      id: prepared.request.baseContractId,
      scheduleProtocolFloor: prepared.request.scheduleProtocolFloor,
    }, 500)
    await new Promise(resolve => setTimeout(resolve, 10))
    writeFileSync(join(prepared.request.mailboxPath, 'confirmation.json'), JSON.stringify({
      schemaVersion: 1,
      documentType: 'emate.windows-update-confirmed',
      transactionId: prepared.request.transactionId,
      token: prepared.request.token,
      targetVersion: prepared.request.targetVersion,
      sourceCommit: prepared.request.sourceCommit,
      baseContractId: prepared.request.baseContractId,
      scheduleProtocolFloor: prepared.request.scheduleProtocolFloor,
      manifestIdentity: prepared.request.manifestIdentity,
      artifact: prepared.request.artifact,
      canonicalDirectory: prepared.request.canonicalDirectory,
      transactionRoot: prepared.request.transactionRoot,
      confirmedAt: new Date().toISOString(),
    }))
    await completion
    expect(JSON.parse(readFileSync(join(prepared.request.mailboxPath, 'applied.json'), 'utf8')))
      .toMatchObject({ transactionId: prepared.request.transactionId, executableSha256: candidateHash })
  })
})
