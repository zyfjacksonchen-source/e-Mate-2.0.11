// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { DesktopThemePresenter } from '../src/client/theme-presenter.ts'

afterEach(() => {
  document.documentElement.removeAttribute('style')
  document.body.removeAttribute('style')
  document.body.removeAttribute('data-ds-dark-theme')
  document.head.querySelectorAll('meta[name="theme-color"]').forEach(element => { element.remove() })
})

describe('Desktop theme presenter', () => {
  it('projects resolved light/dark/system snapshots and disposes only its own DOM state', () => {
    const presenter = new DesktopThemePresenter()
    document.body.style.setProperty('--outside-owner', 'keep')
    document.body.style.backgroundColor = 'rgb(250, 250, 250)'
    presenter.apply({ active: { colorScheme: 'light', tokens: { '--owned-light': '#fff' } } } as never)
    expect(document.documentElement.style.colorScheme).toBe('light')
    expect(document.body.hasAttribute('data-ds-dark-theme')).toBe(false)
    expect(document.body.style.getPropertyValue('--owned-light')).toBe('#fff')
    expect(document.body.style.getPropertyValue('--dsh-desktop-caption-symbol-color')).toBe('#2f3337')
    expect(document.head.querySelector('meta[name="theme-color"]')?.getAttribute('content')).toBe('rgb(250, 250, 250)')

    document.body.style.backgroundColor = 'rgb(20, 20, 20)'
    presenter.apply({ active: { colorScheme: 'dark', tokens: { '--owned-dark': '#000' } } } as never)
    expect(document.documentElement.style.colorScheme).toBe('dark')
    expect(document.body.hasAttribute('data-ds-dark-theme')).toBe(true)
    expect(document.body.style.getPropertyValue('--owned-light')).toBe('')
    expect(document.body.style.getPropertyValue('--owned-dark')).toBe('#000')
    expect(document.body.style.getPropertyValue('--dsh-desktop-caption-symbol-color')).toBe('#f5f5f5')

    presenter.dispose()
    expect(document.documentElement.style.colorScheme).toBe('')
    expect(document.body.hasAttribute('data-ds-dark-theme')).toBe(false)
    expect(document.body.style.getPropertyValue('--owned-dark')).toBe('')
    expect(document.body.style.getPropertyValue('--dsh-desktop-caption-symbol-color')).toBe('')
    expect(document.body.style.getPropertyValue('--outside-owner')).toBe('keep')
    expect(document.head.querySelector('meta[name="theme-color"]')).toBeNull()
  })
})
