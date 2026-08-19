const DATE = /^\d{4}-\d{2}-\d{2}$/u
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}:\d{2})?$/u
type Args = Record<string, unknown>

export const EMATE_MANAGED_PYTHON_PATH = 'EMATE_MANAGED_PYTHON_PATH'

export interface PythonEnvironmentLookup {
  getFrom(name: string, sources: readonly 'process'[]): { readonly value: string } | undefined
}

/** Resolve Desktop's managed interpreter through the frozen DSH launch environment. */
export function resolvePythonCommand(
  configured: string,
  environment: PythonEnvironmentLookup,
  platform: NodeJS.Platform = process.platform,
): string {
  const explicit = configured.trim()
  if (explicit !== '') return explicit
  const managed = environment.getFrom(EMATE_MANAGED_PYTHON_PATH, ['process'])?.value.trim()
  return managed === undefined || managed === '' ? (platform === 'win32' ? 'python' : 'python3') : managed
}

function text(value: unknown, name: string, max = 1024): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string' || value.length === 0 || value.length > max || /[\0\r\n]/u.test(value)) throw new Error(`${name} 参数无效。`)
  return value
}

function integer(value: unknown, name: string): number | undefined {
  if (value === undefined) return undefined
  if (!Number.isSafeInteger(value) || Number(value) < 0) throw new Error(`${name} 参数无效。`)
  return Number(value)
}

function push(argv: string[], flag: string, value: string | number | undefined): void {
  if (value !== undefined) argv.push(flag, String(value))
}

export function buildCliArgs(args: Args): string[] {
  const operation = text(args.operation, 'operation', 40)
  if (operation === undefined) throw new Error('operation 参数必填。')
  const argv: string[] = []
  const source = args.source === undefined ? undefined : text(args.source, 'source', 8)
  const platform = args.platform === undefined ? undefined : text(args.platform, 'platform', 8)
  const channel = args.xhs_channel === undefined ? undefined : text(args.xhs_channel, 'xhs_channel', 12)
  if (source !== undefined && !['cache', 'mpi'].includes(source)) throw new Error('source 参数无效。')
  if (platform !== undefined && !['xhs', 'bili', 'alipay'].includes(platform)) throw new Error('platform 参数无效。')
  if (channel !== undefined && !['all', 'spotlight', 'chengfeng'].includes(channel)) throw new Error('xhs_channel 参数无效。')
  const date = (name: string) => {
    const value = args[name] === undefined ? undefined : text(args[name], name, 10)
    if (value !== undefined && !DATE.test(value)) throw new Error(`${name} 参数无效。`)
    return value
  }
  const common = () => {
    push(argv, '--source', source); push(argv, '--platform', platform); push(argv, '--xhs-channel', channel)
    push(argv, '--limit', integer(args.limit, 'limit')); push(argv, '--offset', integer(args.offset, 'offset'))
  }
  const identity = () => {
    push(argv, '--project-id', integer(args.project_id, 'project_id')); push(argv, '--task-id', integer(args.task_id, 'task_id'))
    push(argv, '--account-id', text(args.account_id, 'account_id', 256)); push(argv, '--search', text(args.search, 'search')); push(argv, '--operator', text(args.operator, 'operator', 256))
  }
  switch (operation) {
    case 'schema': return ['schema']
    case 'auth_status': argv.push('auth', 'status'); push(argv, '--platform', platform ?? 'xhs'); break
    case 'account_list': argv.push('account', 'list'); common(); identity(); if (args.full === true) argv.push('--full'); break
    case 'project_list': argv.push('project', 'list'); common(); identity(); push(argv, '--start-date', date('start_date')); push(argv, '--end-date', date('end_date')); break
    case 'project_detail': argv.push('project', 'detail'); push(argv, '--project-id', integer(args.project_id, 'project_id')); push(argv, '--start-date', date('start_date')); push(argv, '--end-date', date('end_date')); break
    case 'task_list': argv.push('task', 'list'); identity(); push(argv, '--status', text(args.status, 'status', 128)); push(argv, '--category', text(args.category, 'category', 128)); push(argv, '--assignee', text(args.assignee, 'assignee', 256)); if (args.include_archived === true) argv.push('--include-archived'); break
    case 'task_detail': argv.push('task', 'detail'); push(argv, '--task-id', integer(args.task_id, 'task_id')); break
    case 'user_list': argv.push('user', 'list'); push(argv, '--user-role', text(args.user_role, 'user_role', 64)); push(argv, '--department', text(args.department, 'department', 256)); push(argv, '--status', text(args.status, 'status', 128)); push(argv, '--search', text(args.search, 'search')); if (args.include_resigned === true) argv.push('--include-resigned'); break
    case 'report_summary': argv.push('report', 'summary'); common(); identity(); push(argv, '--start-date', date('start_date')); push(argv, '--end-date', date('end_date')); break
    case 'note_detail': argv.push('note', 'detail'); common(); identity(); push(argv, '--start-date', date('start_date')); push(argv, '--end-date', date('end_date')); break
    case 'snapshot': argv.push('snapshot'); identity(); push(argv, '--start-date', date('start_date')); push(argv, '--end-date', date('end_date')); push(argv, '--status', text(args.status, 'status', 128)); push(argv, '--category', text(args.category, 'category', 128)); if (args.include_archived === true) argv.push('--include-archived'); break
    case 'realtime_summary': argv.push('realtime', 'summary'); identity(); push(argv, '--xhs-channel', channel ?? 'all'); push(argv, '--limit', integer(args.limit, 'limit')); push(argv, '--offset', integer(args.offset, 'offset')); break
    case 'sync_state': argv.push('sync', 'state'); break
    case 'sync_changes': {
      argv.push('sync', 'changes')
      const since = text(args.since, 'since', 19)
      if (since === undefined || !TIMESTAMP.test(since)) throw new Error('since 参数必填且必须是有效时间。')
      push(argv, '--since', since)
      break
    }
    default: throw new Error('operation 不在芯助手 CLI 只读白名单中。')
  }
  return argv
}
