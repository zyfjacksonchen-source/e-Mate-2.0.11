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

const SESSION_APPEND_OLD = `\tappend(type, data, ...opts) {
\t\tconst surfaceOpts = opts[0];
\t\tconst surfaceMetadata = {
\t\t\t...surfaceOpts?.sourceEventSeqs === void 0 ? {} : { sourceEventSeqs: surfaceOpts.sourceEventSeqs },
\t\t\t...surfaceOpts?.surfaceOp === void 0 ? {} : { surfaceOp: surfaceOpts.surfaceOp }
\t\t};`

const SESSION_APPEND_NEW = `\tappend(type, data, ...opts) {
\t\tconst surfaceOpts = opts[0];
\t\tif (surfaceOpts?.ignorable !== void 0 && surfaceOpts.ignorable !== true) throw new Error(\`session event "\${type}" carries an invalid ignorable marker\`);
\t\tconst surfaceMetadata = {
\t\t\t...surfaceOpts?.sourceEventSeqs === void 0 ? {} : { sourceEventSeqs: surfaceOpts.sourceEventSeqs },
\t\t\t...surfaceOpts?.surfaceOp === void 0 ? {} : { surfaceOp: surfaceOpts.surfaceOp },
\t\t\t...surfaceOpts?.ignorable === true ? { ignorable: true } : {}
\t\t};`

const SESSION_READ_OLD = `\t\t\tif (KNOWN_SESSION_EVENT_TYPES.has(event.type) || event.ignorable === true) continue;`
const SESSION_READ_NEW = `\t\t\tif (KNOWN_SESSION_EVENT_TYPES.has(event.type) || event.ignorable === true || event.type === "emate/image-output") continue;`

export function adaptHarnessFsSource(source) {
  const occurrences = source.split(FS_OLD).length - 1
  if (occurrences !== 1) {
    throw new Error(`Harness fs adapter expected one rc.7 escalation seam, found ${occurrences}`)
  }
  return source.replace(FS_OLD, FS_NEW)
}

export function adaptHarnessSessionSource(source) {
  const occurrences = source.split(SESSION_APPEND_OLD).length - 1
  if (occurrences !== 1) {
    throw new Error(`Harness session adapter expected one rc.7 append seam, found ${occurrences}`)
  }
  return source.replace(SESSION_APPEND_OLD, SESSION_APPEND_NEW)
}

export function adaptHarnessSessionPersistenceSource(source) {
  const occurrences = source.split(SESSION_READ_OLD).length - 1
  if (occurrences !== 1) {
    throw new Error(`Harness session persistence adapter expected one rc.7 event guard, found ${occurrences}`)
  }
  return source.replace(SESSION_READ_OLD, SESSION_READ_NEW)
}

export async function applyHarnessRuntimeAdapters(runtimeRoot) {
  const packageEntry = name => join(runtimeRoot, 'node_modules', '@deepseek-ai', name, 'lib', 'index.js')
  const fsTarget = packageEntry('dsh-tool-fs')
  const sessionTarget = packageEntry('dsh-session')
  const persistenceTarget = packageEntry('dsh-session-persistence')
  await Promise.all([
    writeFile(fsTarget, adaptHarnessFsSource(await readFile(fsTarget, 'utf8'))),
    writeFile(sessionTarget, adaptHarnessSessionSource(await readFile(sessionTarget, 'utf8'))),
    writeFile(persistenceTarget, adaptHarnessSessionPersistenceSource(await readFile(persistenceTarget, 'utf8'))),
  ])
}
