export function parseOAuthCallback(value: string, expectedPath: string, state: string): { code?: string; error?: string } {
  const url = new URL(value, 'http://127.0.0.1')
  const allowed = new Set(['code', 'state', 'error', 'error_description'])
  if (url.pathname !== expectedPath
    || [...url.searchParams.keys()].some(key => !allowed.has(key))
    || [...new Set(url.searchParams.keys())].some(key => url.searchParams.getAll(key).length !== 1)
    || url.searchParams.get('state') !== state) {
    throw new Error('Invalid OAuth callback')
  }
  const code = url.searchParams.get('code')
  const error = url.searchParams.get('error')
  if (code !== null && code !== '' && code.length <= 4096 && error === null) return { code }
  if (error !== null && code === null) return { error }
  throw new Error('Invalid OAuth callback')
}
