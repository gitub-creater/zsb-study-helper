// 知识点详情:概念 / 公式(LaTeX) / 方法 / 题型 / 例题 / 易错点 / 前置后续 / 关联题目 / 笔记
import React, { useState } from 'react'
import type { KnowledgePoint } from '../types'
import { KP_STATUS_ORDER, KP_STATUS_TEXT } from '../types'
import { useStore } from '../store/store'
import { Chip, Modal, useToast } from './ui'
import { Icon } from './Icon'
import { Tex } from './Tex'
import { startKpPractice } from '../lib/practice'
import { nav } from '../lib/misc'
import { EXAM_CATEGORIES } from '../lib/categories'

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt12">
      <div className="fs12" style={{ fontWeight: 700, color: 'var(--ink-2)', marginBottom: 5 }}>
        {title}
      </div>
      <div className="explain-box" style={{ whiteSpace: 'pre-wrap', lineHeight: 1.8 }}>
        {children}
      </div>
    </div>
  )
}

export function KPDetail({ kp, onClose }: { kp: KnowledgePoint | null; onClose: () => void }) {
  const { state, dispatch } = useStore()
  const toast = useToast()
  const [draft, setDraft] = useState<string | null>(null)

  if (!kp) return null
  const subject = state.subjects.find((s) => s.id === kp.subjectId)
  const chapter = state.chapters.find((c) => c.id === kp.chapterId)
  const relatedQuestions = state.questions.filter((q) => q.kpId === kp.id || q.secondaryKpIds?.includes(kp.id))
  // 后续知识:把该点列为前置的知识点
  const nextKps = state.kps.filter((k) => k.prerequisites?.includes(kp.name))
  const prereqNames = kp.prerequisites ?? []
  const notes = draft ?? kp.notes ?? ''

  const startPractice = () => {
    const sess = startKpPractice(state, kp.id, 8)
    if (!sess) {
      toast('该知识点暂无配套题目,可在题库中补充', { kind: 'error' })
      return
    }
    onClose()
    dispatch({ type: 'START_SESSION', session: sess })
    nav('practice')
  }

  return (
    <Modal
      open={!!kp}
      title="知识点详情"
      onClose={onClose}
      width={640}
      footer={
        <>
          <button
            className="btn"
            onClick={() => {
              dispatch({ type: 'UPDATE_KP', id: kp.id, patch: { notes } })
              setDraft(null)
              toast('笔记已保存', { kind: 'success' })
            }}
          >
            <Icon name="check" size={13} /> 保存笔记
          </button>
          <button className="btn btn-primary" onClick={startPractice}>
            <Icon name="play" size={13} /> 练习本知识点({relatedQuestions.length} 题)
          </button>
        </>
      }
    >
      <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
        <b style={{ fontSize: 16 }}>{kp.name}</b>
        {subject && (
          <Chip>
            <span className="dot" style={{ background: subject.color }} /> {subject.name}
          </Chip>
        )}
        {chapter && <Chip>{chapter.name}</Chip>}
        <select
          className="input"
          style={{ width: 108, height: 24, fontSize: 12 }}
          value={kp.status}
          onChange={(e) => dispatch({ type: 'UPDATE_KP', id: kp.id, patch: { status: e.target.value as KnowledgePoint['status'] } })}
          aria-label="学习状态"
        >
          {KP_STATUS_ORDER.map((st) => (
            <option key={st} value={st}>
              {KP_STATUS_TEXT[st]}
            </option>
          ))}
        </select>
      </div>

      <div className="row mt8" style={{ flexWrap: 'wrap', gap: 6 }}>
        {kp.difficulty != null && <Chip tone={kp.difficulty === 3 ? 'red' : kp.difficulty === 2 ? 'yellow' : 'green'}>难度 {'★'.repeat(kp.difficulty)}</Chip>}
        {kp.importance != null && <Chip tone={kp.importance === 3 ? 'red' : kp.importance === 2 ? 'yellow' : 'gray'}>重要度 {'★'.repeat(kp.importance)}</Chip>}
        {kp.estMinutes != null && <Chip>预计 {kp.estMinutes} 分钟</Chip>}
        {(kp.applicableCategories?.length ?? 0) > 0 &&
          kp.applicableCategories!.map((c) => (
            <Chip key={c} tone="blue">
              {EXAM_CATEGORIES[c].name} · {EXAM_CATEGORIES[c].math}
            </Chip>
          ))}
      </div>

      {kp.concepts && <Section title="核心概念">{kp.concepts}</Section>}
      {kp.formulas && (
        <Section title="重点公式">
          <Tex text={kp.formulas} />
        </Section>
      )}
      {kp.methods && <Section title="解题方法">{kp.methods}</Section>}
      {kp.commonTypes && <Section title="常见题型">{kp.commonTypes}</Section>}
      {kp.example && (
        <Section title="典型例题">
          <Tex text={kp.example} />
        </Section>
      )}
      {kp.mistakes && (
        <Section title="易错点">{kp.mistakes}</Section>
      )}

      {(prereqNames.length > 0 || nextKps.length > 0) && (
        <div className="mt12">
          <div className="fs12" style={{ fontWeight: 700, color: 'var(--ink-2)', marginBottom: 5 }}>
            知识依赖
          </div>
          <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
            {prereqNames.map((name) => {
              const target = state.kps.find((k) => k.name === name)
              return (
                <Chip key={name} tone="gray">
                  前置:{name}
                  {target && target.stats.attempts === 0 && ' (未学)'}
                </Chip>
              )
            })}
            {nextKps.map((k) => (
              <Chip key={k.id} tone="blue">
                后续:{k.name}
              </Chip>
            ))}
            {prereqNames.length === 0 && nextKps.length === 0 && <span className="fs12 muted">无</span>}
          </div>
        </div>
      )}

      <Section title="我的学习笔记">
        <textarea
          className="input"
          style={{ minHeight: 64, background: '#fff' }}
          value={notes}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="记下自己的理解、口诀、错因……"
        />
      </Section>

      {kp.sourceRef && (
        <p className="fs12 muted mt8">
          <Icon name="eye" size={12} /> 资料来源:{kp.sourceRef}。大纲细目以省教育招生考试院当年发布为准,详见「考试资料」页。
        </p>
      )}
    </Modal>
  )
}
