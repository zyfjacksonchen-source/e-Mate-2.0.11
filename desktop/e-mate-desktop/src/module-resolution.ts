/** Profile-relative package resolution for Electron's restricted Node runtime. */

import { registerHooks } from 'node:module'
import { resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'

const LOADER_ENTRY_URL = import.meta.resolve('@deepseek-ai/cordis-plugin-loader')
const DESKTOP_ENTRY_URL = new URL('../lib/index.js', import.meta.url).href
const DESKTOP_PACKAGE_NAME = '@e-mate/desktop'

/** Return whether a Loader request needs Node package resolution. */
function isBareSpecifier(specifier: string): boolean {
  return !specifier.startsWith('.') && !specifier.startsWith('/') && !URL.canParse(specifier)
}

/** Stable runtime packages supplied by the pinned DSH Desktop Base, never by a hot component. */
export function isBaseProfileRuntimeSpecifier(specifier: string): boolean {
  return /^@deepseek-ai\/[a-z0-9][a-z0-9._-]*(?:\/.*)?$/u.test(specifier)
    || /^(?:react|react-dom)(?:\/.*)?$/u.test(specifier)
}

/**
 * Resolve Cordis Loader bare imports from the selected persistent profile.
 * @param profileBaseUrl - file URL inside the profile that owns plugin dependencies.
 * @returns an idempotent hook disposer.
 */
export function installProfilePackageResolver(
  profileBaseUrl: string,
  componentRoots: Iterable<string> = [],
): () => void {
  const componentPrefixes = [...componentRoots].map(root => pathToFileURL(`${resolve(root)}${sep}`).href)
  const hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
      const fromLoader = context.parentURL === LOADER_ENTRY_URL
      if (fromLoader && specifier === DESKTOP_PACKAGE_NAME) {
        return { shortCircuit: true, url: DESKTOP_ENTRY_URL }
      }
      if (!fromLoader || !isBareSpecifier(specifier)) {
        const fromHotComponent = context.parentURL !== undefined
          && componentPrefixes.some(prefix => context.parentURL!.startsWith(prefix))
        if (!fromHotComponent || !isBareSpecifier(specifier) || !isBaseProfileRuntimeSpecifier(specifier)) {
          return nextResolve(specifier, context)
        }
        return nextResolve(specifier, { ...context, parentURL: DESKTOP_ENTRY_URL })
      }
      return nextResolve(specifier, { ...context, parentURL: profileBaseUrl })
    },
  })
  let active = true
  return () => {
    if (!active) return
    active = false
    hooks.deregister()
  }
}
