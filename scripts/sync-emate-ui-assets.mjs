import { copyFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const source = resolve(root, 'upstream/e-mate-2.0.5/desktop/src/v1/assets')
const local = resolve(root, 'packages/dsh/src/profile/emate-shell/assets')
const target = resolve(root, 'packages/dsh/profile/plugins/emate-shell/assets')

mkdirSync(target, { recursive: true })
for (const name of [
  'e-mate-team-hero-transparent.png',
  'emate-logo.png',
  'emate-mark.png',
  'xiaoxin-avatar.png',
]) copyFileSync(resolve(source, name), resolve(target, name))
copyFileSync(resolve(local, 'lucide-send.svg'), resolve(target, 'lucide-send.svg'))
