import { describe, expect, it } from 'vitest'
import { bundledPythonPath, visionConfigFromModelSettings } from '../src/vision-toolkit.ts'

describe('desktop Vision Toolkit policy projection', () => {
  it('uses only the enterprise-projected image-capable Luna route', () => {
    const config = visionConfigFromModelSettings({
      providers: {
        'e-mate-enterprise': {
          apiKeyEnv: 'E_MATE_MODEL_KEY_GPT',
          baseURL: 'http://127.0.0.1:8080/v1/',
          models: [{ id: 'gpt-5.6-luna', input: ['text', 'image'] }],
        },
      },
    })
    expect(config?.provider).toEqual({
      baseUrl: 'http://127.0.0.1:8080/v1',
      credential: 'E_MATE_MODEL_KEY_GPT',
      model: 'gpt-5.6-luna',
      protocol: 'openai',
    })
    expect(config?.runtime).toEqual({ mode: 'managed', python: bundledPythonPath() })
  })

  it('fails closed for a user-controlled or text-only route', () => {
    expect(visionConfigFromModelSettings({
      providers: {
        'e-mate-enterprise': {
          apiKeyEnv: 'USER_KEY',
          baseURL: 'https://example.com/v1',
          models: [{ id: 'gpt-5.6-luna', input: ['text', 'image'] }],
        },
      },
    })).toBeUndefined()
    expect(visionConfigFromModelSettings({
      providers: {
        'e-mate-enterprise': {
          apiKeyEnv: 'E_MATE_MODEL_KEY_GPT',
          baseURL: 'https://example.com/v1',
          models: [{ id: 'gpt-5.6-luna', input: ['text'] }],
        },
      },
    })).toBeUndefined()
  })
})
