/** Exact native Harness composition used instead of AGPL third-party code. */
export const nativeSubagentCompatibility = Object.freeze({
  harnessVersion: '0.1.0-rc.7',
  harnessCommit: 'df78045a127e32cb5b942defba52c539590d1596',
  preset: 'standard',
  packages: Object.freeze([
    '@deepseek-ai/dsh-subagent',
    '@deepseek-ai/dsh-subagent-spawn-in-process',
    '@deepseek-ai/dsh-subagent-fork-in-process',
    '@deepseek-ai/dsh-tool-subagent',
    '@deepseek-ai/dsh-tool-subagent-control',
    '@deepseek-ai/dsh-tool-subagent-report',
  ]),
  tools: Object.freeze([
    'subagent',
    'subagent_fork',
    'send_message',
    'interrupt_agent',
    'list_agents',
    'report',
  ]),
} as const)
