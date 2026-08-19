/** Profile-relative package resolution for Electron's restricted Node runtime. */

import { readFileSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { join, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'

const LOADER_ENTRY_URL = import.meta.resolve('@deepseek-ai/cordis-plugin-loader')
const DESKTOP_ENTRY_URL = new URL('../lib/index.js', import.meta.url).href
const DESKTOP_PACKAGE_NAME = '@e-mate/desktop'
const BASE_RUNTIME_PACKAGE = /^(?:@deepseek-ai\/[a-z0-9][a-z0-9._-]*|react(?:-dom)?)(?:\/|$)/u

/** Return whether a Loader request needs Node package resolution. */
function isBareSpecifier(specifier: string): boolean {
  return !specifier.startsWith('.') && !specifier.startsWith('/') && !URL.canParse(specifier)
}

function baseRuntimePackage(specifier: string): string | undefined {
  const match = BASE_RUNTIME_PACKAGE.exec(specifier)
  return match?.[0].replace(/\/$/u, '')
}

/** Stable runtime packages supplied by the pinned Base only when the component declares them. */
export function isBaseProfileRuntimeSpecifier(
  specifier: string,
  allowedImports: ReadonlySet<string>,
): boolean {
  const name = baseRuntimePackage(specifier)
  return name !== undefined && allowedImports.has(name)
}

function componentBaseImports(root: string, baseRuntimeImports: Readonly<Record<string, string>>): Set<string> {
  let value: unknown
  try { value = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) } catch {
    throw new Error(`hot Profile component package contract is invalid: ${root}`)
  }
  const component = value !== null && typeof value === 'object' && !Array.isArray(value)
    && 'eMate' in value && value.eMate !== null && typeof value.eMate === 'object' && !Array.isArray(value.eMate)
    && 'component' in value.eMate && value.eMate.component !== null
    && typeof value.eMate.component === 'object' && !Array.isArray(value.eMate.component)
    ? value.eMate.component as Record<string, unknown>
    : undefined
  const imports = component?.base_imports
  if (!Array.isArray(imports)
    || imports.some(name => typeof name !== 'string' || !Object.hasOwn(baseRuntimeImports, name))
    || imports.some((name, index) => index > 0 && imports[index - 1] >= name)) {
    throw new Error(`hot Profile component Base imports are invalid: ${root}`)
  }
  return new Set(imports as string[])
}

/**
 * Resolve Cordis Loader bare imports from the selected persistent profile.
 * @param profileBaseUrl - file URL inside the profile that owns plugin dependencies.
 * @returns an idempotent hook disposer.
 */
export function installProfilePackageResolver(
  profileBaseUrl: string,
  componentRoots: Iterable<string> = [],
  baseRuntimeImports: Readonly<Record<string, string>> = {},
): () => void {
  const components = [...componentRoots].map(root => ({
    prefix: pathToFileURL(`${resolve(root)}${sep}`).href,
    imports: componentBaseImports(root, baseRuntimeImports),
  }))
  const hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
      const fromLoader = context.parentURL === LOADER_ENTRY_URL
      if (fromLoader && specifier === DESKTOP_PACKAGE_NAME) {
        return { shortCircuit: true, url: DESKTOP_ENTRY_URL }
      }
      if (context.parentURL !== undefined && isBareSpecifier(specifier)) {
        const component = components.find(candidate => context.parentURL!.startsWith(candidate.prefix))
        if (component !== undefined && isBaseProfileRuntimeSpecifier(specifier, component.imports)) {
          return nextResolve(specifier, { ...context, parentURL: DESKTOP_ENTRY_URL })
        }
      }
      if (fromLoader && isBareSpecifier(specifier)) {
        return nextResolve(specifier, { ...context, parentURL: profileBaseUrl })
      }
      return nextResolve(specifier, context)
    },
  })
  let active = true
  return () => {
    if (!active) return
    active = false
    hooks.deregister()
  }
}
