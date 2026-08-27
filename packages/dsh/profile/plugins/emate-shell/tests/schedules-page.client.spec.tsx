// @vitest-environment jsdom
import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { InputTriggerSource } from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import { prepareSchedulePromptFromRoute } from '../src/client/index.ts'
import { registerScheduleTrigger, SchedulesPage } from '../src/client/schedules-page.tsx'

const Icon = () => <svg />

afterEach(() => {
  cleanup()
  document.body.replaceChildren()
  history.replaceState(null, '', '/')
})

function productSurface(): void {
  const phase = document.createElement('main')
  phase.dataset.phase = 'product'
  phase.dataset.emateProductSurface = ''
  document.body.append(phase)
}

describe('native Schedule page closure', () => {
  it('projects active, overdue, completed and recent native records and hands mutations to the owning Session', async () => {
    history.replaceState(null, '', '/schedules')
    productSurface()
    const prepareSchedulePrompt = vi.fn(async () => {})
    const callSchedules = vi.fn(async () => ({ ok: true, value: {
      schema_version: 1,
      items: [{
        id: 'schedule-1', session_id: 'session-1', session_title: '日报会话', kind: 'every',
        prompt: '生成日报', everySeconds: 300, scheduledAt: '2099-08-19T12:00:00.000Z', state: 'scheduled',
      }, {
        id: 'schedule-2', session_id: 'session-2', session_title: '提醒会话', kind: 'after',
        prompt: '检查交付', afterSeconds: 600, scheduledAt: '2020-08-19T12:00:00.000Z', state: 'overdue',
      }],
      completed: [{
        id: 'schedule-3', session_id: 'session-3', session_title: '周报会话', kind: 'at',
        prompt: '提交周报', scheduledAt: '2026-08-19T12:00:00.000Z', state: 'completed',
        completedAt: '2026-08-19T12:00:01.000Z',
      }],
      recent_runs: [{
        id: 'schedule-4', session_id: 'session-4', session_title: '项目会话', kind: 'every',
        prompt: '同步项目', everySeconds: 3600, scheduledAt: '2026-08-19T11:00:00.000Z',
        ranAt: '2026-08-19T11:00:01.000Z',
      }],
      errors: [{ session_id: 'corrupt', message: 'redacted' }],
    } }))

    render(<SchedulesPage
      callSchedules={callSchedules}
      prepareSchedulePrompt={prepareSchedulePrompt}
      scheduleIcons={{ create: Icon, refresh: Icon, edit: Icon, delete: Icon }}
      toggleSidebar={vi.fn()}
      PanelIcon={Icon}
    />)

    await waitFor(() => { expect(screen.getByRole('heading', { name: '已安排的任务' })).toBeTruthy() })
    await waitFor(() => { expect(screen.getByText('生成日报')).toBeTruthy() })
    expect(callSchedules).toHaveBeenCalledOnce()
    expect(screen.getByText('已逾期')).toBeTruthy()
    expect(screen.getByText('创建后 10 分钟')).toBeTruthy()
    expect(screen.getByRole('heading', { name: '已完成' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: '最近运行' })).toBeTruthy()
    expect(screen.getByText('有 1 个会话的定时任务日志无法读取。')).toBeTruthy()
    expect(screen.getByText('修改会先创建替代任务；只有新任务创建成功后，小芯才会删除旧任务。')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '创建' }))
    await waitFor(() => {
      expect(prepareSchedulePrompt).toHaveBeenCalledWith(expect.stringMatching(/确认执行时间和任务内容.*schedule_create/u))
    })
    fireEvent.click(screen.getAllByRole('button', { name: '修改' })[0]!)
    await waitFor(() => {
      expect(prepareSchedulePrompt).toHaveBeenCalledWith(expect.stringMatching(/先调用 schedule_create.*成功后再调用 schedule_delete/u), 'session-1')
    })
    fireEvent.click(screen.getAllByRole('button', { name: '删除' })[0]!)
    await waitFor(() => {
      expect(prepareSchedulePrompt).toHaveBeenCalledWith(expect.stringMatching(/schedule_list.*确认.*schedule_delete/u), 'session-1')
    })
  })

  it('registers @定时任务 in the native InputTrigger service without adding a scheduler or UI write endpoint', async () => {
    let registered: InputTriggerSource | undefined
    registerScheduleTrigger({
      effect(run: () => () => void) { return run() },
      inputTriggers: {
        registerSource(source: InputTriggerSource) {
          registered = source
          return () => {}
        },
      },
    })
    expect(await registered?.candidates({} as never, { query: '定时', signal: new AbortController().signal })).toEqual([
      { name: '定时任务', description: '创建、查看或删除原生定时任务' },
    ])
    expect(registered?.onPick({
      candidate: { name: '定时任务' },
      session: { sessionId: 'session-1' as never },
      position: 'inline',
      via: 'menu',
      span: { start: 0, end: 5, draftRev: 1 },
    })).toEqual({
      insert: { source: '定时任务', ref: 'schedule', label: '@定时任务', clipboardText: '@定时任务' },
    })
    await expect(registered?.codec?.serialize('schedule', new AbortController().signal)).resolves.toBe('@定时任务')

    const page = readFileSync('src/client/schedules-page.tsx', 'utf8')
    const registration = readFileSync('src/client/index.ts', 'utf8')
    const plugin = readFileSync('../../../../dsh-plugin-schedules/src/index.ts', 'utf8')
    expect(page).not.toMatch(/schedule\/change|setInterval|setTimeout/u)
    expect(registration).toMatch(/ctx\.workspaces\.connectWorkspace\(workspace\.workspaceId\)[\s\S]*?ctx\.conversation\.input\.for\(scope\)\.setDraft\(prompt\)[\s\S]*?ctx\.sessions\.open\(sessionId\)/u)
    expect(registration).toMatch(/ctx\.workspaces\.pickDirectory\(\)[\s\S]*?path === null[\s\S]*?ctx\.workspaces\.create\(\{ path \}\)/u)
    expect(plugin).not.toMatch(/setInterval|setTimeout|schedule_create|schedule_delete/u)
  })

  it('uses the native Workspace and Composer path when none exists, and stops cleanly when selection is cancelled', async () => {
    history.replaceState(null, '', '/schedules')
    const setDraft = vi.fn()
    const open = vi.fn()
    const create = vi.fn(async () => ({ workspaceId: 'workspace-1' }))
    const connectWorkspace = vi.fn(async () => 'session-1')
    const ctx = {
      sessions: {
        list: { getSnapshot: () => ({ current: undefined }) },
        scope: (id: string) => ({ id }),
        open,
      },
      workspaces: {
        list: { getSnapshot: () => ({ items: [] }) },
        pickDirectory: vi.fn(async () => '/work/project'),
        create,
        connectWorkspace,
      },
      conversation: { input: { for: () => ({ setDraft }) } },
    }

    await prepareSchedulePromptFromRoute(ctx, '创建日报')
    expect(create).toHaveBeenCalledWith({ path: '/work/project' })
    expect(connectWorkspace).toHaveBeenCalledWith('workspace-1')
    expect(setDraft).toHaveBeenCalledWith('创建日报')
    expect(open).toHaveBeenCalledWith('session-1')
    expect(location.pathname).toBe('/chat/session-1')

    history.replaceState(null, '', '/schedules')
    const cancelledCreate = vi.fn()
    const cancelledConnect = vi.fn()
    const cancelledOpen = vi.fn()
    await expect(prepareSchedulePromptFromRoute({
      sessions: {
        list: { getSnapshot: () => ({ current: undefined }) },
        open: cancelledOpen,
      },
      workspaces: {
        list: { getSnapshot: () => ({ items: [] }) },
        pickDirectory: vi.fn(async () => null),
        create: cancelledCreate,
        connectWorkspace: cancelledConnect,
      },
    }, '创建日报')).rejects.toThrow('请选择项目文件夹后继续。')
    expect(cancelledCreate).not.toHaveBeenCalled()
    expect(cancelledConnect).not.toHaveBeenCalled()
    expect(cancelledOpen).not.toHaveBeenCalled()
    expect(location.pathname).toBe('/schedules')
  })
})
