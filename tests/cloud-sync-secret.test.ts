import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  downloadCloudState,
  removeAiApiKeyFromCloudState,
  retainLocalAiApiKey,
  uploadCloudState,
} from '../src/services/cloud'
import type { State } from '../src/types'

function stateWithApiKey(apiKey: string): State {
  return {
    settings: {
      ai: {
        provider: 'openai-compatible',
        baseURL: 'https://example.test/v1',
        apiKey,
        model: 'test-model',
      },
    },
  } as State
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('云同步 AI 密钥隔离', () => {
  it('下载历史云端快照时无条件清除其中的 API Key，且不修改响应对象', async () => {
    const oldCloudState = stateWithApiKey('old-cloud-key')
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ state: oldCloudState }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const downloaded = await downloadCloudState({ token: 'token', apiUrl: 'https://sync.example.test' })

    expect(downloaded?.settings.ai?.apiKey).toBe('')
    expect(downloaded).not.toBe(oldCloudState)
    expect(oldCloudState.settings.ai?.apiKey).toBe('old-cloud-key')
    expect(fetchMock).toHaveBeenCalledWith(
      'https://sync.example.test/api/state',
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer token' }) })
    )
  })

  it('本机已有密钥始终优先，即使调用方传入了带密钥的旧远端状态', () => {
    const merged = retainLocalAiApiKey(stateWithApiKey('old-cloud-key'), stateWithApiKey('current-device-key'))

    expect(merged.settings.ai?.apiKey).toBe('current-device-key')
    expect(merged.settings.ai).toMatchObject({ provider: 'openai-compatible', model: 'test-model' })
  })

  it('上传快照也会发送不含 API Key 的副本', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) })
    vi.stubGlobal('fetch', fetchMock)

    await expect(uploadCloudState({ token: 'token', apiUrl: 'https://sync.example.test' }, stateWithApiKey('device-key'))).resolves.toBe(true)

    const request = fetchMock.mock.calls[0]?.[1] as RequestInit
    const body = JSON.parse(String(request.body)) as { state: State }
    expect(body.state.settings.ai?.apiKey).toBe('')
    expect(removeAiApiKeyFromCloudState(null)).toBeNull()
  })
})
