import { join } from 'node:path'

const root = import.meta.dirname

export default {
  entry: { index: join(root, 'lib/index.js') },
  outDir: join(root, '.runtime-bundle'),
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: true,
  deps: {
    neverBundle: [/^@deepseek-ai\//],
    alwaysBundle: ['yaml'],
    onlyBundle: false,
  },
}
