import { afterEach, describe, expect, it, vi } from 'vitest'
import { AiRequestError, aiChat, aiChatStream, aiEndpoint, sseDataDelta } from '../src/services/ai'

const cfg = { provider: 'custom' as const, baseURL: 'https://relay.example/v1/', apiKey: 'test-key', model: 'test-model' }

afterEach(() => vi.restoreAllMocks())

describe('OpenAI-compatible AI 接口', () => {
  it('Base URL 已包含 /v1 时只追加一次标准路径', () => {
    expect(aiEndpoint('https://api.openai.com/v1/', 'chat')).toBe('https://api.openai.com/v1/chat/completions')
    expect(aiEndpoint('https://relay.example/v1/chat/completions', 'chat')).toBe('https://relay.example/v1/chat/completions')
    expect(aiEndpoint('https://relay.example/v1', 'responses')).toBe('https://relay.example/v1/responses')
  })

  it('发送标准 messages/model/stream 和自定义请求头', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: '连接成功' } }] }), { status: 200, headers: { 'content-type': 'application/json' } }))
    await expect(aiChat({ ...cfg, customHeaders: { 'X-Relay': 'yes' } }, [{ role: 'user', content: 'hi' }])).resolves.toBe('连接成功')
    const request = fetchMock.mock.calls[0][1] as RequestInit
    expect(fetchMock.mock.calls[0][0]).toBe('https://relay.example/v1/chat/completions')
    expect(JSON.parse(String(request.body))).toMatchObject({ model: 'test-model', stream: false, messages: [{ role: 'user', content: 'hi' }] })
    expect(new Headers(request.headers).get('X-Relay')).toBe('yes')
  })

  it('自动模式在浏览器直连被 CORS 拦截时改走应用中转', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: '中转连接成功' } }] }), { status: 200, headers: { 'content-type': 'application/json' } }))

    await expect(aiChat({ ...cfg, transport: 'auto', proxyURL: 'https://study.example/api/ai/proxy' }, [{ role: 'user', content: 'hi' }])).resolves.toBe('中转连接成功')
    expect(fetchMock.mock.calls[0][0]).toBe('https://relay.example/v1/chat/completions')
    expect(fetchMock.mock.calls[1][0]).toBe('https://study.example/api/ai/proxy')
    const body = JSON.parse(String((fetchMock.mock.calls[1][1] as RequestInit).body))
    expect(body.target).toBe('https://relay.example/v1/chat/completions')
    expect(body.headers.authorization).toBe('Bearer test-key')
    expect(body.payload).toMatchObject({ model: 'test-model', stream: false })
  })

  it('解析 OpenAI SSE delta 和 Responses delta', () => {
    expect(sseDataDelta('data: {"choices":[{"delta":{"content":"你好"}}]}')).toBe('你好')
    expect(sseDataDelta('data: {"type":"response.output_text.delta","delta":"世界"}')).toBe('世界')
    expect(sseDataDelta('data: [DONE]')).toBeNull()
  })

  it('支持 SSE 流式响应并逐段回调', async () => {
    const body = new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"甲"}}]}\n\ndata: {"choices":[{"delta":{"content":"乙"}}]}\n\ndata: [DONE]\n\n')); controller.close() } })
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } }))
    const deltas: string[] = []
    await expect(aiChatStream({ ...cfg, stream: true }, [{ role: 'user', content: 'hi' }], { onDelta: (delta) => deltas.push(delta) })).resolves.toBe('甲乙')
    expect(deltas).toEqual(['甲', '乙'])
  })

  it('认证失败保留 HTTP 状态、服务商错误和重试建议', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify({ error: { message: 'invalid api key' } }), { status: 401, headers: { 'content-type': 'application/json' } }))
    await expect(aiChat(cfg, [{ role: 'user', content: 'hi' }])).rejects.toMatchObject({ status: 401 })
    try { await aiChat(cfg, [{ role: 'user', content: 'hi' }]) } catch (error) {
      expect(error).toBeInstanceOf(AiRequestError)
      expect((error as Error).message).toContain('invalid api key')
      expect((error as Error).message).toContain('API Key')
    }
  })
})
