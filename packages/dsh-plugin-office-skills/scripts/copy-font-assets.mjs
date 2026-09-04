import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const source = join(root, 'node_modules', '@fontsource-variable', 'noto-sans-sc')
const target = join(root, 'assets', 'noto-sans-sc')
const pdfSource = join(root, 'node_modules', 'pdf2json')
const pdfTarget = join(root, 'assets', 'pdf2json')

await rm(target, { recursive: true, force: true })
await mkdir(target, { recursive: true })
await cp(join(source, 'files'), join(target, 'files'), { recursive: true })
await cp(join(source, 'unicode.json'), join(target, 'unicode.json'))
await cp(join(source, 'LICENSE'), join(target, 'LICENSE'))
await rm(pdfTarget, { recursive: true, force: true })
await mkdir(pdfTarget, { recursive: true })
await cp(join(pdfSource, 'dist', 'pdfparser.js'), join(pdfTarget, 'pdfparser.js'))
await cp(join(pdfSource, 'license.txt'), join(pdfTarget, 'LICENSE'))
const pdfLicense = await readFile(join(pdfTarget, 'LICENSE'), 'utf8')
await writeFile(join(pdfTarget, 'LICENSE'), pdfLicense.replace(/\r\n?/gu, '\n'))
