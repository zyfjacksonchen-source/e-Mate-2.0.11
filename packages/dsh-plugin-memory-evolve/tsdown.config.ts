export default {
  entry: {
    index: 'src/index.ts',
    scope: 'src/scope.ts',
    store: 'src/store.ts',
  },
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: true,
  clean: true,
}
