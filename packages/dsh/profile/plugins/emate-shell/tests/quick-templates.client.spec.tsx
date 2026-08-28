// @vitest-environment jsdom
import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { prepareTemplateDraftFromRoute } from '../src/client/index.ts'
import { OFFICE_TEMPLATES, QuickTemplates } from '../src/client/quick-templates.tsx'

afterEach(() => {
  cleanup()
  document.body.replaceChildren()
  history.replaceState(null, '', '/')
})

function context(current: string | undefined, blank: boolean, workspaceId = 'general') {
  const setDraft = vi.fn()
  const connectWorkspace = vi.fn(async () => 'session-new')
  const state = {
    current,
    byId: current === undefined ? {} : { [current]: { blank } },
  }
  const ctx = {
    workspaces: {
      list: { getSnapshot: () => ({
        baselinesReady: true,
        items: workspaceId === 'general'
          ? [{ workspaceId: 'general', title: '通用会话', path: '/tmp/e-mate/general', sessionIds: current === undefined ? [] : [current] }]
          : [
              { workspaceId, title: '项目 A', path: '/work/project-a', sessionIds: current === undefined ? [] : [current] },
              { workspaceId: 'general', title: '通用会话', path: '/tmp/e-mate/general', sessionIds: [] },
            ],
      }) },
      connectWorkspace,
    },
    sessions: {
      list: { getSnapshot: () => state, subscribe: () => () => {} },
      open: vi.fn((id: string) => { state.current = id; state.byId[id] = { blank: true } }),
      scope: (id: string) => ({ sessionId: id }),
    },
    conversation: { input: { for: () => ({ setDraft }) } },
  }
  return { ctx, setDraft, connectWorkspace }
}

describe('T11 office quick templates', () => {
  it('renders exactly twelve office templates and only delegates an editable draft before focusing Composer', async () => {
    const prepareDraft = vi.fn(async () => {})
    const composer = document.createElement('div')
    composer.dataset.slot = 'conversation.composer.bar'
    const textarea = document.createElement('textarea')
    composer.append(textarea)
    document.body.append(composer)
    render(<QuickTemplates prepareDraft={prepareDraft} />)

    expect(OFFICE_TEMPLATES).toHaveLength(12)
    expect(screen.getAllByRole('button')).toHaveLength(12)
    fireEvent.click(screen.getByRole('button', { name: /周报总结/u }))
    await waitFor(() => { expect(prepareDraft).toHaveBeenCalledWith(OFFICE_TEMPLATES[0][1]) })
    expect(document.activeElement).toBe(textarea)
    expect(document.querySelector('form')).toBeNull()
  })

  it('keeps an existing project Session while preparing a template draft without creating or sending', async () => {
    const { ctx, setDraft, connectWorkspace } = context('project-session', false, 'project-a')
    await prepareTemplateDraftFromRoute(ctx, '整理会议纪要')
    expect(connectWorkspace).not.toHaveBeenCalled()
    expect(ctx.sessions.open).not.toHaveBeenCalled()
    expect(setDraft).toHaveBeenCalledOnce()
    expect(setDraft).toHaveBeenCalledWith('整理会议纪要')
  })

  it('uses the existing Workspace connect seam when no blank Session exists, then opens and drafts once', async () => {
    const { ctx, setDraft, connectWorkspace } = context(undefined, false)
    await prepareTemplateDraftFromRoute(ctx, '制作工作计划')
    expect(connectWorkspace).toHaveBeenCalledOnce()
    expect(connectWorkspace).toHaveBeenCalledWith('general')
    expect(ctx.sessions.open).toHaveBeenCalledWith('session-new')
    expect(setDraft).toHaveBeenCalledOnce()
    expect(setDraft).toHaveBeenCalledWith('制作工作计划')
  })
})
