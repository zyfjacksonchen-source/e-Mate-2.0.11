import { clientBundle } from '../../../../../upstream/deepseek-harness/packages/client/tsdown.client.ts'

const bundle = clientBundle('@deepseek-ai/dsh-client-ui-sidebar', [])

export default (context: Parameters<typeof bundle>[0]) => bundle(context).slice(-1)
