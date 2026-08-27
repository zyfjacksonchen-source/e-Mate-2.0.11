// @vitest-environment jsdom
import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RpcResult } from '../src/client/identity.tsx'
import {
  heatLevel,
  type UsageActivity,
  UsageHeatmap,
  usageActivityQuery,
  validUsageActivity,
} from '../src/client/usage-heatmap.tsx'

const DAY_MS = 86_400_000

afterEach(() => { cleanup() })

function activity(query: { timezone: string; start_date: string; end_date: string }): UsageActivity {
  const start = Date.parse(`${query.start_date}T00:00:00.000Z`)
  const end = Date.parse(`${query.end_date}T00:00:00.000Z`)
  const days = []
  for (let current = start; current <= end; current += DAY_MS) {
    const date = new Date(current).toISOString().slice(0, 10)
    const latest = date === query.end_date
    days.push({
      date,
      total: latest ? '100' : '0',
      input: latest ? '40' : '0',
      output: latest ? '30' : '0',
      cache_read: latest ? '20' : '0',
      cache_write: latest ? '10' : '0',
    })
  }
  return {
    schema_version: 1,
    ...query,
    days,
    period_total: '100',
    calculated_at: `${query.end_date}T12:00:00.000Z`,
  }
}

describe('T11 usage activity heatmap', () => {
  it('validates exact T10 decimal buckets, leap-year range and all five heat levels without Number coercion', () => {
    const query = usageActivityQuery('UTC', '2024-02-29')
    expect(query).toEqual({ timezone: 'UTC', start_date: '2023-03-01', end_date: '2024-02-29' })
    const value = activity(query)
    value.days.at(-1)!.input = '9007199254740993'
    value.days.at(-1)!.total = '9007199254741053'
    value.period_total = '9007199254741053'
    expect(validUsageActivity(value, query)).toBe(true)
    expect(heatLevel('0', 100n)).toBe(0)
    expect([1, 2, 3, 4].map(level => heatLevel(String(level * 25), 100n))).toEqual([1, 2, 3, 4])
    value.days.at(-1)!.total = '9007199254741054'
    expect(validUsageActivity(value, query)).toBe(false)
  })

  it('renders exact accessible day tooltips and correct daily, weekly and cumulative summaries', async () => {
    const callIdentity = vi.fn(async (_endpoint: string, payload: Record<string, unknown>): Promise<RpcResult> => ({
      ok: true,
      value: activity(payload as { timezone: string; start_date: string; end_date: string }),
    }))
    render(<UsageHeatmap callIdentity={callIdentity} />)

    const region = await screen.findByRole('region', { name: /Token 活动热力图/u })
    expect(region).toBeTruthy()
    expect(callIdentity).toHaveBeenCalledWith('identity.usage.activity', expect.objectContaining({ timezone: expect.any(String) }))
    const latest = screen.getByRole('button', { name: /100 Token（输入 40，输出 30，缓存读取 20，缓存写入 10）/u })
    expect(latest.getAttribute('title')).toBe(latest.getAttribute('aria-label'))
    expect(latest.dataset.level).toBe('4')

    fireEvent.click(screen.getByRole('button', { name: '每周' }))
    expect(screen.getByText(/至/u).parentElement?.textContent).toContain('100Token')
    fireEvent.click(screen.getByRole('button', { name: '累计' }))
    expect(screen.getByText('近 12 个月累计').parentElement?.textContent).toContain('100Token')
  })

  it('shows typed unavailability without fake cells and retries the same authoritative endpoint', async () => {
    let unavailable = true
    const callIdentity = vi.fn(async (_endpoint: string, payload: Record<string, unknown>): Promise<RpcResult> => unavailable
      ? { ok: false, error: { message: 'Token 使用数据暂时不可用，请稍后重试。' } }
      : { ok: true, value: activity(payload as { timezone: string; start_date: string; end_date: string }) })
    render(<UsageHeatmap callIdentity={callIdentity} />)

    expect((await screen.findByRole('alert')).textContent).toContain('Token 使用数据暂时不可用')
    expect(screen.queryByRole('region', { name: /Token 活动热力图/u })).toBeNull()
    unavailable = false
    fireEvent.click(screen.getByRole('button', { name: '重试' }))
    await waitFor(() => { expect(screen.getByRole('region', { name: /Token 活动热力图/u })).toBeTruthy() })
    expect(callIdentity).toHaveBeenCalledTimes(2)
  })
})
