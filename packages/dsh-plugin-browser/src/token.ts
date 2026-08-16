import { randomBytes } from 'node:crypto'
import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

const TOKEN = /^[A-Za-z0-9_-]{43}$/u

export function tokenPath(environment: NodeJS.ProcessEnv = process.env): string {
  const dshHome = resolve(environment.DSH_HOME || join(homedir(), '.dsh'))
  return join(dshHome, 'e-mate', 'run', 'browser-bridge-token')
}

export async function resolveToken(path = tokenPath()): Promise<string> {
  try {
    const value = (await readFile(path, 'utf8')).trim()
    if (!TOKEN.test(value)) throw new Error('stored browser bridge token is invalid')
    await chmod(path, 0o600)
    return value
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  const value = randomBytes(32).toString('base64url')
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.${process.pid}.tmp`
  await writeFile(temporary, `${value}\n`, { mode: 0o600, flag: 'wx' })
  try {
    await rename(temporary, path)
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    return await resolveToken(path)
  }
  await chmod(path, 0o600)
  return value
}
