import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('.', import.meta.url))

export default {
  root,
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    target: 'chrome116',
    lib: { entry: 'src/content/index.ts', formats: ['iife'], name: 'EMateBrowserContent', fileName: () => 'content.js' },
  },
}
