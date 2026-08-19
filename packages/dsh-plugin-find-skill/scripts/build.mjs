import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const upstream = resolve(root, '../../upstream/plugins/dsh-find-skill')
const run = (cwd, ...args) => {
  const result = spawnSync('pnpm', args, { cwd, encoding: 'utf8', stdio: 'pipe' })
  if (result.status !== 0) throw new Error(`${args.join(' ')} failed:\n${result.stdout}${result.stderr}`)
}

run(upstream, 'install', '--frozen-lockfile', '--config.minimumReleaseAge=0')
run(upstream, 'build')
run(join(upstream, 'client'), 'build')
await rm(join(root, 'lib'), { recursive: true, force: true })
await cp(join(upstream, 'lib'), join(root, 'lib'), { recursive: true })
await mkdir(join(root, 'lib/types/client'), { recursive: true })
await cp(join(upstream, 'client/lib/client.js'), join(root, 'lib/client.js'))
await cp(join(upstream, 'client/lib/types/index.d.ts'), join(root, 'lib/types/client/index.d.ts'))
let client = await readFile(join(root, 'lib/client.js'), 'utf8')
client = client.replaceAll('dsh-find-skill-client', '@e-mate/dsh-plugin-find-skill')
await writeFile(join(root, 'lib/client.js'), client)
const cliPath = join(root, 'lib/cli.js')
let cli = await readFile(cliPath, 'utf8')
const imports = `import { join } from 'node:path';`
const command = `    const [command, ...fixed] = tokens;\n    const handle = subprocess.spawn({\n        argv: [command, ...fixed, ...args],`
if (cli.split(imports).length !== 2 || cli.split(command).length !== 2) {
  throw new Error('generated find-skill CLI is not uniquely patchable')
}
cli = cli.replace(imports, `import { isAbsolute, join } from 'node:path';`)
cli = cli.replace(command, `    const [command, ...fixed] = tokens;\n    const managedPnpm = command === 'pnpm' ? process.env.EMATE_DESKTOP_PNPM : undefined;\n    if (managedPnpm !== undefined && !isAbsolute(managedPnpm))\n        throw new Error('EMATE_DESKTOP_PNPM must be an absolute path');\n    const executable = managedPnpm ?? command;\n    const handle = subprocess.spawn({\n        argv: [executable, ...fixed, ...args],`)
await writeFile(cliPath, cli)
await cp(join(upstream, 'LICENSE'), join(root, 'LICENSE'))
