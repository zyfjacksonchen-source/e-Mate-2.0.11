import { clientBundle } from '../../../../../upstream/deepseek-harness/packages/client/tsdown.client.ts'

export default clientBundle('@deepseek-ai/dsh-client-ui-sidebar', ['src/index.ts'], {
  lib: {
    outDir: '.',
    deps: {
      neverBundle: [/^@deepseek-ai\//],
      onlyBundle: false,
    },
  },
})
