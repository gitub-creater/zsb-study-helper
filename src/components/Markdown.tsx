// 轻量 Markdown 渲染:标题 / 列表 / 引用 / 分隔线 / 粗体 / 行内代码 / 围栏代码
// 数学公式:行内 $...$ 复用 Tex 组件,独立 $$...$$ 用 KaTeX displayMode;
// 只渲染文本节点与 KaTeX 输出,不注入任意 HTML(除 KaTeX 自身产物)
import React, { useMemo } from 'react'
import katex from 'katex'
import { Tex } from './Tex'
import { toSpeechScript } from '../lib/mathai'

function DisplayTex({ tex }: { tex: string }) {
  const html = useMemo(() => {
    try {
      return katex.renderToString(tex, { throwOnError: false, output: 'html', displayMode: true })
    } catch {
      return null
    }
  }, [tex])
  if (html === null) return <code>{tex}</code>
  return <span className="tex tex-block" dangerouslySetInnerHTML={{ __html: html }} />
}

const INLINE_RE = /(\$[^$\n]+\$|\*\*[^*\n]+\*\*|`[^`\n]+`)/g

function normalizeSpeechMatch(value: string): string {
  return value.replace(/\s+/g, '').trim()
}

function containsActiveSentence(value: string, activeSpeechSentence?: string | null): boolean {
  const target = normalizeSpeechMatch(activeSpeechSentence ?? '')
  return !!target && normalizeSpeechMatch(toSpeechScript(value)).includes(target)
}

function PlainText({ text, activeSpeechSentence }: { text: string; activeSpeechSentence?: string | null }) {
  const target = activeSpeechSentence?.trim()
  if (!target || !text.includes(target)) return <>{text}</>
  const parts = text.split(target)
  return (
    <>
      {parts.map((part, index) => (
        <React.Fragment key={`${part}-${index}`}>
          {index > 0 && <mark className="md-speech-mark">{target}</mark>}
          {part}
        </React.Fragment>
      ))}
    </>
  )
}

function Inline({ text, activeSpeechSentence }: { text: string; activeSpeechSentence?: string | null }) {
  const parts = text.split(INLINE_RE)
  return (
    <>
      {parts.map((p, i) => {
        if (!p) return null
        if (p.length > 2 && p.startsWith('$') && p.endsWith('$')) return <Tex key={i} text={p} />
        if (p.length > 4 && p.startsWith('**') && p.endsWith('**')) {
          return (
            <b key={i}>
              <Inline text={p.slice(2, -2)} activeSpeechSentence={activeSpeechSentence} />
            </b>
          )
        }
        if (p.length > 2 && p.startsWith('`') && p.endsWith('`')) {
          return (
            <code key={i} className="md-code">
              <PlainText text={p.slice(1, -1)} activeSpeechSentence={activeSpeechSentence} />
            </code>
          )
        }
        return <React.Fragment key={i}><PlainText text={p} activeSpeechSentence={activeSpeechSentence} /></React.Fragment>
      })}
    </>
  )
}

type Block =
  | { kind: 'code'; code: string }
  | { kind: 'math'; tex: string }
  | { kind: 'para' | 'quote' | 'hr'; lines: string[] }
  | { kind: 'h'; level: number; text: string }
  | { kind: 'ul' | 'ol'; items: string[] }

function parseBlocks(src: string): Block[] {
  const blocks: Block[] = []
  const pushTextChunk = (chunk: string) => {
    // 先切独立公式 $$...$$
    const mathRe = /\$\$([\s\S]+?)\$\$/g
    let last = 0
    let m: RegExpExecArray | null
    while ((m = mathRe.exec(chunk)) !== null) {
      if (m.index > last) pushLines(chunk.slice(last, m.index))
      if (m[1].trim()) blocks.push({ kind: 'math', tex: m[1].trim() })
      last = m.index + m[0].length
    }
    pushLines(chunk.slice(last))
  }
  const pushLines = (chunk: string) => {
    const lines = chunk.split('\n')
    let para: string[] = []
    let list: string[] | null = null
    let listKind: 'ul' | 'ol' | null = null
    const flushPara = () => {
      if (para.length) {
        blocks.push({ kind: 'para', lines: para })
        para = []
      }
    }
    const flushList = () => {
      if (list && listKind) blocks.push({ kind: listKind, items: list })
      list = null
      listKind = null
    }
    for (const raw of lines) {
      const line = raw.trimEnd()
      const t = line.trim()
      if (!t) {
        flushPara()
        flushList()
        continue
      }
      const h = t.match(/^(#{1,4})\s+(.+)$/)
      if (h) {
        flushPara()
        flushList()
        blocks.push({ kind: 'h', level: h[1].length, text: h[2] })
        continue
      }
      if (/^(-{3,}|\*{3,})$/.test(t)) {
        flushPara()
        flushList()
        blocks.push({ kind: 'hr', lines: [] })
        continue
      }
      const ul = t.match(/^[-*•]\s+(.+)$/)
      if (ul) {
        flushPara()
        if (listKind !== 'ul') {
          flushList()
          listKind = 'ul'
          list = []
        }
        list!.push(ul[1])
        continue
      }
      const ol = t.match(/^(\d+)[.、)]\s+(.+)$/)
      if (ol) {
        flushPara()
        if (listKind !== 'ol') {
          flushList()
          listKind = 'ol'
          list = []
        }
        list!.push(ol[2])
        continue
      }
      flushList()
      para.push(line)
    }
    flushPara()
    flushList()
  }

  const fenceRe = /```[^\S\n]*\n?([\s\S]*?)(?:```|$)/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = fenceRe.exec(src)) !== null) {
    if (m.index > last) pushTextChunk(src.slice(last, m.index))
    const code = m[1].replace(/\n$/, '')
    if (code.trim()) blocks.push({ kind: 'code', code })
    last = m.index + m[0].length
  }
  pushTextChunk(src.slice(last))
  return blocks
}

function blockText(block: Block): string {
  switch (block.kind) {
    case 'code': return block.code
    case 'math': return block.tex
    case 'h': return block.text
    case 'ul':
    case 'ol': return block.items.join('\n')
    default: return block.lines.join('\n')
  }
}

/**
 * 朗读时在原始讲解正文中标出当前句。Markdown 有时会把一句话拆成多个内联节点，
 * 这时会高亮整段作为稳定兜底，避免用户找不到正在朗读的位置。
 */
export function Markdown({ text, activeSpeechSentence }: { text: string; activeSpeechSentence?: string | null }) {
  const blocks = useMemo(() => parseBlocks(text), [text])
  return (
    <div className="md">
      {blocks.map((b, i) => {
        const active = containsActiveSentence(blockText(b), activeSpeechSentence)
        const activeClass = active ? ' md-speech-active' : ''
        switch (b.kind) {
          case 'code':
            return (
              <pre key={i} className={`md-pre${activeClass}`}>
                <code><PlainText text={b.code} activeSpeechSentence={activeSpeechSentence} /></code>
              </pre>
            )
          case 'math':
            return <span key={i} className={active ? 'md-speech-active' : undefined}><DisplayTex tex={b.tex} /></span>
          case 'hr':
            return <hr key={i} className="md-hr" />
          case 'quote':
            return (
              <blockquote key={i} className={`md-quote${activeClass}`}>
                <Inline text={b.lines.join('\n')} activeSpeechSentence={activeSpeechSentence} />
              </blockquote>
            )
          case 'h': {
            const cls = `md-h md-h${b.level}${activeClass}`
            if (b.level <= 2) return <h3 key={i} className={cls}><Inline text={b.text} activeSpeechSentence={activeSpeechSentence} /></h3>
            return <h4 key={i} className={cls}><Inline text={b.text} activeSpeechSentence={activeSpeechSentence} /></h4>
          }
          case 'ul':
            return (
              <ul key={i} className="md-ul">
                {b.items.map((it, j) => (
                  <li key={j} className={containsActiveSentence(it, activeSpeechSentence) ? 'md-speech-active' : undefined}>
                    <Inline text={it} activeSpeechSentence={activeSpeechSentence} />
                  </li>
                ))}
              </ul>
            )
          case 'ol':
            return (
              <ol key={i} className="md-ol">
                {b.items.map((it, j) => (
                  <li key={j} className={containsActiveSentence(it, activeSpeechSentence) ? 'md-speech-active' : undefined}>
                    <Inline text={it} activeSpeechSentence={activeSpeechSentence} />
                  </li>
                ))}
              </ol>
            )
          default:
            return (
              <p key={i} className={`md-p${activeClass}`}>
                <Inline text={b.lines.join('\n')} activeSpeechSentence={activeSpeechSentence} />
              </p>
            )
        }
      })}
    </div>
  )
}
