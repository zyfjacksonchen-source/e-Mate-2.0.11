import type { ThemeSnapshot } from '@deepseek-ai/dsh-client-ui-theme/client'
import { WINDOWS_CAPTION_SYMBOL_DARK, WINDOWS_CAPTION_SYMBOL_LIGHT } from '../window-options.ts'

const DARK_ATTRIBUTE = 'data-ds-dark-theme'
const CAPTION_SYMBOL = '--dsh-desktop-caption-symbol-color'

/** Projects the resolved theme service snapshot onto the desktop document. */
export class DesktopThemePresenter {
  private appliedTokens: string[] = []
  private readonly themeColorMeta = document.createElement('meta')

  constructor() {
    this.themeColorMeta.name = 'theme-color'
  }

  /** @param snapshot - current resolved palette and token overrides. */
  apply(snapshot: ThemeSnapshot): void {
    const scheme = snapshot.active.colorScheme
    document.documentElement.style.colorScheme = scheme
    if (scheme === 'dark') document.body.setAttribute(DARK_ATTRIBUTE, '')
    else document.body.removeAttribute(DARK_ATTRIBUTE)
    for (const name of this.appliedTokens) document.body.style.removeProperty(name)
    this.appliedTokens = []
    for (const [name, value] of Object.entries(snapshot.active.tokens)) {
      document.body.style.setProperty(name, value)
      this.appliedTokens.push(name)
    }
    document.body.style.setProperty(CAPTION_SYMBOL, scheme === 'dark'
      ? WINDOWS_CAPTION_SYMBOL_DARK
      : WINDOWS_CAPTION_SYMBOL_LIGHT)
    this.themeColorMeta.content = getComputedStyle(document.body).backgroundColor
    if (!this.themeColorMeta.isConnected) document.head.appendChild(this.themeColorMeta)
  }

  /** Remove only DOM state owned by this presenter. */
  dispose(): void {
    document.documentElement.style.removeProperty('color-scheme')
    document.body.removeAttribute(DARK_ATTRIBUTE)
    for (const name of this.appliedTokens) document.body.style.removeProperty(name)
    this.appliedTokens = []
    document.body.style.removeProperty(CAPTION_SYMBOL)
    this.themeColorMeta.remove()
  }
}
