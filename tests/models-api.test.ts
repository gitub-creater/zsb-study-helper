import { afterEach, describe, expect, it, vi } from 'vitest'
import handler, { validateAiModelsTarget } from '../api/ai/models'

afterEach(() => vi.restoreAllMocks())

describe('AI 模型目录 API', () => {
  it('只允许 HTTPS 上游 /models，拒绝聊天接口和内网地址', () => {
    expect(validateAiModelsTarget('https://relay.example/v1/models')).toBeNull()
    expect(validateAiModelsTarget('https://relay.example/v1/chat/completions')).toContain('/models')
    expect(validateAiModelsTarget('http://relay.example/v1/models')).toContain('HTTPS')
    expect(validateAiModelsTarget('https://127.0.0.1/v1/models')).toContain('内网')
  })

  it('以 GET 请求上游并透传模型目录 JSON', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ data: [{ id: 'model-a' }] }), {
      status: 200,
      headers: { 'content-type': 'application/json', 'x-request-id': 'models-test' },
    }))
    const result = {
      code: 0,
      headers: {} as Record<string, string>,
      body: null as unknown,
      status(code: number) { this.code = code; return this },
      setHeader(name: string, value: string) { this.headers[name] = value },
      json(value: unknown) { this.body = value },
      end() {},
    }
    await handler({
      method: 'POST',
      headers: { origin: 'https://gitub-creater.github.io' },
      body: {
        target: 'https://relay.example/v1/models',
        headers: { Authorization: 'Bearer local-key' },
      },
    }, result)
    expect(fetchMock).toHaveBeenCalledWith('https://relay.example/v1/models', expect.objectContaining({ method: 'GET' }))
    expect((fetchMock.mock.calls[0][1] as RequestInit).headers).toEqual(expect.objectContaining({ Authorization: 'Bearer local-key' }))
    expect(result.code).toBe(200)
    expect(result.headers['X-Upstream-Request-Id']).toBe('models-test')
    expect(result.body).toEqual({ data: [{ id: 'model-a' }] })
  })
})
