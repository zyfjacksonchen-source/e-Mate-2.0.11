/** Exact native Harness composition used instead of AGPL third-party code. */
export const nativeSubagentCompatibility = Object.freeze({
  harnessVersion: '0.1.0-rc.5',
  harnessCommit: '47f943859bef60e4160492346772ded9b24f765a',
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
