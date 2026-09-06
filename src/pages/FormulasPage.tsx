// 公式手册:复用知识点的公式元数据($...$ LaTeX),按科目/章节分组速查
import React, { useMemo, useState } from 'react'
import { useStore } from '../store/store'
import { Icon } from '../components/Icon'
import { EmptyState } from '../components/ui'
import { Tex } from '../components/Tex'
import { subjectInScope } from '../lib/selectors'

export function FormulasPage() {
  const { state } = useStore()
  const [text, setText] = useState('')
  const [open, setOpen] = useState<Record<string, boolean>>({})

  const groups = useMemo(() => {
    const kw = text.trim().toLowerCase()
    return state.subjects
      .filter((s) => !s.legacy && subjectInScope(state, s))
      .map((s) => ({
        subject: s,
        chapters: state.chapters
          .filter((c) => c.subjectId === s.id)
          .map((c) => ({
            chapter: c,
            kps: state.kps.filter(
              (k) =>
                k.chapterId === c.id &&
                (k.formulas ?? '').trim() &&
                (!kw || k.name.toLowerCase().includes(kw) || (k.formulas ?? '').toLowerCase().includes(kw))
            ),
          }))
          .filter((c) => c.kps.length > 0),
      }))
      .filter((g) => g.chapters.length > 0)
  }, [state, text])

  const total = groups.reduce((n, g) => n + g.chapters.reduce((m, c) => m + c.kps.length, 0), 0)

  return (
    <div className="page formulas-page">
      <section className="card">
        <div className="card-h">
          <b>公式手册</b>
          <span className="muted num">{total} 条公式 · 数据来自知识校园考纲库</span>
        </div>
        <div className="searchbox mb12">
          <Icon name="search" size={15} />
          <input placeholder="搜索知识点或公式…" value={text} onChange={(e) => setText(e.target.value)} aria-label="搜索公式" />
        </div>

        {total === 0 ? (
          <EmptyState mood="think" title={text ? '没有匹配的公式' : '考纲库里还没有公式'} desc={text ? '换个关键词试试' : '在「知识校园」给知识点补充公式($...$ 包裹 LaTeX)后,这里会自动汇总。'} />
        ) : (
          groups.map((g) => (
            <div key={g.subject.id} className="fm-subject">
              <h3 className="fm-subject-name">
                <i style={{ background: g.subject.color }} /> {g.subject.name}
              </h3>
              {g.chapters.map((c) => {
                const key = `${g.subject.id}:${c.chapter.id}`
                const isOpen = open[key] ?? !!text
                return (
                  <details key={key} className="fm-chapter" open={isOpen} onToggle={(e) => setOpen({ ...open, [key]: (e.target as HTMLDetailsElement).open })}>
                    <summary>
                      {c.chapter.name}
                      <span className="chip chip-gray num">{c.kps.length}</span>
                    </summary>
                    <ul className="fm-list">
                      {c.kps.map((k) => (
                        <li key={k.id} className="fm-item">
                          <b>{k.name}</b>
                          <div className="fm-formula">
                            <Tex text={k.formulas ?? ''} />
                          </div>
                          {k.mistakes && (
                            <p className="fm-mistake">
                              <Icon name="flag" size={12} /> 易错:{k.mistakes}
                            </p>
                          )}
                        </li>
                      ))}
                    </ul>
                  </details>
                )
              })}
            </div>
          ))
        )}
      </section>
    </div>
  )
}
