const officeDependencies = [
  '@pdf-lib/fontkit',
  '@xmldom/xmldom',
  'docx',
  'jszip',
  'pdf-lib',
  'pptxgenjs',
]

export default {
  entry: { index: 'src/index.ts' },
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: true,
  sourcemap: false,
  clean: true,
  deps: {
    neverBundle: [/^@deepseek-ai\//],
    alwaysBundle: officeDependencies,
  },
}
