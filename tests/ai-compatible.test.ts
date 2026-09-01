import { afterEach, describe, expect, it, vi } from 'vitest'
import { AiRequestError, aiChat, aiChatStream, aiEndpoint, aiModels, aiModelsEndpoint, parseAiModels, sseDataDelta } from '../src/services/ai'

const cfg = { provider: 'custom' as const, baseURL: 'https://relay.example/v1/', apiKey: 'test-key', model: 'test-model' }

afterEach(() => vi.restoreAllMocks())

describe('OpenAI-compatible AI 接口', () => {
  it('Base URL 已包含 /v1 时只追加一次标准路径', () => {
    expect(aiEndpoint('https://api.openai.com/v1/', 'chat')).toBe('https://api.openai.com/v1/chat/completions')
    expect(aiEndpoint('https://relay.example/v1/chat/completions', 'chat')).toBe('https://relay.example/v1/chat/completions')
    expect(aiEndpoint('https://relay.example/v1', 'responses')).toBe('https://relay.example/v1/responses')
    expect(aiModelsEndpoint('https://relay.example/v1/')).toBe('https://relay.example/v1/models')
    expect(aiModelsEndpoint('https://relay.example/v1/chat/completions')).toBe('https://relay.example/v1/models')
    expect(aiEndpoint('https://relay.example/v1/?project=study&sig=/', 'chat')).toBe('https://relay.example/v1/chat/completions?project=study&sig=/')
    expect(aiModelsEndpoint('https://relay.example/?project=study')).toBe('https://relay.example/models?project=study')
  })

  it('解析标准 data 目录并去重模型 ID', () => {
    expect(parseAiModels({ data: [{ id: 'alpha', owned_by: 'team' }, { id: 'alpha' }, { id: 'beta', name: 'Beta' }] })).toEqual([
      { id: 'alpha', name: 'alpha', ownedBy: 'team' },
      { id: 'beta', name: 'Beta', ownedBy: undefined },
    ])
  })

  it('兼容网关使用 model、model_id、slug 或 display_name 字段', () => {
    expect(parseAiModels({ models: [
      { model: 'model-field', display_name: '模型字段' },
      { model_id: 'model-id-field', name: '模型 ID 字段' },
      { slug: 'slug-field' },
    ] })).toEqual([
      { id: 'model-field', name: '模型字段', ownedBy: undefined },
      { id: 'model-id-field', name: '模型 ID 字段', ownedBy: undefined },
      { id: 'slug-field', name: 'slug-field', ownedBy: undefined },
    ])
  })

  it('读取上游 GET /models 并保留认证头', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ data: [{ id: 'model-a' }] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }))
    await expect(aiModels({ ...cfg, transport: 'direct' })).resolves.toEqual([{ id: 'model-a', name: 'model-a', ownedBy: undefined }])
    expect(fetchMock.mock.calls[0][0]).toBe('https://relay.example/v1/models')
    const request = fetchMock.mock.calls[0][1] as RequestInit
    expect(request.method).toBe('GET')
    expect(new Headers(request.headers).get('Authorization')).toBe('Bearer test-key')
  })

  it('模型目录在自动模式遇到跨域时走模型专用中转接口', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ id: 'model-a' }] }), { status: 200, headers: { 'content-type': 'application/json' } }))
    await expect(aiModels({ ...cfg, transport: 'auto', proxyURL: 'https://study.example/api/ai/proxy' })).resolves.toHaveLength(1)
    expect(fetchMock.mock.calls[1][0]).toBe('https://study.example/api/ai/models')
    const body = JSON.parse(String((fetchMock.mock.calls[1][1] as RequestInit).body))
    expect(body.target).toBe('https://relay.example/v1/models')
    expect(body.headers.authorization).toBe('Bearer test-key')
  })

  it('自动模式把直连返回的 200 HTML 回退页识别为失败并改走中转', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('<!doctype html><html></html>', { status: 200, headers: { 'content-type': 'text/html' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ id: 'model-a' }] }), { status: 200, headers: { 'content-type': 'application/json' } }))

    await expect(aiModels({ ...cfg, baseURL: 'https://relay.example/v1', transport: 'auto', proxyURL: 'https://study.example' })).resolves.toHaveLength(1)
    expect(fetchMock.mock.calls[0][0]).toBe('https://relay.example/v1/models')
    expect(fetchMock.mock.calls[1][0]).toBe('https://study.example/api/ai/models')
  })

  it('发送标准 messages/model/stream 和自定义请求头', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: '连接成功' } }] }), { status: 200, headers: { 'content-type': 'application/json' } }))
    await expect(aiChat({ ...cfg, customHeaders: { 'X-Relay': 'yes' } }, [{ role: 'user', content: 'hi' }])).resolves.toBe('连接成功')
    const request = fetchMock.mock.calls[0][1] as RequestInit
    expect(fetchMock.mock.calls[0][0]).toBe('https://relay.example/v1/chat/completions')
    expect(JSON.parse(String(request.body))).toMatchObject({ model: 'test-model', stream: false, messages: [{ role: 'user', content: 'hi' }] })
    expect(new Headers(request.headers).get('X-Relay')).toBe('yes')
  })

  it('根地址遇到 404 时自动尝试 /v1 标准端点', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: 'route not found' } }), { status: 404 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: '版本路径连接成功' } }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }))

    await expect(aiChat({ ...cfg, baseURL: 'https://relay.example', apiMode: 'chat' }, [{ role: 'user', content: 'hi' }])).resolves.toBe('版本路径连接成功')
    expect(fetchMock.mock.calls[0][0]).toBe('https://relay.example/chat/completions')
    expect(fetchMock.mock.calls[1][0]).toBe('https://relay.example/v1/chat/completions')
  })

  it('模型目录根地址遇到 405 时自动尝试 /v1/models', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('', { status: 405 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ id: 'versioned-model' }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }))

    await expect(aiModels({ ...cfg, baseURL: 'https://relay.example', transport: 'direct' })).resolves.toEqual([
      { id: 'versioned-model', name: 'versioned-model', ownedBy: undefined },
    ])
    expect(fetchMock.mock.calls[0][0]).toBe('https://relay.example/models')
    expect(fetchMock.mock.calls[1][0]).toBe('https://relay.example/v1/models')
  })

  it('Responses 模式将各角色的 Chat 文本和图片消息转换为 input 分片', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ output_text: '讲解完成' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }))

    await expect(aiChat({ ...cfg, apiMode: 'responses', maxTokens: 320 }, [
      { role: 'system', content: '你是一名耐心的数学老师。' },
      {
        role: 'user',
        content: [
          { type: 'text', text: '请讲解这道题。' },
          { type: 'image_url', image_url: { url: 'data:image/png;base64,abc' } },
        ],
      },
      { role: 'assistant', content: '先观察已知条件。' },
    ])).resolves.toBe('讲解完成')

    expect(fetchMock.mock.calls[0][0]).toBe('https://relay.example/v1/responses')
    const payload = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body))
    expect(payload).toMatchObject({ model: 'test-model', stream: false, max_output_tokens: 320 })
    expect(payload.messages).toBeUndefined()
    expect(payload.max_tokens).toBeUndefined()
    expect(payload.input).toHaveLength(3)
    expect(payload.input.map((message: { role: string }) => message.role)).toEqual(['system', 'user', 'assistant'])
    expect(payload.input[0].content).toHaveLength(1)
    expect(payload.input[0].content[0]).toMatchObject({ type: 'input_text', text: '你是一名耐心的数学老师。' })
    expect(payload.input[1].content).toHaveLength(2)
    expect(payload.input[1].content[0]).toMatchObject({ type: 'input_text', text: '请讲解这道题。' })
    expect(payload.input[1].content[1]).toMatchObject({ type: 'input_image', image_url: 'data:image/png;base64,abc' })
    expect(payload.input[1].content[1]).not.toHaveProperty('image_url.url')
    expect(payload.input[2].content).toHaveLength(1)
    expect(payload.input[2].content[0]).toMatchObject({ type: 'input_text', text: '先观察已知条件。' })
  })

  it('模型拒绝 temperature 时移除该参数并重试一次', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({
        error: { message: "Unsupported parameter: 'temperature' is not supported with this model.", param: 'temperature' },
      }), { status: 400, headers: { 'content-type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: '温度参数已降级' } }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }))

    await expect(aiChat({ ...cfg, temperature: 0.8 }, [{ role: 'user', content: 'hi' }])).resolves.toBe('温度参数已降级')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body))).toMatchObject({ temperature: 0.8 })
    expect(JSON.parse(String((fetchMock.mock.calls[1][1] as RequestInit).body)).temperature).toBeUndefined()
  })

  it('模型拒绝 max_tokens 时改用 max_completion_tokens 并重试', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({
        error: { message: "Unsupported parameter: 'max_tokens'. Use 'max_completion_tokens' instead.", param: 'max_tokens' },
      }), { status: 400, headers: { 'content-type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: '令牌参数已兼容' } }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }))

    await expect(aiChat({ ...cfg, maxTokens: 512 }, [{ role: 'user', content: 'hi' }])).resolves.toBe('令牌参数已兼容')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const firstPayload = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body))
    const retryPayload = JSON.parse(String((fetchMock.mock.calls[1][1] as RequestInit).body))
    expect(firstPayload).toMatchObject({ max_tokens: 512 })
    expect(retryPayload.max_tokens).toBeUndefined()
    expect(retryPayload).toMatchObject({ max_completion_tokens: 512 })
  })

  it('Responses 兼容层要求 max_tokens 时自动改名重试', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({
        error: { message: "Unsupported parameter: 'max_output_tokens'. Use 'max_tokens' instead.", param: 'max_output_tokens' },
      }), { status: 400, headers: { 'content-type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ output_text: 'Responses 参数已兼容' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }))

    await expect(aiChat({ ...cfg, apiMode: 'responses', maxTokens: 512 }, [{ role: 'user', content: 'hi' }])).resolves.toBe('Responses 参数已兼容')
    const firstPayload = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body))
    const retryPayload = JSON.parse(String((fetchMock.mock.calls[1][1] as RequestInit).body))
    expect(firstPayload).toMatchObject({ max_output_tokens: 512 })
    expect(retryPayload.max_output_tokens).toBeUndefined()
    expect(retryPayload).toMatchObject({ max_tokens: 512 })
  })

  it('DeepSeek 推理模型先按兼容默认参数请求,拒绝 temperature 后自动降级', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify({
      error: { message: "Unsupported parameter: 'temperature' is not supported with this model.", param: 'temperature' },
    }), { status: 400, headers: { 'content-type': 'application/json' } })).mockResolvedValueOnce(new Response(JSON.stringify({
      choices: [{ message: { content: '推理模型连接成功' } }],
    }), { status: 200, headers: { 'content-type': 'application/json' } }))

    await expect(aiChat({ ...cfg, model: 'deepseek-reasoner', maxTokens: 1024, temperature: 0.8 }, [
      { role: 'user', content: 'hi' },
    ])).resolves.toBe('推理模型连接成功')

    expect(fetchMock).toHaveBeenCalledTimes(2)
    const firstPayload = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body))
    const retryPayload = JSON.parse(String((fetchMock.mock.calls[1][1] as RequestInit).body))
    expect(firstPayload).toMatchObject({ model: 'deepseek-reasoner', max_tokens: 1024, temperature: 0.8 })
    expect(retryPayload).toMatchObject({ model: 'deepseek-reasoner', max_tokens: 1024 })
    expect(retryPayload.temperature).toBeUndefined()
    expect(retryPayload.max_completion_tokens).toBeUndefined()
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

  it('自动模式直连收到 SPA HTML 时改走应用中转', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('<!doctype html><html><body>app</body></html>', {
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: 'HTML 回退成功' } }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }))

    await expect(aiChat({ ...cfg, transport: 'auto', proxyURL: 'https://study.example' }, [{ role: 'user', content: 'hi' }])).resolves.toBe('HTML 回退成功')
    expect(fetchMock.mock.calls[0][0]).toBe('https://relay.example/v1/chat/completions')
    expect(fetchMock.mock.calls[1][0]).toBe('https://study.example/api/ai/proxy')
  })

  it('自动模式也能识别缺少 HTML Content-Type 的 SPA 回退页', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('<!doctype html><html><body>app</body></html>', { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: '无头回退成功' } }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }))

    await expect(aiChat({ ...cfg, transport: 'auto', proxyURL: 'https://study.example' }, [{ role: 'user', content: 'hi' }])).resolves.toBe('无头回退成功')
    expect(fetchMock.mock.calls[1][0]).toBe('https://study.example/api/ai/proxy')
  })

  it('模型目录代理地址为站点根地址或 /models 时归一化为 /api/ai/models', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ id: 'model-a' }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }))

    await expect(aiModels({ ...cfg, transport: 'auto', proxyURL: 'https://study.example/api/ai/models' })).resolves.toEqual([
      { id: 'model-a', name: 'model-a', ownedBy: undefined },
    ])
    expect(fetchMock.mock.calls[1][0]).toBe('https://study.example/api/ai/models')
  })

  it('应用中转只填写站点根地址时自动补全 proxy 路径', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: '根地址中转成功' } }] }), { status: 200, headers: { 'content-type': 'application/json' } }))

    await expect(aiChat({ ...cfg, transport: 'auto', proxyURL: 'https://study.example' }, [{ role: 'user', content: 'hi' }])).resolves.toBe('根地址中转成功')
    expect(fetchMock.mock.calls[1][0]).toBe('https://study.example/api/ai/proxy')
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
