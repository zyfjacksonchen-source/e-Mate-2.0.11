import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('.', import.meta.url))

export default {
  root,
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'chrome116',
    lib: { entry: 'src/background/index.ts', formats: ['es'], fileName: () => 'background.js' },
  },
}
