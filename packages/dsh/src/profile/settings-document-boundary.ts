export const name = 'emate-settings-document-boundary'
export const inject = ['settings']

export function apply(ctx: any) {
  ctx.effect(() => {
    const settings = ctx.settings
    const documentPath = Object.getOwnPropertyDescriptor(settings, 'documentPath')
    const prepareDocument = Object.getOwnPropertyDescriptor(settings, 'prepareDocument')

    Object.defineProperties(settings, {
      documentPath: { configurable: true, get: () => undefined },
      prepareDocument: { configurable: true, value: () => Promise.resolve(undefined) },
    })

    return () => {
      if (documentPath === undefined) delete settings.documentPath
      else Object.defineProperty(settings, 'documentPath', documentPath)
      if (prepareDocument === undefined) delete settings.prepareDocument
      else Object.defineProperty(settings, 'prepareDocument', prepareDocument)
    }
  }, 'e-Mate: browser settings document boundary')
}
