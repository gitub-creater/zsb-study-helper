import {
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from 'docx'
import JSZip from 'jszip'
import PptxGenJS from 'pptxgenjs'
import * as XLSX from 'xlsx'

export type AiOfficeFormat = 'docx' | 'xlsx' | 'pptx'

export interface AiOfficeSection {
  heading: string
  body: string
}

export interface AiOfficeDraft {
  title: string
  summary: string
  sections: AiOfficeSection[]
  headers: string[]
  rows: string[][]
  slides: { title: string; bullets: string[] }[]
}

const FORMAT_LABEL: Record<AiOfficeFormat, string> = { docx: 'Word', xlsx: 'Excel', pptx: 'PowerPoint' }

/** 将长材料切成可控片段，保留原文顺序，避免单次请求超过上下文限制。 */
export function splitMaterial(text: string, maxChars = 9000): string[] {
  const clean = text.replace(/\r\n?/g, '\n').trim()
  if (!clean) return []
  const chunks: string[] = []
  for (let start = 0; start < clean.length; start += maxChars) chunks.push(clean.slice(start, start + maxChars))
  return chunks
}

function decodeXml(value: string): string {
  return value
    .replace(/<w:p\b[^>]*>/gi, '\n')
    .replace(/<w:tab\s*\/?>(?:<\/w:tab>)?/gi, '\t')
    .replace(/<w:br\s*\/?>(?:<\/w:br>)?/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
}

function extractPdfText(buffer: ArrayBuffer): string {
  // 这是无外部运行时的轻量兜底，适用于常见的未压缩文字 PDF；扫描版 PDF 会明确提示需 OCR。
  const raw = new TextDecoder('latin1').decode(buffer)
  const values: string[] = []
  const re = /\(([^()\\]*(?:\\.[^()\\]*)*)\)\s*T[Jj]/g
  let match: RegExpExecArray | null
  while ((match = re.exec(raw)) !== null) {
    values.push(match[1].replace(/\\([\\()])/g, '$1').replace(/\\n/g, '\n'))
  }
  return values.join(' ').replace(/\s+/g, ' ').trim()
}

/** 读取 TXT/Markdown/PDF/DOCX；不支持的二进制文件返回中文错误，不会清空文本框。 */
export async function extractMaterialFile(file: File): Promise<string> {
  const name = file.name.toLowerCase()
  if (name.endsWith('.txt') || name.endsWith('.md') || name.endsWith('.markdown') || file.type.startsWith('text/')) {
    return (await file.text()).trim()
  }
  const buffer = await file.arrayBuffer()
  if (name.endsWith('.docx') || file.type.includes('wordprocessingml')) {
    const zip = await JSZip.loadAsync(buffer)
    const xml = await zip.file('word/document.xml')?.async('text')
    if (!xml) throw new Error('Word 文件中没有找到正文内容。')
    return decodeXml(xml).replace(/\n{3,}/g, '\n\n').trim()
  }
  if (name.endsWith('.pdf') || file.type === 'application/pdf') {
    const text = extractPdfText(buffer)
    if (!text) throw new Error('暂时无法从此 PDF 提取文字，可能是扫描件；请粘贴文字或使用可复制文字的 PDF。')
    return text
  }
  throw new Error('支持 TXT、Markdown、PDF 或 DOCX 文件。旧版 .doc 请先另存为 .docx。')
}

function cleanJson(text: string): string {
  const fenced = text.replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim()
  const start = fenced.indexOf('{')
  const end = fenced.lastIndexOf('}')
  return start >= 0 && end > start ? fenced.slice(start, end + 1) : fenced
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value.trim() : fallback
}

/** 解析模型 JSON；模型偶尔返回普通 Markdown 时降级为可编辑的段落内容。 */
export function parseAiOfficeDraft(raw: string, format: AiOfficeFormat): AiOfficeDraft {
  try {
    const value = JSON.parse(cleanJson(raw)) as Record<string, unknown>
    const sections = Array.isArray(value.sections)
      ? value.sections.map((item) => {
          const part = item as Record<string, unknown>
          return { heading: asString(part.heading, '正文'), body: asString(part.body || part.content) }
        }).filter((item) => item.body)
      : []
    const table = (value.table ?? {}) as Record<string, unknown>
    const headers = Array.isArray(table.headers) ? table.headers.map(String).filter(Boolean) : []
    const rows = Array.isArray(table.rows) ? table.rows.filter(Array.isArray).map((row) => (row as unknown[]).map(String)) : []
    const slides = Array.isArray(value.slides)
      ? value.slides.map((item) => {
          const slide = item as Record<string, unknown>
          return { title: asString(slide.title, '页面'), bullets: Array.isArray(slide.bullets) ? slide.bullets.map(String).filter(Boolean) : [] }
        }).filter((slide) => slide.bullets.length || slide.title)
      : []
    return {
      title: asString(value.title, `AI ${FORMAT_LABEL[format]}文档`),
      summary: asString(value.summary, sections[0]?.body ?? raw.slice(0, 240)),
      sections,
      headers,
      rows,
      slides,
    }
  } catch {
    const lines = raw.split(/\n+/).map((line) => line.trim()).filter(Boolean)
    return {
      title: `AI ${FORMAT_LABEL[format]}文档`,
      summary: lines.slice(0, 3).join(' ').slice(0, 240),
      sections: [{ heading: '材料内容', body: raw.trim() }],
      headers: [], rows: [], slides: [],
    }
  }
}

export function buildAiOfficePrompt(material: string, format: AiOfficeFormat, extraSummary = ''): string {
  const label = FORMAT_LABEL[format]
  return `你是山东专升本学习助手的办公材料编辑。请把下面材料整理成适合 ${label} 的可编辑文档。只使用材料中真实出现的信息，不要编造来源、日期、机构或数据。请严格只返回 JSON，不要 Markdown 代码围栏，结构如下：
{"title":"文档标题","summary":"不超过240字摘要","sections":[{"heading":"小节标题","body":"正文"}],"table":{"headers":["列1"],"rows":[["值"]]},"slides":[{"title":"页面标题","bullets":["要点"]}]}
${extraSummary ? `已有分段摘要：${extraSummary}\n` : ''}材料：\n${material}`
}

function paragraph(text: string, bold = false): Paragraph {
  return new Paragraph({ children: [new TextRun({ text, bold })], spacing: { after: 120 } })
}

async function createDocx(draft: AiOfficeDraft): Promise<Blob> {
  const children: Paragraph[] = [new Paragraph({ text: draft.title, heading: HeadingLevel.TITLE }), paragraph(`摘要：${draft.summary}`)]
  for (const section of draft.sections) {
    children.push(new Paragraph({ text: section.heading, heading: HeadingLevel.HEADING_1 }), paragraph(section.body))
  }
  const table = draft.headers.length
    ? new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [draft.headers, ...draft.rows].map((row) => new TableRow({ children: row.map((cell) => new TableCell({ children: [paragraph(cell, row === draft.headers)] })) })) })
    : null
  const doc = new Document({ sections: [{ children: table ? [...children, table as unknown as Paragraph] : children }] })
  return Packer.toBlob(doc)
}

async function createXlsx(draft: AiOfficeDraft): Promise<Blob> {
  const rows = draft.headers.length ? [draft.headers, ...draft.rows] : [['内容'], ...draft.sections.map((section) => [section.heading, section.body])]
  const sheet = XLSX.utils.aoa_to_sheet(rows)
  sheet['!cols'] = rows[0].map(() => ({ wch: 24 }))
  const book = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(book, sheet, '材料整理')
  const data = XLSX.write(book, { bookType: 'xlsx', type: 'array', compression: true })
  return new Blob([data], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
}

async function createPptx(draft: AiOfficeDraft): Promise<Blob> {
  const pptx = new PptxGenJS()
  pptx.layout = 'LAYOUT_WIDE'
  pptx.author = '山东专升本学习助手'
  const slides = draft.slides.length ? draft.slides : draft.sections.map((section) => ({ title: section.heading, bullets: section.body.split(/\n+/).filter(Boolean) }))
  for (const item of slides.length ? slides : [{ title: draft.title, bullets: [draft.summary] }]) {
    const slide = pptx.addSlide()
    slide.addText(item.title, { x: 0.6, y: 0.45, w: 12.1, h: 0.55, fontFace: 'Microsoft YaHei', fontSize: 24, bold: true, color: '134E4A' })
    slide.addText(item.bullets.map((bullet) => ({ text: bullet, options: { bullet: { indent: 18 } } })), { x: 0.85, y: 1.3, w: 11.6, h: 5.4, fontFace: 'Microsoft YaHei', fontSize: 18, color: '334155', breakLine: true, paraSpaceAfter: 12 })
  }
  const data = await pptx.write({ outputType: 'blob' } as never)
  return data instanceof Blob ? data : new Blob([data as ArrayBuffer], { type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' })
}

export async function createOfficeBlob(draft: AiOfficeDraft, format: AiOfficeFormat): Promise<Blob> {
  if (format === 'docx') return createDocx(draft)
  if (format === 'xlsx') return createXlsx(draft)
  return createPptx(draft)
}

export function safeOfficeFilename(title: string, format: AiOfficeFormat): string {
  const clean = title.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '').replace(/\s+/g, ' ').trim().slice(0, 70) || '未命名材料'
  return `${clean}.${format}`
}
