// 计算机操作题(山东笔试型):材料情境 + 单选/填空/多选,在线作答、即时判分、附操作步骤解析
import React, { useEffect, useMemo, useState } from 'react'
import { useStore } from '../store/store'
import { Chip, EmptyState, Segmented } from '../components/ui'
import { Icon } from '../components/Icon'
import { Mascot } from '../components/Mascot'
import { checkOpAnswer, loadOpQuestions, OP_KIND_TEXT, totalOpPoints } from '../lib/office'
import type { OpKind, OpQuestion } from '../lib/office'
import { LETTERS } from '../lib/misc'

export function OfficePage() {
  const [questions, setQuestions] = useState<OpQuestion[]>([])
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [submitted, setSubmitted] = useState<Record<string, boolean>>({})
  const [filter, setFilter] = useState<'all' | OpKind>('all')

  useEffect(() => {
    loadOpQuestions().then((b) => setQuestions(b.questions))
  }, [])

  const shown = useMemo(
    () => (filter === 'all' ? questions : questions.filter((q) => q.office === filter)),
    [questions, filter]
  )
  const kinds: OpKind[] = ['word', 'excel', 'ppt']
  const submittedCount = Object.keys(submitted).length
  const score = questions.filter((q) => submitted[q.id] && checkOpAnswer(q, answers[q.id] ?? '')).reduce((s, q) => s + q.points, 0)
  const total = totalOpPoints(questions)
  const correctCount = questions.filter((q) => submitted[q.id] && checkOpAnswer(q, answers[q.id] ?? '')).length

  const setAnswer = (qid: string, v: string) => setAnswers((m) => ({ ...m, [qid]: v }))
  const submit = (q: OpQuestion) => setSubmitted((m) => ({ ...m, [q.id]: true }))
  const redo = (qid: string) =>
    setSubmitted((m) => {
      const next = { ...m }
      delete next[qid]
      return next
    })

  const renderQuestion = (q: OpQuestion) => {
    const user = answers[q.id] ?? ''
    const done = !!submitted[q.id]
    const correct = done && checkOpAnswer(q, user)
    return (
      <div key={q.id} className="card" style={{ borderColor: done ? (correct ? 'var(--green)' : 'var(--coral)') : undefined }}>
        <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
          <span className="chip chip-blue num">{q.points} 分</span>
          <span className="chip">{q.type === 'single' ? '单选' : q.type === 'multiple' ? '多选' : '填空'}</span>
          <span className="chip num">{'★'.repeat(q.difficulty)}</span>
          {done && (
            <span className={`chip ${correct ? 'chip-green' : 'chip-red'}`}>
              {correct ? `正确 +${q.points} 分` : `错误 +0 分`}
            </span>
          )}
          <div className="grow" />
          {done && (
            <button className="link-btn" onClick={() => redo(q.id)}>
              重做此题
            </button>
          )}
        </div>

        {q.material && (
          <div className="explain-box mt8" style={{ background: 'var(--primary-weak)', borderColor: 'var(--primary-soft)' }}>
            <b>材料</b>
            {'\n'}
            {q.material}
          </div>
        )}
        <p className="fs14 mt12" style={{ lineHeight: 1.75 }}>
          {q.stem}
        </p>

        {(q.type === 'single' || q.type === 'multiple') && (
          <div className="mt8">
            {q.options.map((opt, i) => {
              const letter = LETTERS[i]
              const isAns = done && q.answer.toUpperCase().includes(letter)
              const isPick = done ? user.toUpperCase().includes(letter) : user.includes(letter)
              const cls = done ? (isAns ? 'ok' : isPick ? 'bad' : 'dim') : isPick ? 'sel' : ''
              return (
                <button
                  key={letter}
                  type="button"
                  disabled={done}
                  className={`opt ${cls}`}
                  onClick={() =>
                    setAnswer(
                      q.id,
                      q.type === 'multiple'
                        ? (user.includes(letter) ? user.replace(letter, '') : user + letter)
                            .split('')
                            .sort()
                            .join('')
                        : letter
                    )
                  }
                  aria-pressed={isPick}
                >
                  <span className="abc">{letter}</span>
                  <span className="grow">{opt}</span>
                </button>
              )
            })}
          </div>
        )}

        {q.type === 'fill' && (
          <input
            className="input mt8"
            style={{ fontSize: 14 }}
            value={done ? user : user}
            onChange={(e) => setAnswer(q.id, e.target.value)}
            disabled={done}
            placeholder="输入你的答案"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && user.trim() && !done) submit(q)
            }}
          />
        )}

        {!done ? (
          <div className="row mt12" style={{ justifyContent: 'flex-end' }}>
            <button className="btn btn-primary" disabled={!user.trim()} onClick={() => submit(q)}>
              提交答案
            </button>
          </div>
        ) : (
          <div className="col mt12" style={{ gap: 8 }}>
            <div className={`fb ${correct ? 'ok' : 'bad'}`}>
              <Icon name={correct ? 'check' : 'close'} size={15} />
              {correct ? '回答正确!' : '答错了'}
              <span className="chip" style={{ marginLeft: 'auto', background: '#fff' }}>
                你的答案:{user || '(空)'} / 标准答案:{q.answer}
              </span>
            </div>
            <div className="explain-box">
              <b>解析</b>
              {'\n'}
              {q.analysis}
              {'\n\n'}
              <b>操作步骤</b>
              {'\n'}
              {q.steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}
              {'\n\n'}
              <b>高频考点:{q.keyPoint}</b>
              {'\n'}
              <b>易错提醒:</b>
              {q.commonError}
              {'\n'}
              <span className="muted">{q.source} · {q.year}</span>
            </div>
          </div>
        )}
      </div>
    )
  }

  return (
    <div>
      <div className="page-h">
        <h2>计算机操作题(笔试)</h2>
        <Chip tone="blue">{questions.length} 题 · {total} 分</Chip>
        <span className="fs12 muted">对标山东专升本操作题题型(单选/填空/多选 · Office 2016)· 自编非真题</span>
      </div>

      <div className="card mb12">
        <div className="row" style={{ flexWrap: 'wrap', gap: 12 }}>
          <div className="row" style={{ gap: 6 }}>
            <span className="fs12 muted">已答</span>
            <b className="num">{submittedCount}/{questions.length}</b>
          </div>
          <div className="row" style={{ gap: 6 }}>
            <span className="fs12 muted">得分</span>
            <b className="num" style={{ color: 'var(--green-deep)' }}>{score}/{total}</b>
          </div>
          <div className="row" style={{ gap: 6 }}>
            <span className="fs12 muted">正确率</span>
            <b className="num">{submittedCount > 0 ? Math.round((correctCount / submittedCount) * 100) + '%' : '—'}</b>
          </div>
          <div className="grow" />
          <button
            className="btn btn-sm"
            disabled={submittedCount === 0}
            onClick={() => {
              setAnswers({})
              setSubmitted({})
            }}
          >
            <Icon name="refresh" size={13} /> 重新作答
          </button>
        </div>
      </div>

      <div className="mb12">
        <Segmented
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all' as const, label: `全部(${questions.length})` },
            { value: 'word' as const, label: `Word(${questions.filter((q) => q.office === 'word').length})` },
            { value: 'excel' as const, label: `Excel(${questions.filter((q) => q.office === 'excel').length})` },
            { value: 'ppt' as const, label: `PPT(${questions.filter((q) => q.office === 'ppt').length})` },
          ]}
        />
      </div>

      {questions.length === 0 ? (
        <EmptyState mood="think" title="操作题加载中或为空" desc="若持续为空,说明 office-tasks.json 缺失。" />
      ) : filter === 'all' ? (
        kinds
          .map((k) => {
            const list = questions.filter((q) => q.office === k)
            if (list.length === 0) return null
            return (
              <div key={k} className="mb12">
                <div className="row mb8">
                  <Chip tone={k === 'word' ? 'blue' : k === 'excel' ? 'green' : 'red'}>{OP_KIND_TEXT[k]}</Chip>
                  <span className="fs12 muted num">{list.length} 题 · {list.reduce((s, q) => s + q.points, 0)} 分</span>
                </div>
                <div className="col" style={{ gap: 10 }}>
                  {list.map(renderQuestion)}
                </div>
              </div>
            )
          })
          .filter(Boolean)
      ) : (
        <div className="col" style={{ gap: 10 }}>
          {shown.map(renderQuestion)}
        </div>
      )}

      {submittedCount === questions.length && questions.length > 0 && (
        <div className="card mt12" style={{ textAlign: 'center' }}>
          <div style={{ display: 'flex', justifyContent: 'center' }}>
            <Mascot mood={score >= total * 0.8 ? 'happy' : 'think'} size={72} />
          </div>
          <h3 style={{ fontSize: 15 }}>全部做完啦!得分 {score}/{total}</h3>
          <p className="fs13 muted mt8">
            {score >= total * 0.8
              ? '操作题部分相当扎实,继续保持!'
              : '错题的解析和操作步骤都写在上面了,点「重做此题」再来一遍就会顺手很多。'}
          </p>
        </div>
      )}
    </div>
  )
}
