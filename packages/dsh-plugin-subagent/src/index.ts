/** Exact native Harness composition used instead of AGPL third-party code. */
export const nativeSubagentCompatibility = Object.freeze({
  harnessVersion: '0.1.0-rc.5',
  harnessCommit: '12d68b6ca05fa538d98f70ed47786c44ca3a7225',
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
