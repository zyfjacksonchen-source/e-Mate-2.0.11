import { memo, useEffect, useMemo, useState } from 'react'
import type { ModelRetryNode } from '@deepseek-ai/dsh-client-runtime/client'
import type { ChatNodeViewProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import css from './retry-attempts.module.css'

function seconds(milliseconds: number): number {
  return Math.max(1, Math.ceil(milliseconds / 1_000))
}

function RetryAttempt({ attempt, current }: { attempt: ModelRetryNode; current: boolean }) {
  const active = current && attempt.retryState === 'scheduled'
  const deadline = useMemo(() => Date.now() + attempt.delayMs, [attempt.delayMs, attempt.seq])
  const [remaining, setRemaining] = useState(() => seconds(attempt.delayMs))

  useEffect(() => {
    if (!active) return
    const update = () => {
      const next = seconds(deadline - Date.now())
      setRemaining(next)
      return next
    }
    if (update() === 1) return
    const timer = window.setInterval(() => {
      if (update() === 1) window.clearInterval(timer)
    }, 250)
    return () => { window.clearInterval(timer) }
  }, [active, deadline])

  const label = current
    ? attempt.retryState === 'cancelled'
      ? '重试已取消'
      : '正在重试'
    : '上次尝试失败'

  return (
    <details className={active ? css.active : undefined}>
      <summary className={css.summary}>
        <span className={css.copy} role="status">
          <span className={css.label}>{label}</span>
          {attempt.failure.message}
        </span>
        <span className={css.attempt}>第 {attempt.retry} 次 · {active ? remaining : seconds(attempt.delayMs)}s</span>
      </summary>
      <div className={css.details}>
        <div><span className={css.detailLabel}>重试延迟：</span>{Math.round(attempt.delayMs)}ms</div>
        <div><span className={css.detailLabel}>失败原因：</span>{attempt.failure.message}</div>
      </div>
    </details>
  )
}

/** e-Mate presentation of the target-owned, retryId-correlated attempt chain. */
export const RetryAttempts = memo(function RetryAttempts({ node }: ChatNodeViewProps<'model-retry'>) {
  return (
    <div className={css.chain} data-emate-retry-attempts={node.data.attempts.length}>
      {node.data.attempts.map(attempt => (
        <RetryAttempt key={attempt.seq} attempt={attempt} current={attempt.seq === node.data.current.seq} />
      ))}
    </div>
  )
})
