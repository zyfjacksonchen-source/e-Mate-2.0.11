import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'

const definitions = [
  {
    id: 'e-mate-user-agreement',
    version: '2026-08-14.1',
    title: 'e-Mate 用户协议与合规使用承诺',
    file: './agreements/e-mate-user-agreement.md',
  },
  {
    id: 'yixin-enterprise-disclaimer',
    version: '2026-08-14.1',
    title: '亦芯企业免责声明与风险提示',
    file: './agreements/yixin-enterprise-disclaimer.md',
  },
]

const sha256 = value => createHash('sha256').update(value).digest('hex')

export const agreementDocuments = Object.freeze(definitions.map(definition => {
  const markdown = readFileSync(new URL(definition.file, import.meta.url), 'utf8')
  return Object.freeze({
    id: definition.id,
    version: definition.version,
    title: definition.title,
    markdown,
    sha256: sha256(markdown),
  })
}))

export const agreementBundleSha256 = sha256(agreementDocuments
  .map(document => `${document.id}:${document.version}:${document.sha256}`)
  .join('\n'))

export const acknowledgementDefinitions = Object.freeze([
  Object.freeze({ id: 'agreements_read', label: '我已完整阅读并理解两份协议。' }),
  Object.freeze({ id: 'ai_output_requires_human_verification', label: '我知悉 AI 输出可能不准确，并承诺在使用前进行人工核实。' }),
  Object.freeze({ id: 'lawful_use_and_ai_labels', label: '我承诺合法合规使用，并按适用规则标识 AI 生成内容。' }),
])

export const requiredAcknowledgements = Object.freeze(
  acknowledgementDefinitions.map(definition => definition.id),
)

export function describeAgreements(providerLegalName = undefined) {
  const provider = typeof providerLegalName === 'string' && providerLegalName.trim() !== ''
    ? providerLegalName.trim()
    : undefined
  return {
    ready: provider !== undefined,
    blocker: provider === undefined ? 'provider-identity-not-configured' : undefined,
    provider_legal_name: provider,
    bundle_sha256: agreementBundleSha256,
    required_acknowledgements: [...requiredAcknowledgements],
    acknowledgements: acknowledgementDefinitions.map(definition => ({ ...definition })),
    documents: agreementDocuments.map(document => ({ ...document })),
  }
}
