import assert from 'node:assert/strict'
import test from 'node:test'
import { projectComputerUseStatus } from '../src/emate-capability.ts'

test('OS-ready Computer Use remains setup-required without configured application control', () => {
  assert.deepEqual(projectComputerUseStatus({
    ready: true,
    accessibility: 'granted',
    screenRecording: 'granted',
    applicationAccess: { allowAllApps: false, readGrants: 0, controlGrants: 0 },
  }), {
    state: 'setup-required',
    detail: 'macOS 权限已就绪，但尚未在 Computer Use 设置中授权任何应用操作。',
    action_ids: [],
  })
  assert.deepEqual(projectComputerUseStatus({
    ready: true,
    accessibility: 'granted',
    screenRecording: 'granted',
    applicationAccess: { allowAllApps: false, readGrants: 1, controlGrants: 1 },
  }), {
    state: 'ready',
    detail: '原生 helper、macOS 权限和应用操作授权均已就绪。',
    action_ids: [],
  })
})

test('Windows Computer Use reports native readiness without macOS settings actions', () => {
  assert.deepEqual(projectComputerUseStatus({
    platform: 'win32', provider: 'windows-uia', ready: true,
    accessibility: 'granted', screenRecording: 'granted',
    applicationAccess: { allowAllApps: false, readGrants: 1, controlGrants: 1 },
  }), {
    state: 'ready',
    detail: '原生 helper、Windows UI Automation、窗口捕获和应用操作授权均已就绪。',
    action_ids: [],
  })
  assert.deepEqual(projectComputerUseStatus({
    platform: 'win32', provider: 'windows-uia', ready: true,
    accessibility: 'denied', screenRecording: 'granted',
  }), {
    state: 'blocked',
    detail: 'Windows UI Automation、窗口捕获或输入权限不可用。',
    action_ids: [],
  })
})
