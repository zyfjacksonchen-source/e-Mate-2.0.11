import { fileURLToPath } from 'node:url'

const upstreamModules = fileURLToPath(new URL(
  '../../../../../upstream/deepseek-harness/node_modules/',
  import.meta.url,
))
const upstreamPrimitives = fileURLToPath(new URL(
  '../../../../../upstream/deepseek-harness/packages/client/ui-primitives/lib/index.js',
  import.meta.url,
))
const upstreamRuntime = fileURLToPath(new URL(
  '../../../../../upstream/deepseek-harness/packages/client/runtime/lib/client.js',
  import.meta.url,
))

export default {
  resolve: {
    alias: {
      'react-dom': `${upstreamModules}.pnpm/node_modules/react-dom`,
      react: `${upstreamModules}.pnpm/node_modules/react`,
      '@testing-library/react': `${upstreamModules}@testing-library/react`,
      '@deepseek-ai/dsh-client-ui-primitives': upstreamPrimitives,
      '@deepseek-ai/dsh-client-runtime/client': upstreamRuntime,
    },
  },
}
