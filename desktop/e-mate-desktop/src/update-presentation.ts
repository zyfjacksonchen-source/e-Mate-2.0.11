/** User-facing Profile update copy derived without exposing internal identities. */

export function profileUpdateCapabilitySummary(changedCount: number): string {
  return changedCount === 0
    ? '本次仅更新发布回执，无需下载新的能力文件。'
    : `本次包含 ${changedCount} 项办公能力与体验优化。`
}

export function formatUpdateBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`
}
