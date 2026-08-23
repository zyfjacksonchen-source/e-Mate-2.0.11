import { clientBundle } from '../../upstream/deepseek-harness/packages/client/tsdown.client.ts'

export default clientBundle('@e-mate/dsh-plugin-glass-composer', ['src/index.ts', 'src/settings.ts'], {
  lib: {
    deps: {
      neverBundle: [/^@deepseek-ai\//],
      onlyBundle: false,
    },
  },
})
