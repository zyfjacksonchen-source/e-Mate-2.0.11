export const name = 'emate-health'
export const inject = ['webServer', 'jobs']

const BOOT_BRAND = `<style id="e-mate-boot-brand">
#root>[class^="_boot_"]>[class^="_card_"]>[class^="_wordmark_"]{width:105px;height:24px;font-size:0;background:url('/assets/e-mate/logo.png') center/contain no-repeat}
#root>[class^="_boot_"] [class^="_hint_"]{font-size:0}
#root>[class^="_boot_"] [class^="_hint_"]::after{content:'正在加载…';font-size:12px}
body[data-ds-dark-theme] #root>[class^="_boot_"]>[class^="_card_"]>[class^="_wordmark_"]{filter:invert(1) hue-rotate(180deg)}
</style>`

const FAVICON = '<link rel="icon" type="image/png" href="/assets/e-mate/xiaoxin-avatar.png">'
const MANIFEST = '<link rel="manifest" href="/manifest.webmanifest">'

export function brandIndex(html) {
  const branded = html
    .replace(/<title\b[^>]*>[\s\S]*?<\/title>/i, '<title>e-Mate</title>')
    .replace(/<link\b(?=[^>]*\brel=["'][^"']*\bicon\b[^"']*["'])[^>]*>/gi, FAVICON)
  if (!/<\/head>/i.test(branded)) return branded
  return branded.replace(/<\/head>/i, `${BOOT_BRAND}${branded.includes('/assets/e-mate/xiaoxin-avatar.png') ? '' : FAVICON}${branded.includes('/manifest.webmanifest') ? '' : MANIFEST}</head>`)
}

export function apply(ctx) {
  const activeByOwner = new Map()
  const active = job => job.status === 'running' || job.status === 'stopping'
  const sample = owner => {
    const unowned = new Set(ctx.jobs.list().filter(active).map(job => job.id))
    if (owner === undefined) {
      activeByOwner.set('', unowned.size)
      return
    }
    const owned = ctx.jobs.list(owner).filter(job => active(job) && !unowned.has(job.id)).length
    activeByOwner.set(String(owner.id), owned)
  }

  sample(undefined)
  ctx.effect(() => ctx.jobs.onJobsChanged(sample), 'emate-health: active job projection')
  ctx.effect(() => ctx.webServer.tapIndex(brandIndex), 'emate-health: product title, icon and boot brand')
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/api/e-mate/health',
    handler(req, res) {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405, { allow: 'GET, HEAD' })
        res.end()
        return
      }
      const body = JSON.stringify({
        product: 'e-Mate',
        version: '2.0.17',
        instance_id: process.env.EMATE_INSTANCE_ID ?? null,
        profile: 'e-mate',
        active_runs: [...activeByOwner.values()].reduce((sum, count) => sum + count, 0),
      })
      res.writeHead(200, {
        'cache-control': 'no-store',
        'content-type': 'application/json; charset=utf-8',
      })
      res.end(req.method === 'HEAD' ? undefined : body)
    },
  }), 'emate-health: route')
}
