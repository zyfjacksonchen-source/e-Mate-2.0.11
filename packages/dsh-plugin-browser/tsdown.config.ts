export default {
  entry: ['src/index.ts', 'src/protocol.ts'],
  format: 'esm',
  dts: true,
  clean: true,
  outDir: 'lib',
  deps: {
    neverBundle: [/^@deepseek-ai\//],
    alwaysBundle: ['ws'],
    onlyBundle: ['ws'],
  },
}
