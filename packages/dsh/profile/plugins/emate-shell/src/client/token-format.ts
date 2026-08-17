export function formatTokenCount(value: number | bigint): string {
  const amount = BigInt(value)
  const [divisor, suffix] = amount >= 1_000_000n
    ? [1_000_000n, 'M'] as const
    : amount >= 1_000n
      ? [1_000n, 'K'] as const
      : [1n, ''] as const
  if (!suffix) return amount.toLocaleString('zh-CN')
  const tenths = (amount * 10n + divisor / 2n) / divisor
  return `${tenths / 10n}${tenths % 10n ? `.${tenths % 10n}` : ''}${suffix}`
}
