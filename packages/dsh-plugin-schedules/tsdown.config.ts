export default {
  entry: ['src/index.ts'],
  format: 'esm',
  target: 'node22.19.0',
  fixedExtension: false,
  dts: false,
  clean: true,
  outDir: 'lib',
  deps: {
    neverBundle: [/^@deepseek-ai\//],
    onlyBundle: false,
  },
}
