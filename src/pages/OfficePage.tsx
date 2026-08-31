// 实操大题:下载可编辑材料 -> 完成本地操作 -> 提交客观核对 -> 判定后展示答案。
import React, { useEffect, useMemo, useState } from 'react'
import { useStore } from '../store/store'
import { Chip, EmptyState, Segmented, useToast } from '../components/ui'
import { Icon } from '../components/Icon'
import { gradeOfficeSubmission, loadOfficeQuestionBank } from '../lib/office'
import type { OfficeCheckItem, OfficeQuestion, OfficeQuestionBank, OfficeSoftware } from '../types'
import { LETTERS } from '../lib/misc'

type OfficeFilter = 'all' | OfficeSoftware
type OfficeMode = 'student' | 'teacher'

const SOFTWARE_LABEL: Record<OfficeSoftware, string> = {
  word: 'Word',
  excel: 'Excel',
  ppt: 'PPT',
}

const SOFTWARE_TONE: Record<OfficeSoftware, 'blue' | 'green' | 'red'> = {
  word: 'blue',
  excel: 'green',
  ppt: 'red',
}

const SOFTWARE_ICON: Record<OfficeSoftware, 'book' | 'chart' | 'cap'> = {
  word: 'book',
  excel: 'chart',
  ppt: 'cap',
}

function assetUrl(path: string): string {
  return encodeURI(`${import.meta.env.BASE_URL}${path.replace(/^\//, '')}`)
}

function scoreTotal(question: OfficeQuestion): number {
  return question.scoringRubric.reduce((sum, item) => sum + item.points, 0)
}

function statusText(status: 'correct' | 'incorrect' | 'needsReview'): string {
  if (status === 'correct') return '客观核对正确'
  if (status === 'incorrect') return '客观核对有误'
  return '待人工核验'
}

function statusTone(status: 'correct' | 'incorrect' | 'needsReview'): 'green' | 'red' | 'yellow' {
  if (status === 'correct') return 'green'
  if (status === 'incorrect') return 'red'
  return 'yellow'
}

function CheckInput({
  item,
  value,
  disabled,
  onChange,
}: {
  item: OfficeCheckItem
  value: string
  disabled: boolean
  onChange: (value: string) => void
}) {
  if (item.type === 'fill') {
    return (
      <label className="field" style={{ margin: 0 }}>
        <span className="field-l">{item.prompt}</span>
        <input
          className="input"
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          placeholder="填写你的核对结果"
          aria-label={item.prompt}
        />
      </label>
    )
  }

  const options = item.options ?? []
  return (
    <div role="group" aria-label={item.prompt}>
      <div className="field-l" style={{ marginBottom: 6 }}>{item.prompt}</div>
      <div className="col" style={{ gap: 6 }}>
        {options.map((option, index) => {
          const letter = LETTERS[index]
          const picked = value.toUpperCase().includes(letter)
          return (
            <button
              key={letter}
              type="button"
              className={`opt ${picked ? 'sel' : ''}`}
              disabled={disabled}
              aria-pressed={picked}
              onClick={() => {
                if (item.type === 'multiple') {
                  onChange(
                    (picked ? value.replace(new RegExp(letter, 'gi'), '') : `${value}${letter}`)
                      .toUpperCase()
                      .split('')
                      .filter((entry, i, list) => /[A-H]/.test(entry) && list.indexOf(entry) === i)
                      .sort()
                      .join('')
                  )
                  return
                }
                onChange(letter)
              }}
            >
              <span className="abc">{letter}</span>
              <span className="grow">{option}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

export function OfficePage() {
  const { state, dispatch } = useStore()
  const toast = useToast()
  const [bank, setBank] = useState<OfficeQuestionBank | null>(null)
  const [filter, setFilter] = useState<OfficeFilter>('all')
  const [mode, setMode] = useState<OfficeMode>('student')
  const [selectedId, setSelectedId] = useState('')
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [checkingAgain, setCheckingAgain] = useState(false)

  useEffect(() => {
    let active = true
    loadOfficeQuestionBank().then((next) => {
      if (active) setBank(next)
    })
    return () => {
      active = false
    }
  }, [])

  const questions = bank?.questions ?? []
  const visibleQuestions = useMemo(
    () => (filter === 'all' ? questions : questions.filter((question) => question.software === filter)),
    [filter, questions]
  )
  const selected = useMemo(
    () => visibleQuestions.find((question) => question.id === selectedId) ?? visibleQuestions[0] ?? null,
    [selectedId, visibleQuestions]
  )

  useEffect(() => {
    if (selected && selected.id !== selectedId) setSelectedId(selected.id)
  }, [selected, selectedId])

  const submissions = state.officeSubmissions ?? {}
  const submission = selected ? submissions[selected.id] : undefined
  const editingChecks = !!selected && (!submission || checkingAgain)
  const answerVisible = mode === 'teacher' || (!!submission && !checkingAgain)
  const allChecksAnswered = selected
    ? selected.checks.length === 0 || selected.checks.every((item) => (answers[item.id] ?? '').trim())
    : false
  const gradedCount = questions.filter((question) => !!submissions[question.id]).length
  const correctCount = questions.filter((question) => submissions[question.id]?.status === 'correct').length

  useEffect(() => {
    if (!selected) {
      setAnswers({})
      setCheckingAgain(false)
      return
    }
    setAnswers(submissions[selected.id]?.answers ?? {})
    setCheckingAgain(false)
  }, [selected?.id])

  const setCheckAnswer = (checkId: string, value: string) => {
    setAnswers((current) => ({ ...current, [checkId]: value }))
  }

  const submitChecks = () => {
    if (!selected || !allChecksAnswered) return
    const normalizedAnswers = Object.fromEntries(selected.checks.map((item) => [item.id, (answers[item.id] ?? '').trim()]))
    const next = gradeOfficeSubmission(selected, normalizedAnswers)
    dispatch({ type: 'RECORD_OFFICE_SUBMISSION', submission: next })
    setAnswers(normalizedAnswers)
    setCheckingAgain(false)
    toast(next.status === 'correct' ? '客观核对正确，已解锁答案解析。' : '已完成判定，答案解析现已解锁。', {
      kind: next.status === 'correct' ? 'success' : 'info',
    })
  }

  if (!bank) return <EmptyState title="正在加载实操大题" desc="正在读取可编辑材料题库。" />
  if (questions.length === 0) {
    return <EmptyState title="实操大题暂时不可用" desc="题库或材料文件未能加载，请检查当前版本的发布文件。" />
  }

  return (
    <div>
      <div className="page-h">
        <h2>实操大题</h2>
        <Chip tone="blue">{questions.length} 道原创材料题</Chip>
        <Chip tone={gradedCount ? 'green' : 'gray'}>已判 {gradedCount}/{questions.length}</Chip>
        <span className="fs12 muted">客观核对正确 {correctCount} 道</span>
        <span className="spacer" />
        <Segmented
          small
          value={mode}
          onChange={setMode}
          options={[
            { value: 'student' as const, label: '学生模式' },
            { value: 'teacher' as const, label: '教师/答案模式' },
          ]}
        />
      </div>

      <div className="card mb12" aria-live="polite">
        <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
          <Icon name={mode === 'student' ? 'target' : 'eye'} size={17} />
          <b className="fs14">{mode === 'student' ? '学生模式' : '教师/答案模式'}</b>
          <span className="fs13 muted">
            {mode === 'student'
              ? '完成材料并提交客观核对后，才显示参考答案、评分标准和答案文件。'
              : '用于教学核对，可直接查看参考答案与评分标准。'}
          </span>
        </div>
      </div>

      <div className="mb12">
        <Segmented
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all' as const, label: `全部(${questions.length})` },
            { value: 'word' as const, label: `Word(${questions.filter((q) => q.software === 'word').length})` },
            { value: 'excel' as const, label: `Excel(${questions.filter((q) => q.software === 'excel').length})` },
            { value: 'ppt' as const, label: `PPT(${questions.filter((q) => q.software === 'ppt').length})` },
          ]}
        />
      </div>

      <div className="grid2">
        <section className="card" aria-labelledby="office-question-list-title">
          <div className="card-h">
            <span className="icon-chip"><Icon name="list" size={15} /></span>
            <b id="office-question-list-title">题目列表</b>
            <span className="right"><span className="fs12 muted">{visibleQuestions.length} 道</span></span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(138px, 1fr))', gap: 8 }}>
            {visibleQuestions.map((question) => {
              const active = question.id === selected?.id
              const result = submissions[question.id]
              return (
                <button
                  key={question.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setSelectedId(question.id)}
                  style={{
                    minHeight: 84,
                    padding: '10px',
                    textAlign: 'left',
                    border: `1px solid ${active ? 'var(--primary)' : 'var(--line)'}`,
                    borderRadius: 'var(--r-sm)',
                    background: active ? 'var(--primary-weak)' : 'var(--card)',
                    color: 'var(--ink)',
                    cursor: 'pointer',
                  }}
                >
                  <span className="row" style={{ gap: 5, marginBottom: 5 }}>
                    <Icon name={SOFTWARE_ICON[question.software]} size={14} />
                    <span className="fs12 muted">第 {String(question.order).padStart(2, '0')} 题</span>
                  </span>
                  <b style={{ display: 'block', fontSize: 13, lineHeight: 1.45 }}>{question.title}</b>
                  <span className="row" style={{ marginTop: 6, gap: 5, flexWrap: 'wrap' }}>
                    <span className={`chip chip-${SOFTWARE_TONE[question.software]}`}>{SOFTWARE_LABEL[question.software]}</span>
                    {result && <span className={`chip chip-${statusTone(result.status)}`}>{statusText(result.status)}</span>}
                  </span>
                </button>
              )
            })}
          </div>
        </section>

        {selected && (
          <article className="card" aria-labelledby={`office-question-${selected.id}`}>
            <div className="card-h" style={{ alignItems: 'flex-start' }}>
              <span className="icon-chip"><Icon name={SOFTWARE_ICON[selected.software]} size={15} /></span>
              <div className="grow">
                <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
                  <b id={`office-question-${selected.id}`}>第 {String(selected.order).padStart(2, '0')} 题：{selected.title}</b>
                  <Chip tone={SOFTWARE_TONE[selected.software]}>{SOFTWARE_LABEL[selected.software]}</Chip>
                  <Chip>{selected.difficulty}</Chip>
                  <Chip tone="yellow">{scoreTotal(selected)} 分</Chip>
                </div>
                <p className="fs13 muted" style={{ margin: '6px 0 0', lineHeight: 1.65 }}>{selected.category}</p>
              </div>
            </div>

            <section aria-labelledby={`office-prompt-${selected.id}`}>
              <h3 id={`office-prompt-${selected.id}`} style={{ fontSize: 14, margin: '16px 0 6px' }}>题目要求</h3>
              <p className="fs14" style={{ margin: 0, lineHeight: 1.75 }}>{selected.prompt}</p>
              <div className="row mt8" style={{ flexWrap: 'wrap', gap: 6 }}>
                {selected.knowledgePoints.map((point) => <Chip key={point}>{point}</Chip>)}
              </div>
            </section>

            <section aria-labelledby={`office-material-${selected.id}`}>
              <h3 id={`office-material-${selected.id}`} style={{ fontSize: 14, margin: '16px 0 6px' }}>操作材料</h3>
              <ul className="fs13 muted" style={{ margin: '0 0 10px', paddingLeft: 20, lineHeight: 1.7 }}>
                {selected.materials.map((material) => <li key={material}>{material}</li>)}
              </ul>
              <a className="btn btn-soft" href={assetUrl(selected.studentFileUrl)} download title="下载可编辑学生材料">
                <Icon name="download" size={15} /> 下载学生材料
              </a>
            </section>

            <section aria-labelledby={`office-steps-${selected.id}`}>
              <h3 id={`office-steps-${selected.id}`} style={{ fontSize: 14, margin: '16px 0 6px' }}>任务目标</h3>
              <ol className="fs13" style={{ margin: 0, paddingLeft: 20, lineHeight: 1.75 }}>
                {selected.taskSteps.map((step) => <li key={step}>{step}</li>)}
              </ol>
            </section>

            {mode === 'student' && editingChecks && (
              <section className="explain-box mt12" aria-labelledby={`office-checks-${selected.id}`}>
                <h3 id={`office-checks-${selected.id}`} style={{ fontSize: 14, margin: '0 0 10px' }}>提交客观核对</h3>
                <p className="fs12 muted" style={{ margin: '0 0 12px', lineHeight: 1.65 }}>
                  请先完成本地 Office 文件，再填写核对结果。提交后会先给出判定，再解锁答案解析。
                </p>
                <div className="col" style={{ gap: 12 }}>
                  {selected.checks.map((item) => (
                    <CheckInput
                      key={item.id}
                      item={item}
                      value={answers[item.id] ?? ''}
                      disabled={false}
                      onChange={(value) => setCheckAnswer(item.id, value)}
                    />
                  ))}
                </div>
                <div className="row mt12" style={{ justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                  <button className="btn btn-primary" type="button" disabled={!allChecksAnswered} onClick={submitChecks}>
                    <Icon name="check" size={15} /> 判定并查看解析
                  </button>
                </div>
              </section>
            )}

            {submission && !checkingAgain && mode === 'student' && (
              <section className={`fb ${submission.status === 'correct' ? 'ok' : submission.status === 'incorrect' ? 'bad' : ''} mt12`} role="status">
                <Icon name={submission.status === 'correct' ? 'check' : submission.status === 'incorrect' ? 'close' : 'eye'} size={16} />
                <div className="grow">
                  <b>{statusText(submission.status)}</b>
                  <span className="fs12" style={{ marginLeft: 6 }}>客观核对 {submission.correctCount}/{submission.totalChecks} 项</span>
                </div>
                <button
                  type="button"
                  className="link-btn"
                  onClick={() => {
                    setAnswers(submission.answers)
                    setCheckingAgain(true)
                  }}
                >
                  重新判定
                </button>
              </section>
            )}

            {mode === 'teacher' && !submission && (
              <div className="explain-box mt12" role="status">
                此题尚未有学生提交记录。教师/答案模式仅供教学核对使用。
              </div>
            )}

            {answerVisible && (
              <section className="mt12" aria-labelledby={`office-answer-${selected.id}`}>
                <div className="row" style={{ flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
                  <h3 id={`office-answer-${selected.id}`} style={{ fontSize: 14, margin: 0 }}>参考答案与评分标准</h3>
                  {submission && <Chip tone={statusTone(submission.status)}>{statusText(submission.status)}</Chip>}
                </div>
                <div className="explain-box">
                  <b>参考答案</b>
                  <ol style={{ margin: '6px 0 12px', paddingLeft: 20, lineHeight: 1.7 }}>
                    {selected.referenceAnswer.map((answer) => <li key={answer}>{answer}</li>)}
                  </ol>
                  <b>评分标准</b>
                  <ul style={{ margin: '6px 0 12px', paddingLeft: 20, lineHeight: 1.7 }}>
                    {selected.scoringRubric.map((item) => (
                      <li key={item.item}><b>{item.item}（{item.points} 分）</b>：{item.criterion}</li>
                    ))}
                  </ul>
                  <b>易错点</b>
                  <ul style={{ margin: '6px 0 0', paddingLeft: 20, lineHeight: 1.7 }}>
                    {selected.commonMistakes.map((mistake) => <li key={mistake}>{mistake}</li>)}
                  </ul>
                </div>
                <div className="row mt8" style={{ flexWrap: 'wrap', gap: 8 }}>
                  <a className="btn" href={assetUrl(selected.answerFileUrl)} download title="下载可编辑参考答案文件">
                    <Icon name="download" size={15} /> 下载参考答案文件
                  </a>
                  <span className="fs12 muted">网页只能核对题设中的客观项；版式、分页、动画和批注须由教师打开文件复核。</span>
                </div>
              </section>
            )}

            <details className="mt12">
              <summary className="fs13" style={{ cursor: 'pointer', color: 'var(--primary-deep)' }}>来源与版权信息</summary>
              <div className="fs12 muted" style={{ marginTop: 8, lineHeight: 1.7 }}>
                <div>{selected.source.sourceType} · {selected.source.sourceOrganization} · {selected.source.sourceYear}</div>
                <div>{selected.source.sourceTitle}</div>
                <div>{selected.source.license}</div>
                <div>{selected.source.copyrightNote}</div>
                <a href={selected.source.sourceUrl} target="_blank" rel="noreferrer">查看官方依据</a>
              </div>
            </details>
          </article>
        )}
      </div>
    </div>
  )
}
