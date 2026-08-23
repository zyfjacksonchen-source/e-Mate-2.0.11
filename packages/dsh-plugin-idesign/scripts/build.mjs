import { createHash } from 'node:crypto'
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const archive = resolve(root, 'vendor/deepseek-idesign-0.2.0.tarball')
const expected = 'srwVnWHSnuuTgMpkfqfnhJD7OO8BtC1nzY6SUIG+gE2K+odZ1yr+GH/swyNNcRMiOPo3YdCslDGq/bkTYlAlBA=='
const allowedTemplates = [
  'ipollowork.html-anything.blog-post',
  'ipollowork.html-anything.finance-report',
  'ipollowork.html-anything.info-funnel',
  'ipollowork.html-anything.invoice',
  'ipollowork.html-anything.magazine-poster',
]

const bytes = await readFile(archive)
const actual = createHash('sha512').update(bytes).digest('base64')
if (actual !== expected) throw new Error(`deepseek-idesign@0.2.0 integrity mismatch: ${actual}`)

const temporary = await mkdtemp(resolve(tmpdir(), 'emate-idesign-build-'))
try {
  const extracted = spawnSync('tar', ['-xzf', archive, '-C', temporary], { encoding: 'utf8' })
  if (extracted.status !== 0) throw new Error(extracted.stderr || 'Unable to extract deepseek-idesign@0.2.0')
  const source = resolve(temporary, 'package')
  const metadata = JSON.parse(await readFile(resolve(source, 'package.json'), 'utf8'))
  if (metadata.name !== 'deepseek-idesign' || metadata.version !== '0.2.0' || metadata.license !== 'MIT') {
    throw new Error('Unexpected deepseek-idesign package identity')
  }

  await rm(resolve(root, 'lib'), { recursive: true, force: true })
  await rm(resolve(root, 'studio'), { recursive: true, force: true })
  await mkdir(resolve(root, 'lib/templates'), { recursive: true })
  await cp(resolve(source, 'studio/dist'), resolve(root, 'studio/dist'), { recursive: true })
  for (const template of allowedTemplates) {
    await cp(resolve(source, 'lib/templates', template), resolve(root, 'lib/templates', template), { recursive: true })
  }

  const host = (await readFile(resolve(source, 'lib/index.js'), 'utf8'))
    .replace('studioTitle: "DeepSeek iDesign"', 'studioTitle: "e-Mate iDesign"')
  const client = (await readFile(resolve(source, 'lib/client.js'), 'utf8'))
    .replace('id: "deepseek-idesign"', 'id: "@e-mate/dsh-plugin-idesign"')
    .replace('label: "Design"', 'label: "设计"')
    .replace('studioTitle: "DeepSeek iDesign"', 'studioTitle: "e-Mate iDesign"')
    .replace('children: "Ask AI"', 'children: "让小芯协助"')
    .replace(/\n\/\/# sourceMappingURL=client\.js\.map\s*$/u, '\n')
  await writeFile(resolve(root, 'lib/index.js'), host)
  await writeFile(resolve(root, 'lib/client.js'), client)
} finally {
  await rm(temporary, { recursive: true, force: true })
}
