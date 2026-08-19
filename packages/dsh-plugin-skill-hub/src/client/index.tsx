import {
  IconBrowseOutline16,
  IconCloseOutline16,
  IconDataOutline16,
  IconDownloadOutline16,
  IconEnhanceOutline16,
  IconLinkOutline16,
  IconListPenOutline16,
  IconRefreshOutline16,
  IconSearchOutline16,
  IconSkillOutline16,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { CapabilitiesPage, CapabilityControl } from './capabilities.tsx'

export const inject = ['slots', 'connection']

export function apply(ctx: any): void {
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'e-mate-capabilities',
    order: -10,
    inject: () => ({
      callCapabilities: (endpoint: string, payload: Record<string, unknown>) =>
        ctx.connection.rpc.call('/emate.capabilities', endpoint, payload),
      callSkillHub: (endpoint: string, payload: Record<string, unknown>) =>
        ctx.connection.rpc.call('/emate.skillHub', endpoint, payload),
      SearchIcon: IconSearchOutline16,
      DownloadIcon: IconDownloadOutline16,
      CloseIcon: IconCloseOutline16,
      RefreshIcon: IconRefreshOutline16,
      SkillIcon: IconSkillOutline16,
      capabilityIcons: {
        browser: IconBrowseOutline16,
        collaboration: IconLinkOutline16,
        image: IconEnhanceOutline16,
        office: IconListPenOutline16,
        ocr: IconDataOutline16,
      },
    }),
  }, CapabilitiesPage))
  ctx.slots.inject('sidebar.primary.action', () => ctx.slots.register({
    name: 'sidebar.primary.action',
    id: 'e-mate-capabilities-entry',
    order: 20,
    inject: () => ({ SkillIcon: IconSkillOutline16 }),
  }, CapabilityControl))
}

export { CapabilitiesPage, CapabilityControl } from './capabilities.tsx'
