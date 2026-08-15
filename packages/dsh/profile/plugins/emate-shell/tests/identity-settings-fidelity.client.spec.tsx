// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import React from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AccountControl, AccountSettings } from '../src/client/account.tsx'
import { ConnectionsSettings } from '../src/client/connections.tsx'
import { IdentityGate, type IdentityBootstrap, type RpcResult } from '../src/client/identity.tsx'
import { SessionRouteProjection } from '../src/client/session-route.tsx'
import { SettingsChrome } from '../src/client/settings-chrome.tsx'

const agreements = {
  ready: true,
  bundle_sha256: 'bundle',
  required_acknowledgements: ['legal'],
  acknowledgements: [{ id: 'legal', label: '我已阅读并同意' }],
  documents: [],
}

const signedIn: IdentityBootstrap = {
  schema_version: 1,
  ready: true,
  authenticated: true,
  workspace_unlocked: true,
  display_name: '测试用户',
  account_status: 'active',
  weekly_token_limit: 10_000,
  agreement_receipt_id: 'agreement-receipt',
  agreements,
}

afterEach(() => {
  cleanup()
  document.querySelectorAll('[data-emate-identity-gate]').forEach(element => { element.remove() })
  history.replaceState(null, '', '/')
})

describe('e-Mate 2.0.5 identity and settings fidelity', () => {
  it('keeps the pinned LoginPage measurements and current SettingsDialog copy', () => {
    const upstream = readFileSync(join(process.cwd(), '../../../../../upstream/e-mate-2.0.5/desktop/src/v1/styles/layout.css'), 'utf8')
    const identity = readFileSync(join(process.cwd(), 'src/client/identity.module.css'), 'utf8')

    expect(upstream).toContain('.ex-login-panel {\n  width: min(360px, 100%);')
    expect(upstream).toContain('.ex-login-logo {\n  width: 172px;\n  height: 40px;')
    expect(identity).toContain('width: min(386px, 100%);')
    expect(identity).toContain('padding: max(24px, calc(50dvh - 90px)) 24px 24px;')
    expect(identity).toContain('width: 172px;\n  height: 40px;')

    render(<SettingsChrome />)
    expect(screen.getByRole('heading', { name: '设置' })).toBeTruthy()
    expect(screen.getByText('管理个人资料、常规设置、知识和记忆。')).toBeTruthy()
  })

  it('renames target plugin chrome to the e-Mate capability center without replacing target settings', async () => {
    render(<div role="dialog"><button type="button">插件</button><p>DeepSeek 搜索提供方。</p><SettingsChrome /></div>)
    expect(await screen.findByText('能力中心')).toBeTruthy()
    expect(screen.getByText('e-Mate 搜索服务。')).toBeTruthy()
  })

  it('keeps registration, verification and pending approval on the target RPC seam', async () => {
    const shellRoot = document.createElement('div')
    shellRoot.id = 'root'
    shellRoot.style.width = '432px'
    document.body.append(shellRoot)
    const callIdentity = vi.fn(async (endpoint: string): Promise<RpcResult> => {
      if (endpoint === 'identity.bootstrap') return {
        ok: true,
        value: {
          schema_version: 1,
          ready: true,
          authenticated: false,
          workspace_unlocked: false,
          agreements,
        },
      }
      if (endpoint === 'verification.issue') return {
        ok: true,
        value: {
          schema_version: 1,
          challenge_id: 'challenge',
          image_data_url: 'data:image/png;base64,AA==',
          expires_at: '2026-08-15T00:00:00Z',
        },
      }
      if (endpoint === 'session.register') return {
        ok: true,
        value: { schema_version: 1, registration_id: 'registration', status: 'pending_approval' },
      }
      return { ok: false, error: { message: 'unexpected call' } }
    })

    const view = render(<IdentityGate callIdentity={callIdentity} />)
    await waitFor(() => { expect(shellRoot.hidden).toBe(true) })
    fireEvent.click(await screen.findByRole('button', { name: '注册新账号' }))
    fireEvent.change(await screen.findByLabelText('账号'), { target: { value: 'test@example.com' } })
    fireEvent.change(screen.getByLabelText('真实姓名'), { target: { value: '测试用户' } })
    fireEvent.change(screen.getByLabelText('密码（至少 10 位）'), { target: { value: 'safe-password' } })
    fireEvent.change(await screen.findByLabelText('验证码'), { target: { value: 'ABCD' } })
    fireEvent.click(screen.getByRole('button', { name: '提交注册申请' }))

    expect(await screen.findByRole('heading', { name: '注册申请已提交' })).toBeTruthy()
    expect(callIdentity).toHaveBeenCalledWith('session.register', {
      account: 'test@example.com',
      real_name: '测试用户',
      password: 'safe-password',
      challenge_id: 'challenge',
      verification_code: 'ABCD',
    })
    view.unmount()
    expect(shellRoot.hidden).toBe(false)
    shellRoot.remove()
  })

  it('replays a protected chat deep link after the async identity gate unlocks', async () => {
    history.replaceState(null, '', '/chat/performance-session')
    let unlock!: (result: RpcResult) => void
    const callIdentity = vi.fn(() => new Promise<RpcResult>(resolve => { unlock = resolve }))
    const openSession = vi.fn()
    let markSessionsReady!: () => void

    function Runtime() {
      const [sessions, setSessions] = React.useState<{
        phase: 'pending' | 'ready'
        current?: string
        byId: Record<string, unknown>
      }>({ phase: 'pending', byId: {} })
      const latest = React.useRef(sessions)
      latest.current = sessions
      markSessionsReady = () => {
        setSessions({ phase: 'ready', byId: { 'performance-session': {} } })
      }
      return <>
        <IdentityGate callIdentity={callIdentity} />
        <SessionRouteProjection
          useSessions={selector => selector(sessions)}
          getSessions={() => latest.current}
          openSession={openSession}
          startHomeSession={vi.fn()}
        />
      </>
    }

    render(<Runtime />)

    await waitFor(() => { expect(location.pathname).toBe('/login') })
    act(() => { markSessionsReady() })
    expect(openSession).not.toHaveBeenCalled()
    unlock({ ok: true, value: signedIn })
    await waitFor(() => { expect(openSession).toHaveBeenCalledWith('performance-session') })
    expect(location.pathname).toBe('/chat/performance-session')
  })

  it('routes Home through the managed general-session action and keeps chat deep links exact', async () => {
    const startHomeSession = vi.fn()
    const openSession = vi.fn()
    const state = { phase: 'ready' as const, current: 'project', byId: { project: {}, other: {} } }
    const view = render(<SessionRouteProjection
      useSessions={selector => selector(state)}
      getSessions={() => state}
      openSession={openSession}
      startHomeSession={startHomeSession}
    />)

    await waitFor(() => { expect(startHomeSession).toHaveBeenCalledOnce() })
    expect(openSession).not.toHaveBeenCalled()

    history.pushState(null, '', '/chat/other')
    act(() => { dispatchEvent(new PopStateEvent('popstate')) })
    expect(openSession).toHaveBeenCalledWith('other')
    expect(startHomeSession).toHaveBeenCalledOnce()
    view.unmount()
  })

  it('keeps account password and connection credentials on their existing RPC/API seams', async () => {
    const callIdentity = vi.fn(async (endpoint: string): Promise<RpcResult> => {
      if (endpoint === 'identity.bootstrap') return { ok: true, value: signedIn }
      if (endpoint === 'identity.usage') return {
        ok: true,
        value: {
          schema_version: 1,
          scope: 'account',
          timezone: 'Asia/Shanghai',
          week: { total_tokens: 2_500 },
          week_started_at: '2026-08-10T16:00:00.000Z',
          calculated_at: '2026-08-15T00:00:00.000Z',
        },
      }
      return { ok: false, error: { message: '测试改密拒绝' } }
    })
    const Icon = () => <svg />
    const account = render(<AccountControl
      callIdentity={callIdentity}
      wide
      UserIcon={Icon}
      expandSidebar={() => {}}
    />)
    fireEvent.click(await screen.findByLabelText('用户中心，测试用户'))
    expect(await screen.findByText('2,500 / 10,000 Token')).toBeTruthy()
    expect((screen.getByRole('progressbar', { name: '本周 Token 用量' }) as HTMLProgressElement).value).toBe(2_500)
    fireEvent.click(await screen.findByRole('button', { name: '退出登录' }))
    expect(await screen.findByRole('dialog', { name: '退出 e-Mate？' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    await waitFor(() => { expect(screen.queryByRole('dialog', { name: '退出 e-Mate？' })).toBeNull() })
    account.unmount()

    const { unmount } = render(<AccountSettings callIdentity={callIdentity} />)

    expect(await screen.findByText('测试用户')).toBeTruthy()
    expect(screen.getByText(/每周 Token 额度 10,000/)).toBeTruthy()
    fireEvent.change(screen.getByLabelText('当前密码'), { target: { value: 'old-password' } })
    fireEvent.change(screen.getByLabelText('新密码'), { target: { value: 'new-password' } })
    fireEvent.change(screen.getByLabelText('确认新密码'), { target: { value: 'new-password' } })
    fireEvent.click(screen.getByRole('button', { name: '修改密码' }))
    await waitFor(() => { expect(callIdentity).toHaveBeenCalledWith('session.password', expect.objectContaining({
      current_password: 'old-password',
      new_password: 'new-password',
    })) })
    unmount()

    const callConnections = vi.fn(async () => ({
      ok: true,
      value: {
        schema_version: 1,
        items: [{
          id: 'feishu',
          title: '飞书',
          summary: '飞书连接',
          state: 'setup-required',
          detail: '需要配置应用凭据。',
          fields: [{
            ref: 'FEISHU_SECRET',
            label: 'App Secret',
            secret: true,
            configured: false,
            writable: true,
          }],
        }],
      },
    }))
    const setCredential = vi.fn(async () => {})
    render(<ConnectionsSettings
      callConnections={callConnections}
      setCredential={setCredential}
      unsetCredential={vi.fn(async () => {})}
      LinkIcon={Icon}
      RefreshIcon={Icon}
    />)

    fireEvent.change(await screen.findByLabelText(/^App Secret/u), { target: { value: 'secret-value' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => { expect(setCredential).toHaveBeenCalledWith('FEISHU_SECRET', 'secret-value') })
  })

  it('previews a validated avatar locally without adding an identity RPC', async () => {
    const callIdentity = vi.fn(async (): Promise<RpcResult> => ({ ok: true, value: signedIn }))
    render(<AccountSettings callIdentity={callIdentity} />)

    const input = await screen.findByLabelText('选择头像图片')
    expect(screen.getByText('头像').closest('div')?.parentElement?.querySelectorAll('svg')).toHaveLength(2)
    fireEvent.change(input, { target: { files: [new File(['not-an-image'], 'avatar.gif', { type: 'image/gif' })] } })
    expect(await screen.findByText('请选择 PNG、JPEG 或 WebP 图片。')).toBeTruthy()

    fireEvent.change(input, { target: { files: [new File(['avatar'], 'avatar.png', { type: 'image/png' })] } })
    expect((await screen.findByRole('img', { name: '当前头像' })).getAttribute('src')).toMatch(/^data:image\/png;base64,/u)
    expect(callIdentity).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: '移除' }))
    expect(screen.queryByRole('img', { name: '当前头像' })).toBeNull()
  })
})
