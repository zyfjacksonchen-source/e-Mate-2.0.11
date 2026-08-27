import { useCallback, useSyncExternalStore } from 'react'
import type { SettingsScope } from '@deepseek-ai/dsh-client-runtime/client'
import css from './message-mode-settings.module.css'

export const MESSAGE_FLOW_SETTINGS_NAMESPACE = 'e-mate'
export const MESSAGE_FLOW_MODE_FIELD = 'messageFlowMode'
export const MESSAGE_FLOW_MODES = ['simple', 'detailed'] as const

export type MessageFlowMode = typeof MESSAGE_FLOW_MODES[number]

export interface MessageFlowSettings {
  readonly messageFlowMode: MessageFlowMode
}

/** The browser stays fail-closed to the compact presentation for any bad envelope. */
export function decodeMessageFlowSettings(value: unknown): MessageFlowSettings {
  const mode = value !== null && typeof value === 'object'
    ? (value as { messageFlowMode?: unknown }).messageFlowMode
    : undefined
  return { messageFlowMode: mode === 'detailed' ? 'detailed' : 'simple' }
}

export function currentMessageFlowMode(scope: SettingsScope<MessageFlowSettings>): MessageFlowMode {
  return decodeMessageFlowSettings(scope.getSnapshot().value).messageFlowMode
}

export function MessageModeSettings({ scope }: { readonly scope: SettingsScope<MessageFlowSettings> }) {
  const subscribe = useCallback((listener: () => void) => scope.subscribe(listener), [scope])
  const getSnapshot = useCallback(() => scope.getSnapshot(), [scope])
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  const mode = decodeMessageFlowSettings(snapshot.value).messageFlowMode

  return <label className={css.row}>
    <span className={css.copy}>
      <strong>消息显示</strong>
      <span>简约模式收起运行过程，详细模式按原顺序显示完整过程。</span>
    </span>
    <select
      className={css.select}
      aria-label="消息显示模式"
      value={mode}
      disabled={snapshot.status !== 'ready' || !snapshot.writable}
      onChange={(event) => {
        const next = event.currentTarget.value
        if (next !== 'simple' && next !== 'detailed') return
        void scope.set(MESSAGE_FLOW_MODE_FIELD, next)
      }}
    >
      <option value="simple">简约</option>
      <option value="detailed">详细</option>
    </select>
  </label>
}

/** Bind one Host-backed namespace and expose its one Settings row. */
export function registerMessageModeSettings(ctx: any): SettingsScope<MessageFlowSettings> {
  const scope = ctx.settingsScope.bind<MessageFlowSettings>({
    namespace: MESSAGE_FLOW_SETTINGS_NAMESPACE,
    decode: decodeMessageFlowSettings,
  })
  ctx.slots.inject('settings.general.item', () => ctx.slots.register({
    name: 'settings.general.item',
    id: 'message-flow-mode',
    order: 30,
    inject: () => ({ scope }),
  }, MessageModeSettings))
  return scope
}
