/** Platform support reported to the e-Mate capability projection. */
export interface PlatformSupport {
  status: 'ready' | 'setup-required' | 'blocked'
  code?: 'PLAYWRIGHT_MCP_EDGE_UNVERIFIED' | 'EGO_BROWSER_RUNTIME_UNVERIFIED' | 'EGO_BROWSER_UNSUPPORTED_PLATFORM'
}

/** Audited Windows replacement candidate. It remains disabled until its isolation contract is verified. */
export const WINDOWS_EDGE_CANDIDATE = Object.freeze({
  repository: 'https://github.com/microsoft/playwright-mcp',
  tag: 'v0.0.78',
  commit: '5f8fc00210b27b4407c375b59cda4838045d429c',
  package: '@playwright/mcp',
  version: '0.0.78',
  license: 'Apache-2.0',
  browser: 'msedge',
  activation: 'disabled-until-windows-and-project-isolation-validation',
} as const)

/** Resolve the pinned ego-lite platform contract without a fallback browser. */
export function supportForPlatform(platform: NodeJS.Platform): PlatformSupport {
  if (platform === 'darwin') {
    return { status: 'setup-required', code: 'EGO_BROWSER_RUNTIME_UNVERIFIED' }
  }
  if (platform === 'win32') {
    return { status: 'setup-required', code: 'PLAYWRIGHT_MCP_EDGE_UNVERIFIED' }
  }
  return { status: 'blocked', code: 'EGO_BROWSER_UNSUPPORTED_PLATFORM' }
}
