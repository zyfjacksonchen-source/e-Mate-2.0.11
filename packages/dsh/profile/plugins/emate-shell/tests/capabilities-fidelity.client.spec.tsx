// @vitest-environment jsdom
import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CapabilitiesPage } from '../src/client/capabilities.tsx'

const SHA256 = 'a'.repeat(64)
const Icon = () => <svg aria-hidden="true" />

const capabilityItems = [
  { id: 'office-live', title: 'Office', summary: '创建与编辑办公文档', icon_key: 'office', order: 2, state: 'ready', actions: [{ id: 'check', label: '自检', kind: 'secondary' }] },
  { id: 'image-live', title: '生图与改图', summary: '使用当前图像模型', icon_key: 'image', order: 1, state: 'setup-required', actions: [] },
] as const

const hubCard = {
  slug: 'meeting-notes',
  version: '1.2.3',
  package_sha256: SHA256,
  title: '会议纪要',
  summary: '把会议内容整理成行动项。',
  category: 'office_productivity',
  tags: ['office', 'meeting'],
} as const

beforeEach(() => {
  history.replaceState(null, '', '/capabilities')
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    disconnect() {}
  })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  history.replaceState(null, '', '/')
})

function renderPage(callSkillHub = vi.fn(async (endpoint: string) => {
  if (endpoint === 'catalog.search') return { ok: true, value: { items: [hubCard] } }
  if (endpoint === 'catalog.detail') return { ok: true, value: { skill: hubCard, versions: [hubCard] } }
  return { ok: true, value: { job_id: 'job-12345678', status: 'running' } }
})) {
  const callCapabilities = vi.fn(async (endpoint: string) => endpoint === 'list'
    ? { ok: true, value: { schema_version: 1, items: capabilityItems } }
    : { ok: true, value: { accepted: true } })
  render(<CapabilitiesPage
    useSessions={selector => selector({ current: 'session-1' })}
    callCapabilities={callCapabilities}
    callSkillHub={callSkillHub}
    listInstalled={async () => [{ name: 'installed-skill', description: '真实会话 Skill', modelInvocable: true }]}
    startSession={() => {}}
    SearchIcon={Icon}
    DownloadIcon={Icon}
    CloseIcon={Icon}
    RefreshIcon={Icon}
    SkillIcon={Icon}
    capabilityIcons={{ browser: Icon, collaboration: Icon, image: Icon, office: Icon, ocr: Icon }}
  />)
  return { callCapabilities, callSkillHub }
}

describe('capability center fidelity surface', () => {
  it('keeps the target sidebar column and presents Skill Hub before built-in capabilities', async () => {
    renderPage()
    const page = document.querySelector<HTMLElement>('[data-emate-capabilities]')
    const hub = await screen.findByRole('region', { name: 'Skill Hub' })
    const builtins = screen.getByText('本机内置能力').closest('details')

    expect(page?.style.left).toBe('280px')
    expect(hub.compareDocumentPosition(builtins!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.getByRole('tab', { name: '发现' })).toBeTruthy()
    expect(screen.getByRole('tab', { name: /已安装/ })).toBeTruthy()
    expect(screen.getByRole('tab', { name: '导入' })).toBeTruthy()
  })

  it('keeps dynamic capability categories and real capability actions live', async () => {
    const { callCapabilities } = renderPage()
    expect(await screen.findByText('生图与改图')).toBeTruthy()
    expect(screen.getByText('Office')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /办公能力/ }))
    expect(screen.queryByText('生图与改图')).toBeNull()
    expect(screen.getByText('Office')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '自检' }))
    await waitFor(() => expect(callCapabilities).toHaveBeenCalledWith('action', {
      capability_id: 'office-live',
      action_id: 'check',
      data: {},
    }))
    expect(await screen.findByText('Office 已提交操作。')).toBeTruthy()
  })

  it('opens the real Hub detail and starts its download job', async () => {
    const { callSkillHub } = renderPage()
    fireEvent.click(await screen.findByRole('button', { name: '查看详情' }))
    expect(await screen.findByRole('dialog', { name: '会议纪要' })).toBeTruthy()
    expect(screen.getByText(SHA256)).toBeTruthy()
    expect(screen.getByText('v1.2.3')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /下载 ZIP/ }))
    await waitFor(() => expect(callSkillHub).toHaveBeenCalledWith('skills.download', {
      slug: 'meeting-notes',
      version: '1.2.3',
    }))
  })

  it('publishes the selected ZIP through the existing Skill Hub action', async () => {
    const { callSkillHub } = renderPage()
    fireEvent.click(screen.getByRole('tab', { name: '导入' }))
    const file = new File([new Uint8Array([80, 75, 3, 4])], 'office-helper.zip', { type: 'application/zip' })
    if (typeof file.arrayBuffer !== 'function') Object.defineProperty(file, 'arrayBuffer', { value: async () => new Uint8Array([80, 75, 3, 4]).buffer })
    fireEvent.change(screen.getByLabelText('选择 Skill ZIP'), { target: { files: [file] } })
    fireEvent.click(screen.getByRole('button', { name: '验证并发布' }))
    await waitFor(() => expect(callSkillHub).toHaveBeenCalledWith('skills.publish', {
      bundle_base64: 'UEsDBA==',
      category: 'office_productivity',
    }))
  })
})
