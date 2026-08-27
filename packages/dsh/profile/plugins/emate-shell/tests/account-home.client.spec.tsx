// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import React from 'react'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AccountSettings } from '../src/client/account.tsx'
import { HomeProjection } from '../src/client/home.tsx'
import type { IdentityBootstrap, RpcResult } from '../src/client/identity.tsx'

const signedIn: IdentityBootstrap = {
  schema_version: 1,
  ready: true,
  authenticated: true,
  workspace_unlocked: true,
  display_name: '真实测试账户',
  account_status: 'active',
  weekly_token_limit: 88_000,
  agreement_receipt_id: 'receipt',
  agreements: { ready: true, bundle_sha256: 'bundle', required_acknowledgements: [], acknowledgements: [], documents: [] },
}

afterEach(() => {
  cleanup()
  document.body.replaceChildren()
  history.replaceState(null, '', '/')
})

describe('T11 account and compact Home integration', () => {
  it('shows the authoritative account/quota and requests activity only after authenticated bootstrap', async () => {
    const callIdentity = vi.fn(async (endpoint: string, payload: Record<string, unknown>): Promise<RpcResult> => {
      if (endpoint === 'identity.bootstrap') return { ok: true, value: signedIn }
      const query = payload as { timezone: string; start_date: string; end_date: string }
      const start = Date.parse(`${query.start_date}T00:00:00.000Z`)
      const end = Date.parse(`${query.end_date}T00:00:00.000Z`)
      const days = []
      for (let date = start; date <= end; date += 86_400_000) {
        days.push({ date: new Date(date).toISOString().slice(0, 10), total: '0', input: '0', output: '0', cache_read: '0', cache_write: '0' })
      }
      return { ok: true, value: { schema_version: 1, ...query, days, period_total: '0', calculated_at: new Date().toISOString() } }
    })
    render(<AccountSettings callIdentity={callIdentity} />)

    expect(await screen.findByText('真实测试账户')).toBeTruthy()
    expect(screen.getByText(/每周 Token 额度 88K/u)).toBeTruthy()
    expect(await screen.findByRole('region', { name: /Token 活动热力图/u })).toBeTruthy()
    expect(callIdentity.mock.calls.map(([endpoint]) => endpoint)).toEqual(['identity.bootstrap', 'identity.usage.activity'])
  })

  it('mounts the compact Home with twelve templates and no legacy local overview or inferred usage', async () => {
    const phase = document.createElement('main')
    phase.dataset.phase = 'hero'
    const overlay = document.createElement('div')
    overlay.dataset.chainOverlayFallback = 'conversation.composer'
    const target = document.createElement('div')
    overlay.append(target)
    phase.append(overlay)
    document.body.append(phase)
    const Icon = () => <svg />
    const prepareTemplateDraft = vi.fn(async () => {})

    render(<HomeProjection
      useSessions={selector => selector({ ids: [], byId: {}, current: undefined, phase: 'ready', subagentsByParent: {}, jobsBySession: {}, currentAddress: undefined })}
      openSession={() => {}}
      prepareTemplateDraft={prepareTemplateDraft}
      prepareSchedulePrompt={async () => {}}
      callSchedules={async () => ({ ok: true, value: { schema_version: 1, items: [], errors: [] } })}
      scheduleIcons={{ create: Icon, refresh: Icon, edit: Icon, delete: Icon }}
      toggleSidebar={() => {}}
      closeDetails={() => {}}
      PanelIcon={Icon}
    />)

    await waitFor(() => { expect(screen.getByRole('heading', { name: '办公快速模板' })).toBeTruthy() })
    expect(screen.getAllByRole('button').filter(button => /^\d{2}/u.test(button.textContent ?? ''))).toHaveLength(12)
    expect(screen.queryByRole('heading', { name: '今日使用概览' })).toBeNull()
    const source = readFileSync('src/client/home.tsx', 'utf8')
    expect(source).not.toContain('今日使用概览')
    expect(source).not.toContain('projectionValues?.tokenUsage')
    expect(source).not.toContain('任务成功率')
    expect(readFileSync('src/client/home.module.css', 'utf8')).toContain("@import './theme-tokens.css';")
  })
})
