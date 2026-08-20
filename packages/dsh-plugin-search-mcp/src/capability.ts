export interface SearchCapabilityInput {
  server: 'missing' | 'invalid' | 'configured'
  needsCredential: boolean
  credentialRef: string
  credentialConfigured: boolean
  credentialWritable: boolean
}

export const SEARCH_CREDENTIAL_ACTION = 'configure-credential'

export function searchCapabilityStatus(input: SearchCapabilityInput) {
  if (input.server === 'missing') return { state: 'setup-required', detail: '尚未配置 MCP 搜索服务。', action_ids: [], credential_refs: {} }
  if (input.server === 'invalid') return { state: 'blocked', detail: '默认 MCP 搜索服务不在当前配置中。', action_ids: [], credential_refs: {} }
  if (input.needsCredential && input.credentialRef.length === 0) {
    return { state: 'setup-required', detail: 'MCP 搜索服务尚未绑定凭据引用。', action_ids: [], credential_refs: {} }
  }
  if (input.needsCredential && !input.credentialConfigured) {
    return {
      state: 'setup-required',
      detail: 'MCP 搜索凭据尚未在本机配置。',
      action_ids: input.credentialWritable ? [SEARCH_CREDENTIAL_ACTION] : [],
      credential_refs: input.credentialWritable ? { [SEARCH_CREDENTIAL_ACTION]: input.credentialRef } : {},
    }
  }
  return {
    state: 'ready',
    detail: 'MCP 搜索配置与本机凭据已就绪。',
    action_ids: input.credentialWritable ? [SEARCH_CREDENTIAL_ACTION] : [],
    credential_refs: input.credentialWritable ? { [SEARCH_CREDENTIAL_ACTION]: input.credentialRef } : {},
  }
}
