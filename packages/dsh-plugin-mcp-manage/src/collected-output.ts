interface CollectedOutput {
  readFrom(offset: number): { text: string; lossy: boolean }
}

export function readCollectedOutput(output: CollectedOutput | undefined, label: string): string {
  if (output === undefined) throw new Error(`${label} 未启用收集输出。`)
  const result = output.readFrom(0)
  if (result.lossy) throw new Error(`${label} 超过安全上限。`)
  return result.text
}
