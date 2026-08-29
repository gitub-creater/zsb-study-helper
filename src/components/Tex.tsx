// LaTeX 渲染:$...$ 行内公式,基于 KaTeX(本地依赖,断网可用)
import React, { useMemo } from 'react'
import katex from 'katex'

function render(text: string): { text: string; html?: string; key: number }[] {
  const out: { text: string; html?: string; key: number }[] = []
  const re = /\$([^$]+)\$/g
  let last = 0
  let m: RegExpExecArray | null
  let key = 0
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push({ text: text.slice(last, m.index), key: key++ })
    try {
      out.push({
        text: m[1],
        html: katex.renderToString(m[1], { throwOnError: false, output: 'html' }),
        key: key++,
      })
    } catch {
      out.push({ text: m[0], key: key++ })
    }
    last = m.index + m[0].length
  }
  if (last < text.length) out.push({ text: text.slice(last), key: key++ })
  return out
}

export function Tex({ text }: { text: string }) {
  const parts = useMemo(() => (text.includes('$') ? render(text) : [{ text, key: 0 }]), [text])
  return (
    <>
      {parts.map((p) =>
        p.html ? (
          <span key={p.key} className="tex" dangerouslySetInnerHTML={{ __html: p.html }} />
        ) : (
          <span key={p.key}>{p.text}</span>
        )
      )}
    </>
  )
}
