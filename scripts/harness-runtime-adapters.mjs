import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const FS_OLD = `\tasync resolvePolicy(toolName, args, exec) {
\t\tvalidateEscalationArgs(args.sandbox_permissions, args.justification);
\t\tconst standingPolicy = this.policy?.resolve({ ...exec.agent ? { session: exec.agent.session } : {} });
\t\tif (args.sandbox_permissions === void 0 || args.justification === void 0) return standingPolicy;`

const FS_NEW = `\tasync resolvePolicy(toolName, args, exec) {
\t\tconst standingPolicy = this.policy?.resolve({ ...exec.agent ? { session: exec.agent.session } : {} });
\t\tconst redundantEscalation = args.sandbox_permissions !== void 0 && standingPolicy !== void 0 && (args.sandbox_permissions === standingPolicy.mode || standingPolicy.mode === "danger-full-access");
\t\tif (!redundantEscalation) validateEscalationArgs(args.sandbox_permissions, args.justification);
\t\tif (args.sandbox_permissions === void 0 || args.justification === void 0 || redundantEscalation) return standingPolicy;`

export function adaptHarnessFsSource(source) {
  const occurrences = source.split(FS_OLD).length - 1
  if (occurrences !== 1) {
    throw new Error(`Harness fs adapter expected one rc.7 escalation seam, found ${occurrences}`)
  }
  return source.replace(FS_OLD, FS_NEW)
}

export async function applyHarnessRuntimeAdapters(runtimeRoot) {
  const target = join(runtimeRoot, 'node_modules', '@deepseek-ai', 'dsh-tool-fs', 'lib', 'index.js')
  await writeFile(target, adaptHarnessFsSource(await readFile(target, 'utf8')))
}
