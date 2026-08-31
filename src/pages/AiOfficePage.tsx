// AI 办公文档：材料输入 -> OpenAI-compatible 结构化整理 -> 可编辑 Office 文件。
import React, { useRef, useState } from 'react'
import { useStore } from '../store/store'
import { Chip, Field, Segmented, useToast } from '../components/ui'
import { Icon } from '../components/Icon'
import { aiChat } from '../services/ai'
import type { AiConfig } from '../services/ai'
import { buildAiOfficePrompt, createOfficeBlob, extractMaterialFile, parseAiOfficeDraft, safeOfficeFilename, splitMaterial } from '../lib/aiOffice'
import type { AiOfficeDraft, AiOfficeFormat } from '../lib/aiOffice'
import { downloadBlob } from '../lib/misc'

const FORMAT_OPTIONS: { value: AiOfficeFormat; label: string }[] = [
  { value: 'docx', label: 'Word（DOCX）' },
  { value: 'xlsx', label: 'Excel（XLSX）' },
  { value: 'pptx', label: 'PowerPoint（PPTX）' },
]

export function AiOfficePage() {
  const { state } = useStore()
  const toast = useToast()
  const fileRef = useRef<HTMLInputElement>(null)
  const [material, setMaterial] = useState('')
  const [sourceName, setSourceName] = useState('')
  const [format, setFormat] = useState<AiOfficeFormat>('docx')
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState('')
  const [error, setError] = useState('')
  const [result, setResult] = useState<{ blob: Blob; filename: string; draft: AiOfficeDraft } | null>(null)

  const ai = state.settings.ai
  const configured = !!(ai?.baseURL && ai.apiKey && ai.model)

  const onFile = async (file: File) => {
    setError('')
    try {
      const text = await extractMaterialFile(file)
      if (!text.trim()) throw new Error('文件中没有可读取的文字内容。')
      setMaterial(text)
      setSourceName(file.name)
      toast(`已读取 ${file.name}`, { kind: 'success' })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '文件读取失败，请改用文本粘贴。')
    }
  }

  const generate = async () => {
    if (!material.trim()) {
      setError('请先输入或上传材料。')
      return
    }
    if (!configured || !ai) {
      setError('请先在「设置 → AI 服务」配置接口地址、API Key 和模型名。')
      return
    }
    setBusy(true)
    setError('')
    setResult(null)
    try {
      const cfg: AiConfig = {
        provider: ai.provider as AiConfig['provider'],
        baseURL: ai.baseURL,
        apiKey: ai.apiKey,
        model: ai.model,
        transport: ai.transport,
        proxyURL: ai.proxyURL,
        apiMode: ai.apiMode,
        timeoutMs: ai.timeoutMs,
        stream: false,
        customHeaders: ai.customHeaders,
        temperature: ai.temperature,
        maxTokens: ai.maxTokens,
      }
      const chunks = splitMaterial(material)
      let promptMaterial = material
      let extraSummary = ''
      if (chunks.length > 1) {
        const summaries: string[] = []
        for (let index = 0; index < chunks.length; index += 1) {
          setProgress(`正在整理材料 ${index + 1}/${chunks.length}…`)
          const summary = await aiChat(cfg, [{ role: 'user', content: `请将以下材料压缩为事实摘要，不超过 1200 字，不要添加材料外信息：\n${chunks[index]}` }])
          summaries.push(summary)
        }
        extraSummary = summaries.join('\n')
        promptMaterial = chunks.join('\n\n')
      }
      setProgress('正在生成文档结构…')
      const raw = await aiChat(cfg, [{ role: 'user', content: buildAiOfficePrompt(promptMaterial, format, extraSummary) }])
      setProgress('正在生成可编辑文件…')
      const draft = parseAiOfficeDraft(raw, format)
      const blob = await createOfficeBlob(draft, format)
      setResult({ blob, draft, filename: safeOfficeFilename(draft.title, format) })
      setProgress('生成完成')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '生成失败，请稍后重试。输入内容已保留。')
      setProgress('')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <div className="page-h">
        <h2>AI 办公文档</h2>
        <Chip tone={configured ? 'green' : 'yellow'}>{configured ? 'AI 已连接' : '需要配置 AI'}</Chip>
        <span className="spacer" />
        {sourceName && <span className="fs12 muted">来源：{sourceName}</span>}
      </div>
      {!configured && <div className="card sched-notice"><Icon name="settings" size={16} /><span>材料输入会保留；请先在设置中配置 AI 服务，完成后再生成。</span><button className="btn btn-sm" onClick={() => { window.location.hash = '#/settings' }}>打开 AI 设置</button></div>}
      <div className="ai-office-grid">
        <section className="card" aria-labelledby="ai-office-input-title">
          <div className="card-h"><span className="icon-chip"><Icon name="upload" size={15} /></span><b id="ai-office-input-title">输入材料</b></div>
          <p className="fs13 muted" style={{ marginTop: 0 }}>支持直接输入、粘贴，或上传 TXT、Markdown、PDF、DOCX。扫描版 PDF 请先 OCR。</p>
          <textarea className="input ai-office-textarea" value={material} onChange={(event) => { setMaterial(event.target.value); setError('') }} placeholder="粘贴通知、报告、数据说明或课程材料…" aria-label="材料内容" />
          <div className="row mt8" style={{ flexWrap: 'wrap', gap: 8 }}>
            <button type="button" className="btn" onClick={() => fileRef.current?.click()} disabled={busy}><Icon name="upload" size={15} /> 上传文件</button>
            <input ref={fileRef} type="file" accept=".txt,.md,.markdown,.pdf,.docx,text/plain,text/markdown,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" style={{ display: 'none' }} onChange={(event) => { const file = event.target.files?.[0]; if (file) void onFile(file); event.target.value = '' }} />
            <span className="fs12 muted">已输入 {material.length.toLocaleString()} 字</span>
          </div>
        </section>

        <section className="card" aria-labelledby="ai-office-output-title">
          <div className="card-h"><span className="icon-chip" style={{ background: 'var(--yellow-weak)', color: 'var(--yellow-deep)' }}><Icon name="edit" size={15} /></span><b id="ai-office-output-title">输出设置</b></div>
          <Field label="文件格式"><Segmented value={format} onChange={setFormat} options={FORMAT_OPTIONS} /></Field>
          <div className="explain-box fs13" style={{ lineHeight: 1.7 }}>生成的文件可用 Microsoft Office 或 WPS 继续编辑。长材料会自动分段摘要，接口失败时不会清空输入。</div>
          <button type="button" className="btn btn-primary w100 mt12" disabled={busy || !material.trim() || !configured} onClick={() => void generate()}><Icon name={busy ? 'clock' : 'sparkle'} size={15} /> {busy ? '生成中…' : '生成 Office 文档'}</button>
          {progress && <p className="fs12 muted mt8" role="status">{progress}</p>}
          {error && <div className="mathai-note error mt8" role="alert"><Icon name="close" size={13} /> {error}</div>}
        </section>
      </div>

      {result && (
        <section className="card mt12" aria-labelledby="ai-office-result-title">
          <div className="card-h"><span className="icon-chip" style={{ background: 'var(--green-weak)', color: 'var(--green-deep)' }}><Icon name="check" size={15} /></span><b id="ai-office-result-title">文档已生成</b><Chip tone="green">{result.filename}</Chip></div>
          <p className="fs14" style={{ lineHeight: 1.7, marginTop: 0 }}>{result.draft.summary}</p>
          <div className="ai-office-preview">
            {result.draft.sections.slice(0, 5).map((section) => <div key={section.heading}><b>{section.heading}</b><p className="fs13 muted">{section.body}</p></div>)}
          </div>
          <button type="button" className="btn btn-primary mt12" onClick={() => downloadBlob(result.filename, result.blob)}><Icon name="download" size={15} /> 下载 {result.filename}</button>
        </section>
      )}
    </div>
  )
}
