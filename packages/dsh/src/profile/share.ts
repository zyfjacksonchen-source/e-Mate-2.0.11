export const name = 'emate-share'
export const inject = ['connection']
export const SHARE_CHANNEL = '/emate.share'

const badRequest = (message: string) => ({
  ok: false,
  error: { code: 'bad-request', message, details: { issues: [] } },
})

/**
 * Own the local public-share capability boundary. The pinned Harness has a
 * real Session ZIP export, but no public immutable-share provider; report that
 * distinction explicitly until the verified Cloud Share adapter is composed.
 */
export function apply(ctx: any): void {
  ctx.effect(() => ctx.connection.rpc.handle(
    SHARE_CHANNEL,
    async (endpoint: string, payload: unknown) => {
      if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
        return badRequest('e-Mate share payload must be an object')
      }
      if (endpoint !== 'status' || Object.keys(payload).length !== 0) {
        return badRequest('e-Mate public share provider is unavailable')
      }
      return {
        ok: true,
        value: {
          schema_version: 1,
          ready: false,
          blocker: 'public-share-provider-not-configured',
        },
      }
    },
    { authority: 'loopback' },
  ), 'emate.share: fail-closed public-share capability')
}
