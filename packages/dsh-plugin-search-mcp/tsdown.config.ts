export default {
  entry: { index: 'src/index.ts' },
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: true,
  dts: true,
  clean: true,
  deps: {
    neverBundle: [/^@deepseek-ai\//],
    alwaysBundle: [/^@modelcontextprotocol\/sdk(?:\/|$)/],
    onlyBundle: false,
  },
}
