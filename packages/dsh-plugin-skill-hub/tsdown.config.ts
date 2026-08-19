import { clientBundle } from '../../upstream/deepseek-harness/packages/client/tsdown.client.ts'

export default clientBundle('@e-mate/dsh-plugin-skill-hub', ['src/index.ts', 'src/skill-hub.ts'], {
  lib: { noExternal: ['fflate', 'yaml'] },
})
