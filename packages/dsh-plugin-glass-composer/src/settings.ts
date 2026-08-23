import z from '@deepseek-ai/schemastery'

export const GLASS_SETTINGS_NAMESPACE = 'e-mate-glass-composer'
export const PALETTE_FIELD = 'palette'
export const GLASS_PALETTES = ['brand', 'rgb', 'violet', 'cyan-pink', 'off'] as const
export const DEFAULT_GLASS_PALETTE: GlassPalette = 'brand'

export type GlassPalette = typeof GLASS_PALETTES[number]

export interface GlassSettings {
  palette: GlassPalette
}

export const GlassSettingsSchema: z<GlassSettings> = z.object({
  [PALETTE_FIELD]: z.union([...GLASS_PALETTES]).default(DEFAULT_GLASS_PALETTE),
})

export function isGlassPalette(value: unknown): value is GlassPalette {
  return GLASS_PALETTES.some(palette => palette === value)
}
