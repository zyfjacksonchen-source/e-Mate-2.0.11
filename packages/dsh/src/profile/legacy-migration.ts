import { closeSync, createReadStream } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { migrateLegacySessions, openLegacyArtifactObject } from '../legacy-migration.js'

export const name = 'emate-legacy-migration'
export const inject = ['sessionPersistence', 'webServer']

export function registerLegacyArtifactDownload(ctx, dshHome) {
  return ctx.webServer.register({
    kind: 'exact',
    path: '/api/e-mate/legacy-artifact.download',
    handler(req, res) {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405, { Allow: 'GET, HEAD' })
        res.end()
        return
      }
      const ids = new URL(req.url ?? '/', 'http://127.0.0.1').searchParams.getAll('id')
      if (ids.length !== 1 || !/^[0-9a-f]{64}$/u.test(ids[0])) {
        res.writeHead(400)
        res.end('invalid legacy artifact id')
        return
      }
      let opened
      try {
        opened = openLegacyArtifactObject(dshHome, ids[0])
      } catch {
        res.writeHead(404)
        res.end('legacy artifact unavailable')
        return
      }
      res.writeHead(200, {
        'Content-Type': 'application/octet-stream',
        'Content-Length': String(opened.size),
        'Content-Disposition': `attachment; filename="e-Mate-legacy-${ids[0].slice(0, 12)}"`,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      })
      if (req.method === 'HEAD' || opened.size === 0) {
        closeSync(opened.descriptor)
        res.end()
        return
      }
      const stream = createReadStream('', { fd: opened.descriptor, autoClose: true, start: 0, end: opened.size - 1 })
      stream.once('error', () => { res.destroy() })
      stream.pipe(res)
    },
  })
}

export function apply(ctx) {
  const dshHome = resolve(process.env.DSH_HOME || join(homedir(), '.dsh'))
  ctx.effect(() => registerLegacyArtifactDownload(ctx, dshHome), 'emate legacy artifact download')
  ctx.effect(async () => {
    await migrateLegacySessions({ sessionPersistence: ctx.sessionPersistence, dshHome })
  })
}
