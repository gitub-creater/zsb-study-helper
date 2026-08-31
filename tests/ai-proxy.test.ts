import { afterEach, describe, expect, it, vi } from 'vitest'
import handler, { validateAiProxyTarget } from '../api/ai/proxy'

afterEach(() => vi.restoreAllMocks())

describe('AI 应用中转安全校验', () => {
  it('允许标准 OpenAI Chat Completions 和 Responses HTTPS 地址', () => {
    expect(validateAiProxyTarget('https://relay.example/v1/chat/completions')).toBeNull()
    expect(validateAiProxyTarget('https://relay.example/v1/responses')).toBeNull()
  })

  it('拒绝非标准接口、非 HTTPS 与内网目标，避免中转成为开放代理', () => {
    expect(validateAiProxyTarget('https://relay.example/v1/models')).toContain('chat/completions')
    expect(validateAiProxyTarget('http://relay.example/v1/chat/completions')).toContain('HTTPS')
    expect(validateAiProxyTarget('https://127.0.0.1/v1/chat/completions')).toContain('内网')
    expect(validateAiProxyTarget('https://192.168.1.10/v1/responses')).toContain('内网')
  })

  it('转发认证头和标准请求体，并透传上游的流式响应', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('data: {"choices":[{"delta":{"content":"你好"}}]}\n\ndata: [DONE]\n\n', {
      status: 200,
      headers: { 'content-type': 'text/event-stream', 'x-request-id': 'upstream-test' },
    }))
    const result = {
      code: 0,
      headers: {} as Record<string, string>,
      chunks: [] as Uint8Array[],
      status(code: number) { this.code = code; return this },
      setHeader(name: string, value: string) { this.headers[name] = value },
      json(value: unknown) { this.chunks.push(new TextEncoder().encode(JSON.stringify(value))) },
      write(chunk: Uint8Array) { this.chunks.push(chunk) },
      end() {},
    }

    await handler({
      method: 'POST',
      headers: { origin: 'https://gitub-creater.github.io' },
      body: {
        target: 'https://relay.example/v1/chat/completions',
        headers: { Authorization: 'Bearer local-key', 'X-Relay': 'study' },
        payload: { model: 'study-model', stream: true, messages: [{ role: 'user', content: 'hi' }] },
      },
    }, result)

    expect(fetchMock).toHaveBeenCalledWith('https://relay.example/v1/chat/completions', expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({ Authorization: 'Bearer local-key', 'X-Relay': 'study' }),
    }))
    expect(result.code).toBe(200)
    expect(result.headers['Content-Type']).toContain('text/event-stream')
    expect(result.headers['X-Upstream-Request-Id']).toBe('upstream-test')
    expect(new TextDecoder().decode(result.chunks[0])).toContain('"你好"')
  })
})
