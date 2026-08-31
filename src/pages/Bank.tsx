// 题库:筛选 + 题目列表 + 手动新增/编辑 + 启动练习
import React, { useMemo, useRef, useState } from 'react'
import type { CatalogQuestion, ExamCategory, Question, QuestionType } from '../types'
import { QUESTION_TYPE_TEXT } from '../types'
import { useStore } from '../store/store'
import { emptyStats } from '../store/store'
import { EmptyState, Field, Modal, Segmented, useConfirm, useToast } from '../components/ui'
import { Icon } from '../components/Icon'
import { LETTERS, uid, shuffle, nav, download } from '../lib/misc'
import { parseCsv, toCsv } from '../lib/csv'
import { qualityCheck } from '../lib/qc'
import type { QcIssue, DupGroup } from '../lib/qc'
import { EXAM_CATEGORIES, CATEGORY_ORDER } from '../lib/categories'
import { subjectInScope } from '../lib/selectors'
import { aiChat } from '../services/ai'
import { makeSession, startTimedPractice } from '../lib/practice'
import { todayStr } from '../lib/date'

const CSV_HEADERS = ['题干', '题型', '选项A', '选项B', '选项C', '选项D', '选项E', '答案', '解析', '错误选项分析', '难度', '科目', '章节', '知识点', '来源', '年份', '是否真题', '是否高频', '标签', '适用类别']
const TYPE_BY_NAME: Record<string, QuestionType> = { 单选: 'single', 多选: 'multiple', 判断: 'judge', 填空: 'fill' }

function catKeysFromText(text: string): ExamCategory[] {
  return CATEGORY_ORDER.filter((c) => text.includes(EXAM_CATEGORIES[c].name) || text.includes(EXAM_CATEGORIES[c].math))
}

type Draft = {
  subjectId: string
  chapterId: string
  kpId: string
  type: QuestionType
  difficulty: 1 | 2 | 3
  stem: string
  options: string[]
  answer: string
  explanation: string
  source: string
  year: number
  official: boolean
}

function newDraft(subjectId: string): Draft {
  return {
    subjectId,
    chapterId: '',
    kpId: '',
    type: 'single',
    difficulty: 2,
    stem: '',
    options: ['', '', '', ''],
    answer: '',
    explanation: '',
    source: '自录题目',
    year: new Date().getFullYear(),
    official: false,
  }
}

export function Bank() {
  const { state, dispatch, undo } = useStore()
  const toast = useToast()
  const [, confirm] = useConfirm()

  const [fSubject, setFSubject] = useState('')
  const [fChapter, setFChapter] = useState('')
  const [fKp, setFKp] = useState('')
  const [fType, setFType] = useState('' as QuestionType | '')
  const [fDiff, setFDiff] = useState(0)
  const [fYear, setFYear] = useState(0)
  const [fSource, setFSource] = useState('')
  const [kw, setKw] = useState('')

  const [mode, setMode] = useState<'sequential' | 'random' | 'weak' | 'timed'>('sequential')
  const [count, setCount] = useState(10)
  const [scopeMode, setScopeMode] = useState<'scope' | 'all'>('scope')
  const [editId, setEditId] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [csvResult, setCsvResult] = useState<{ ok: CatalogQuestion[]; errs: string[] } | null>(null)
  const csvFileRef = useRef<HTMLInputElement>(null)
  const jsonFileRef = useRef<HTMLInputElement>(null)
  const [adminOpen, setAdminOpen] = useState(false)
  const [qcOut, setQcOut] = useState<{ issues: QcIssue[]; dupGroups: DupGroup[]; passed: number } | null>(null)
  const [aiSubject, setAiSubject] = useState('')
  const [aiKp, setAiKp] = useState('')
  const [aiCount, setAiCount] = useState(3)
  const [aiBusy, setAiBusy] = useState(false)

  const chapters = useMemo(() => state.chapters.filter((c) => !fSubject || c.subjectId === fSubject), [state.chapters, fSubject])
  const kps = useMemo(() => state.kps.filter((k) => (!fChapter || k.chapterId === fChapter) && (!fSubject || k.subjectId === fSubject)), [state.kps, fChapter, fSubject])
  const sources = useMemo(() => [...new Set(state.questions.map((q) => q.source))], [state.questions])
  const years = useMemo(() => [...new Set(state.questions.map((q) => q.year))].sort((a, b) => b - a), [state.questions])

  const filtered = useMemo(() => {
    return state.questions.filter((q) => {
      if (scopeMode === 'scope') {
        const subject = state.subjects.find((s) => s.id === q.subjectId)
        if (subject && !subjectInScope(state, subject)) return false
      }
      if (fSubject && q.subjectId !== fSubject) return false
      if (fChapter && q.chapterId !== fChapter) return false
      if (fKp && q.kpId !== fKp) return false
      if (fType && q.type !== fType) return false
      if (fDiff && q.difficulty !== fDiff) return false
      if (fYear && q.year !== fYear) return false
      if (fSource && q.source !== fSource) return false
      if (kw && !(q.stem + q.explanation).toLowerCase().includes(kw.toLowerCase())) return false
      return true
    })
  }, [state.questions, state.subjects, state.profile, scopeMode, fSubject, fChapter, fKp, fType, fDiff, fYear, fSource, kw])

  const startPractice = () => {
    if (filtered.length === 0) return
    let qs = filtered
    if (mode === 'random') qs = shuffle(qs)
    if (mode === 'weak') qs = [...qs].sort((a, b) => {
      const ka = state.kps.find((k) => k.id === a.kpId)
      const kb = state.kps.find((k) => k.id === b.kpId)
      const ma = ka ? (ka.mastery ?? -1) : -1
      const mb = kb ? (kb.mastery ?? -1) : -1
      return ma - mb
    })
    const picked = qs.slice(0, Math.min(count, filtered.length))
    const s =
      mode === 'timed'
        ? startTimedPractice(state, picked)
        : makeSession({ mode: mode === 'weak' ? 'weak' : mode === 'random' ? 'random' : 'sequential', questionIds: picked.map((q) => q.id) })
    if (!s) return
    dispatch({ type: 'START_SESSION', session: s })
    nav('practice')
  }

  const practiceOne = (q: Question) => {
    const s = makeSession({ mode: 'kp', name: '单题练习', questionIds: [q.id] })
    dispatch({ type: 'START_SESSION', session: s })
    nav('practice')
  }

  const openAdd = () => {
    const sid = fSubject || state.subjects[0]?.id
    if (!sid) {
      toast('请先在「知识校园」中添加科目', { kind: 'error' })
      return
    }
    setEditId(null)
    setDraft(newDraft(sid))
    setErrors({})
  }

  const openEdit = (q: Question) => {
    setEditId(q.id)
    setDraft({
      subjectId: q.subjectId,
      chapterId: q.chapterId,
      kpId: q.kpId,
      type: q.type,
      difficulty: q.difficulty,
      stem: q.stem,
      options: q.type === 'judge' ? ['正确', '错误'] : [...q.options],
      answer: q.answer,
      explanation: q.explanation,
      source: q.source,
      year: q.year,
      official: q.official,
    })
    setErrors({})
  }

  const saveDraft = () => {
    if (!draft) return
    const errs: Record<string, string> = {}
    if (!draft.stem.trim()) errs.stem = '请填写题干'
    if (!draft.chapterId) errs.chapterId = '请选择章节'
    if (!draft.kpId) errs.kpId = '请选择知识点'
    if (draft.type !== 'fill' && !draft.answer.trim()) errs.answer = '请填写正确答案'
    if (draft.type === 'fill' && !draft.answer.trim()) errs.answer = '请填写标准答案'
    if (draft.type !== 'fill' && draft.type !== 'judge') {
      const opts = draft.options.map((o) => o.trim())
      if (opts.filter(Boolean).length < 2) errs.options = '至少需要 2 个选项'
      const letters = draft.answer.toUpperCase().replace(/[^A-H]/g, '')
      if (!letters) errs.answer = '答案请用字母,如 A 或 ABD'
      if (letters.split('').some((l) => l.charCodeAt(0) - 65 >= opts.filter(Boolean).length)) errs.answer = '答案超出选项范围'
    }
    if (!draft.explanation.trim()) errs.explanation = '请填写解析(哪怕简短)'
    setErrors(errs)
    if (Object.keys(errs).length > 0) return

    const opts = draft.type === 'judge' ? ['正确', '错误'] : draft.options.map((o) => o.trim()).filter(Boolean)
    if (editId) {
      dispatch({
        type: 'UPDATE_QUESTION',
        id: editId,
        patch: { ...draft, options: opts, answer: draft.answer.trim().toUpperCase() },
      })
      toast('题目已更新', { kind: 'success' })
    } else {
      dispatch({
        type: 'ADD_QUESTIONS',
        questions: [
          {
            ...draft,
            id: uid('q'),
            options: opts,
            answer: draft.answer.trim().toUpperCase(),
            createdAt: new Date().toISOString(),
          },
        ],
      })
      toast('题目已加入题库', { kind: 'success' })
    }
    setDraft(null)
    setEditId(null)
  }

  const handleCsvFile = (file: File) => {
    const reader = new FileReader()
    reader.onload = () => {
      const rows = parseCsv(String(reader.result))
      if (rows.length < 2) {
        toast('CSV 为空或只有表头', { kind: 'error' })
        return
      }
      const ok: CatalogQuestion[] = []
      const errs: string[] = []
      const stems = new Set(state.questions.map((q) => q.stem.trim()))
      rows.slice(1).forEach((r, idx) => {
        const line = `第 ${idx + 2} 行`
        const get = (i: number) => (r[i] ?? '').trim()
        const stem = get(0)
        const type = TYPE_BY_NAME[get(1)]
        if (!stem) return errs.push(`${line}:缺少题干`)
        if (stems.has(stem)) return errs.push(`${line}:与已有题目重复(题干相同)`)
        if (!type) return errs.push(`${line}:题型须为 单选/多选/判断/填空`)
        const subject = state.subjects.find((s) => s.name === get(11))
        if (!subject) return errs.push(`${line}:科目「${get(11)}」不存在`)
        const chapter = state.chapters.find((c) => c.subjectId === subject.id && c.name === get(12))
        if (!chapter) return errs.push(`${line}:章节「${get(12)}」不存在(先在知识校园创建)`)
        const kp = state.kps.find((k) => k.chapterId === chapter.id && k.name === get(13))
        if (!kp) return errs.push(`${line}:知识点「${get(13)}」不存在(先在知识校园创建)`)
        let options: string[]
        let answer: string
        if (type === 'judge') {
          options = ['正确', '错误']
          const a = get(7)
          answer = a === '正确' || a === 'A' ? 'A' : a === '错误' || a === 'B' ? 'B' : ''
        } else if (type === 'fill') {
          options = []
          answer = get(7)
        } else {
          options = [get(2), get(3), get(4), get(5), get(6)].filter(Boolean)
          if (options.length < 2) return errs.push(`${line}:至少 2 个选项`)
          const letters = get(7).toUpperCase().replace(/[^A-H]/g, '')
          if (!letters || letters.split('').some((l) => l.charCodeAt(0) - 65 >= options.length)) return errs.push(`${line}:答案「${get(7)}」超出选项范围`)
          answer = letters
        }
        if (!answer) return errs.push(`${line}:缺少答案`)
        if (!get(8)) return errs.push(`${line}:缺少解析`)
        ok.push({
          id: uid('q'),
          subjectId: subject.id,
          chapterId: chapter.id,
          kpId: kp.id,
          type,
          stem,
          options,
          answer,
          explanation: get(8),
          difficulty: (Math.min(3, Math.max(1, Number(get(10)) || 2)) as 1 | 2 | 3),
          source: get(14) || 'CSV 导入',
          year: Number(get(15)) || new Date().getFullYear(),
          official: false,
          categories: catKeysFromText(get(19)),
          isReal: get(16) === '是',
          hot: get(17) === '是',
          tags: get(18) ? get(18).split(/[;；]/).map((t) => t.trim()).filter(Boolean) : undefined,
          wrongAnalysis: get(9) || undefined,
        })
      })
      setCsvResult({ ok, errs })
    }
    reader.readAsText(file, 'utf-8')
  }

  const exportCsv = () => {
    const nameOf = (id: string) => state.kps.find((k) => k.id === id)?.name ?? ''
    const rows = filtered.map((q) => {
      const opts = [...q.options]
      while (opts.length < 5) opts.push('')
      const subject = state.subjects.find((s) => s.id === q.subjectId)
      const chapter = state.chapters.find((c) => c.id === q.chapterId)
      return [
        q.stem,
        QUESTION_TYPE_TEXT[q.type],
        ...opts,
        q.answer,
        q.explanation,
        q.wrongAnalysis ?? '',
        q.difficulty,
        subject?.name ?? '',
        chapter?.name ?? '',
        nameOf(q.kpId),
        q.source,
        q.year,
        q.isReal ? '是' : '否',
        q.hot ? '是' : '否',
        (q.tags ?? []).join(';'),
        (q.categories ?? []).map((c) => EXAM_CATEGORIES[c].name).join(';'),
      ]
    })
    download(`题库导出-${todayStr()}.csv`, toCsv(CSV_HEADERS, rows))
    toast(`已导出 ${filtered.length} 题`, { kind: 'success' })
  }

  // 题库管理:AI 生成题目草稿(进入待审核)
  const aiGen = async () => {
    if (!aiSubject || !aiKp) {
      toast('请选择科目和知识点', { kind: 'error' })
      return
    }
    const cfg = state.settings.ai
    if (!cfg || !cfg.apiKey) {
      toast('请先在「设置 → AI 服务」配置大模型', { kind: 'error' })
      return
    }
    setAiBusy(true)
    try {
      const kpName = state.kps.find((k) => k.id === aiKp)?.name ?? ''
      const subjName = state.subjects.find((s) => s.id === aiSubject)?.name ?? ''
      const out = await aiChat(
        {
          provider: cfg.provider as never,
          baseURL: cfg.baseURL,
          apiKey: cfg.apiKey,
          model: cfg.model,
          transport: cfg.transport,
          proxyURL: cfg.proxyURL,
          apiMode: cfg.apiMode,
          timeoutMs: cfg.timeoutMs,
          customHeaders: cfg.customHeaders,
          temperature: cfg.temperature,
          maxTokens: cfg.maxTokens,
        },
        [{
          role: 'user',
          content: [
            `你是山东专升本${subjName}科目的命题老师。`,
            `请围绕知识点「${kpName}」,严格按照山东专升本考试题型命制 ${aiCount} 道单选题。`,
            '只输出 JSON 数组,格式:[{"stem":"题干","options":["A选项","B选项","C选项","D选项"],"answer":"A","explanation":"解析"}]',
            '要求:题目难度贴合专升本水平,干扰项合理,解析分步骤讲清原因。',
          ].join('\n'),
        }]
      )
      const match = out.match(/\[[\s\S]*\]/)
      if (!match) throw new Error('AI 返回格式无法解析')
      const arr = JSON.parse(match[0]) as { stem: string; options: string[]; answer: string; explanation: string }[]
      const now = new Date().toISOString()
      const questions = arr.map((q) => ({
        id: uid('q'),
        subjectId: aiSubject,
        chapterId: state.kps.find((k) => k.id === aiKp)?.chapterId ?? '',
        kpId: aiKp,
        type: 'single' as const,
        stem: q.stem,
        options: q.options,
        answer: q.answer.toUpperCase().trim(),
        explanation: q.explanation,
        difficulty: 2 as const,
        source: 'AI 生成(待审核)',
        year: new Date().getFullYear(),
        official: false,
        qType: 'AI生成' as const,
        reviewed: false,
        createdAt: now,
      }))
      dispatch({ type: 'ADD_QUESTIONS', questions })
      dispatch({ type: 'LOG', text: `AI 生成 ${questions.length} 道题(待审核)` })
      toast(`AI 生成了 ${questions.length} 道题,已进入待审核列表`, { kind: 'success' })
    } catch (e) {
      toast(e instanceof Error ? e.message : 'AI 出题失败', { kind: 'error' })
    } finally {
      setAiBusy(false)
    }
  }

  const importJson = (file: File) => {
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const arr = JSON.parse(String(reader.result)) as CatalogQuestion[]
        if (!Array.isArray(arr)) throw new Error()
        const ok = arr.filter((q) => q.stem && q.answer && q.explanation)
        dispatch({
          type: 'ADD_QUESTIONS',
          questions: ok.map((q) => ({ ...q, id: uid('q'), createdAt: new Date().toISOString(), reviewed: true })),
        })
        dispatch({ type: 'LOG', text: `JSON 导入 ${ok.length} 道题` })
        toast(`JSON 导入成功:${ok.length} 题`, { kind: 'success' })
      } catch {
        toast('JSON 格式不正确(需为题目对象数组)', { kind: 'error' })
      }
    }
    reader.readAsText(file, 'utf-8')
  }

  const draftChapters = state.chapters.filter((c) => c.subjectId === draft?.subjectId)
  const draftKps = state.kps.filter((k) => k.chapterId === draft?.chapterId)

  return (
    <div>
      <div className="page-h">
        <h2>题库</h2>
        <span className="chip num">{state.questions.length} 题</span>
        <div className="spacer" />
        <a className="btn" href={`${import.meta.env.BASE_URL}data/题库导入模板.csv`} download="题库导入模板.csv">
          <Icon name="download" size={14} /> 导入模板
        </a>
        <button className="btn" onClick={() => csvFileRef.current?.click()}>
          <Icon name="upload" size={14} /> 导入 CSV
        </button>
        <input
          ref={csvFileRef}
          type="file"
          accept=".csv,text/csv"
          style={{ display: 'none' }}
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) handleCsvFile(f)
            e.target.value = ''
          }}
        />
        <button className="btn" onClick={exportCsv}>
          <Icon name="download" size={14} /> 导出 CSV
        </button>
        <button className="btn" onClick={openAdd}>
          <Icon name="plus" size={14} /> 新增题目
        </button>
      </div>

      <div className="card mb12">
        <div className="row mb8" style={{ flexWrap: 'wrap', gap: 8 }}>
          <Segmented
            small
            value={scopeMode}
            onChange={setScopeMode}
            options={[
              { value: 'scope', label: '我的考试科目' },
              { value: 'all', label: '全部题库' },
            ]}
          />
          <span className="fs12 muted">默认只显示你报考类别范围内的科目,其余科目已按考纲隐藏</span>
        </div>
        <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
          <select className="input" style={{ width: 120 }} value={fSubject} onChange={(e) => { setFSubject(e.target.value); setFChapter(''); setFKp('') }} aria-label="科目筛选">
            <option value="">全部科目</option>
            {state.subjects.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
          <select className="input" style={{ width: 130 }} value={fChapter} onChange={(e) => { setFChapter(e.target.value); setFKp('') }} aria-label="章节筛选">
            <option value="">全部章节</option>
            {chapters.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          <select className="input" style={{ width: 130 }} value={fKp} onChange={(e) => setFKp(e.target.value)} aria-label="知识点筛选">
            <option value="">全部知识点</option>
            {kps.map((k) => (
              <option key={k.id} value={k.id}>{k.name}</option>
            ))}
          </select>
          <select className="input" style={{ width: 100 }} value={fType} onChange={(e) => setFType(e.target.value as QuestionType | '')} aria-label="题型筛选">
            <option value="">全部题型</option>
            {(Object.keys(QUESTION_TYPE_TEXT) as QuestionType[]).map((t) => (
              <option key={t} value={t}>{QUESTION_TYPE_TEXT[t]}</option>
            ))}
          </select>
          <select className="input" style={{ width: 96 }} value={fDiff} onChange={(e) => setFDiff(Number(e.target.value))} aria-label="难度筛选">
            <option value={0}>全部难度</option>
            <option value={1}>★ 简单</option>
            <option value={2}>★★ 中等</option>
            <option value={3}>★★★ 困难</option>
          </select>
          <select className="input" style={{ width: 96 }} value={fYear} onChange={(e) => setFYear(Number(e.target.value))} aria-label="年份筛选">
            <option value={0}>全部年份</option>
            {years.map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
          <select className="input" style={{ width: 130 }} value={fSource} onChange={(e) => setFSource(e.target.value)} aria-label="来源筛选">
            <option value="">全部来源</option>
            {sources.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          <input className="input" style={{ width: 150 }} value={kw} onChange={(e) => setKw(e.target.value)} placeholder="搜索题干关键词" aria-label="搜索题目" />
          {(fSubject || fChapter || fKp || fType || fDiff || fYear || fSource || kw) && (
            <button className="btn btn-ghost" onClick={() => { setFSubject(''); setFChapter(''); setFKp(''); setFType(''); setFDiff(0); setFYear(0); setFSource(''); setKw('') }}>
              清除筛选
            </button>
          )}
        </div>

        <div className="row mt12" style={{ flexWrap: 'wrap', gap: 10 }}>
          <span className="fs13 muted">练习方式:</span>
          <Segmented
            small
            value={mode}
            onChange={(v) => setMode(v)}
            options={[
              { value: 'sequential', label: '顺序' },
              { value: 'random', label: '随机' },
              { value: 'weak', label: '薄弱强化' },
              { value: 'timed', label: '限时(45秒/题)' },
            ]}
          />
          <div className="row" style={{ gap: 6 }}>
            <span className="fs13 muted">题数</span>
            <select className="input" style={{ width: 76 }} value={count} onChange={(e) => setCount(Number(e.target.value))} aria-label="练习题数">
              {[5, 10, 15, 20, 30, 50].map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </div>
          <div className="grow" />
          <button className="btn btn-primary" disabled={filtered.length === 0} onClick={startPractice}>
            <Icon name="play" size={13} /> 开始练习(共 {Math.min(count, filtered.length)} 题)
          </button>
        </div>
        <p className="fs12 muted mt8">
          CSV 批量导入:先下载「导入模板」,科目/章节/知识点按名称匹配(需已在知识校园创建),导入前会逐行校验并预览;题目数据独立存放,与程序分离。
        </p>
      </div>

      <div className="card mb12">
        <div className="row">
          <button className="btn btn-sm" onClick={() => setAdminOpen((v) => !v)}>
            <Icon name="settings" size={13} /> {adminOpen ? '收起题库管理' : '展开题库管理'}
          </button>
          <span className="fs12 muted">质量检查 · 重复检测 · 待审核 · AI 出题 · JSON 导入 · 更新日志</span>
        </div>
        {adminOpen && (
          <div className="col mt12" style={{ gap: 12 }}>
            <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
              <button className="btn btn-sm" onClick={() => setQcOut(qualityCheck(state))}>
                运行质量检查
              </button>
              <button
                className="btn btn-sm"
                onClick={() => {
                  const { dupGroups } = qualityCheck(state)
                  setQcOut({ issues: [], dupGroups, passed: state.questions.length - dupGroups.reduce((s, g) => s + g.ids.length - 1, 0) })
                  if (dupGroups.length === 0) toast('未发现重复题干', { kind: 'success' })
                }}
              >
                重复题检测
              </button>
              <button className="btn btn-sm" onClick={() => jsonFileRef.current?.click()}>
                <Icon name="upload" size={13} /> JSON 导入
              </button>
              <input
                ref={jsonFileRef}
                type="file"
                accept=".json"
                style={{ display: 'none' }}
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) importJson(f)
                  e.target.value = ''
                }}
              />
            </div>

            {qcOut && (
              <div className="explain-box">
                {qcOut.issues.length === 0 && qcOut.dupGroups.length === 0 ? (
                  <b style={{ color: 'var(--green-deep)' }}>质量检查全部通过({qcOut.passed} 题),未发现问题。</b>
                ) : (
                  <>
                    <b>发现 {qcOut.issues.length} 条质量问题:</b>
                    {'\n'}
                    {qcOut.issues.slice(0, 15).map((i, n) => `${n + 1}. [${i.rule}] ${i.detail}(${i.qid})`).join('\n')}
                    {qcOut.dupGroups.length > 0 && (
                      '\n重复题组:' + qcOut.dupGroups.map((g) => g.ids.join('/')).join(';')
                    )}
                  </>
                )}
              </div>
            )}

            {(() => {
              const pending = state.questions.filter((q) => q.qType === 'AI生成' && !q.reviewed)
              return pending.length > 0 ? (
                <div className="explain-box">
                  <b>待审核题目({pending.length} 道)</b>
                  {'\n'}
                  {pending.map((q) => `- [${q.id}] ${q.stem.replace(/\$([^$]+)\$/g, '$1').slice(0, 40)}…`).join('\n')}
                </div>
              ) : null
            })()}
            {(() => {
              const pending = state.questions.filter((q) => q.qType === 'AI生成' && !q.reviewed)
              if (pending.length === 0) return null
              return (
                <div className="row" style={{ gap: 8 }}>
                  <button
                    className="btn btn-sm btn-primary"
                    onClick={() => {
                      dispatch({ type: 'REVIEW_QUESTIONS', ids: pending.map((q) => q.id), pass: true })
                      toast(`已通过审核 ${pending.length} 道`, { kind: 'success' })
                    }}
                  >
                    全部通过审核
                  </button>
                  <button
                    className="btn btn-sm btn-danger-solid"
                    onClick={() => {
                      dispatch({ type: 'REVIEW_QUESTIONS', ids: pending.map((q) => q.id), pass: false })
                      toast(`已删除 ${pending.length} 道未通过题目`)
                    }}
                  >
                    全部删除
                  </button>
                </div>
              )
            })()}

            <div>
              <b className="fs13">AI 出题(生成后进入待审核)</b>
              <div className="row mt8" style={{ flexWrap: 'wrap', gap: 8 }}>
                <select className="input" style={{ width: 130 }} value={aiSubject} onChange={(e) => { setAiSubject(e.target.value); setAiKp('') }} aria-label="AI出题科目">
                  <option value="">选择科目</option>
                  {state.subjects.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
                <select className="input" style={{ width: 170 }} value={aiKp} onChange={(e) => setAiKp(e.target.value)} aria-label="AI出题知识点">
                  <option value="">选择知识点</option>
                  {state.kps.filter((k) => !aiSubject || k.subjectId === aiSubject).map((k) => (
                    <option key={k.id} value={k.id}>{k.name}</option>
                  ))}
                </select>
                <select className="input" style={{ width: 70 }} value={aiCount} onChange={(e) => setAiCount(Number(e.target.value))} aria-label="数量">
                  {[1, 2, 3, 5, 8].map((n) => (
                    <option key={n} value={n}>{n} 题</option>
                  ))}
                </select>
                <button className="btn btn-sm btn-primary" disabled={aiBusy} onClick={aiGen}>
                  <Icon name="sparkle" size={13} /> {aiBusy ? '生成中…' : 'AI 生成题目'}
                </button>
              </div>
            </div>

            {(state.qaLog?.length ?? 0) > 0 && (
              <div className="explain-box" style={{ maxHeight: 140, overflow: 'auto' }}>
                <b>更新日志</b>
                {'\n'}
                {(state.qaLog ?? []).map((l) => `- ${new Date(l.t).toLocaleString('zh-CN')} ${l.text}`).join('\n')}
              </div>
            )}
          </div>
        )}
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          mood="think"
          title="没有符合条件的题目"
          desc="调整筛选条件,或新增题目。练习前至少需要 1 道题。"
          action={
            <button className="btn btn-primary" onClick={openAdd}>
              新增题目
            </button>
          }
        />
      ) : (
        <div className="col" style={{ gap: 8 }}>
          {filtered.map((q) => {
            const kp = state.kps.find((k) => k.id === q.kpId)
            const subject = state.subjects.find((s) => s.id === q.subjectId)
            const fav = state.favorites.includes(q.id)
            return (
              <div key={q.id} className="card" style={{ padding: '12px 14px' }}>
                <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
                  <span className="dot" style={{ background: subject?.color }} />
                  <span className="chip chip-blue">{QUESTION_TYPE_TEXT[q.type]}</span>
                  <span className="chip">{'★'.repeat(q.difficulty)}</span>
                  <span className="chip">{subject?.name}</span>
                  {kp && <span className="chip">{kp.name}</span>}
                  <span className="chip num">{q.year}</span>
                  <span className="chip">{q.source}</span>
                  {q.official && <span className="chip chip-green">官方</span>}
                  {q.isReal && <span className="chip chip-green">真题</span>}
                  {q.hot && <span className="chip chip-red">高频</span>}
                  {(q.categories?.length ?? 0) > 0 && <span className="chip chip-blue">{q.categories!.map((c) => EXAM_CATEGORIES[c].math).join('/')}</span>}
                  {fav && <span className="chip chip-yellow">已收藏</span>}
                  <div className="grow" />
                  <button className="btn btn-sm btn-soft" onClick={() => practiceOne(q)}>
                    练一练
                  </button>
                  <button className="mini-btn" aria-label="编辑题目" onClick={() => openEdit(q)}>
                    <Icon name="edit" size={13} />
                  </button>
                  <button
                    className="mini-btn danger"
                    aria-label="删除题目"
                    onClick={async () => {
                      const ok = await confirm({ title: '删除这道题?', desc: '题目及其错题记录会一并删除,可在提示中撤销。', danger: true, confirmText: '删除' })
                      if (!ok) return
                      dispatch({ type: 'DELETE_QUESTION', id: q.id })
                      toast('已删除题目', { action: { label: '撤销', onClick: undo } })
                    }}
                  >
                    <Icon name="trash" size={13} />
                  </button>
                </div>
                <p className="clamp2 mt8 fs13">{q.stem.replace(/\$([^$]+)\$/g, '$1')}</p>
                {(q.tags?.length ?? 0) > 0 && (
                  <div className="row mt8" style={{ flexWrap: 'wrap', gap: 4 }}>
                    {q.tags!.map((t) => (
                      <span key={t} className="chip">{t}</span>
                    ))}
                  </div>
                )}
                {state.questionNotes[q.id] && (
                  <p className="fs12 muted mt8">📝 {state.questionNotes[q.id]}</p>
                )}
              </div>
            )
          })}
        </div>
      )}

      <Modal
        open={!!csvResult}
        title="CSV 导入预览"
        onClose={() => setCsvResult(null)}
        width={560}
        footer={
          <>
            <button className="btn" onClick={() => setCsvResult(null)}>取消</button>
            <button
              className="btn btn-primary"
              disabled={!csvResult || csvResult.ok.length === 0}
              onClick={() => {
                if (!csvResult) return
                dispatch({ type: 'ADD_QUESTIONS', questions: csvResult.ok.map((q) => ({ ...q, createdAt: new Date().toISOString() })) })
                toast(`成功导入 ${csvResult.ok.length} 道题`, { kind: 'success' })
                setCsvResult(null)
              }}
            >
              确认导入({csvResult?.ok.length ?? 0} 题)
            </button>
          </>
        }
      >
        {csvResult && (
          <>
            <p className="fs13">
              可导入 <b className="num">{csvResult.ok.length}</b> 题
              {csvResult.errs.length > 0 && <span className="muted">,另有 {csvResult.errs.length} 行有问题:</span>}
            </p>
            {csvResult.errs.length > 0 && (
              <div className="explain-box mt8" style={{ maxHeight: 200, overflow: 'auto', color: 'var(--coral-deep)' }}>
                {csvResult.errs.slice(0, 12).join('\n')}
                {csvResult.errs.length > 12 ? `\n……共 ${csvResult.errs.length} 条` : ''}
              </div>
            )}
            <p className="fs12 muted mt8">导入为新增操作,不会改动已有题目;科目/章节/知识点按名称匹配,需先在「知识校园」创建。</p>
          </>
        )}
      </Modal>

      <Modal
        open={!!draft}
        title={editId ? '编辑题目' : '新增题目'}
        onClose={() => setDraft(null)}
        width={620}
        footer={
          <>
            <button className="btn" onClick={() => setDraft(null)}>取消</button>
            <button className="btn btn-primary" onClick={saveDraft}>保存</button>
          </>
        }
      >
        {draft && (
          <>
            <div className="form-grid">
              <Field label="科目">
                <select className="input" value={draft.subjectId} onChange={(e) => setDraft({ ...draft, subjectId: e.target.value, chapterId: '', kpId: '' })}>
                  {state.subjects.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </Field>
              <Field label="章节" error={errors.chapterId}>
                <select className="input" value={draft.chapterId} onChange={(e) => setDraft({ ...draft, chapterId: e.target.value, kpId: '' })}>
                  <option value="">请选择</option>
                  {draftChapters.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </Field>
              <Field label="知识点" error={errors.kpId}>
                <select className="input" value={draft.kpId} onChange={(e) => setDraft({ ...draft, kpId: e.target.value })}>
                  <option value="">请选择</option>
                  {draftKps.map((k) => (
                    <option key={k.id} value={k.id}>{k.name}</option>
                  ))}
                </select>
              </Field>
              <Field label="题型">
                <select className="input" value={draft.type} onChange={(e) => setDraft({ ...draft, type: e.target.value as QuestionType, options: e.target.value === 'judge' ? ['正确', '错误'] : ['', '', '', ''] })}>
                  {(Object.keys(QUESTION_TYPE_TEXT) as QuestionType[]).map((t) => (
                    <option key={t} value={t}>{QUESTION_TYPE_TEXT[t]}</option>
                  ))}
                </select>
              </Field>
              <Field label="难度">
                <Segmented small value={draft.difficulty} onChange={(v) => setDraft({ ...draft, difficulty: v })} options={[{ value: 1, label: '简单' }, { value: 2, label: '中等' }, { value: 3, label: '困难' }]} />
              </Field>
              <Field label="是否官方资料">
                <Segmented small value={draft.official ? 'y' : 'n'} onChange={(v) => setDraft({ ...draft, official: v === 'y' })} options={[{ value: 'n', label: '自编/整理' }, { value: 'y', label: '官方资料' }]} />
              </Field>
            </div>

            <Field label="题干" error={errors.stem}>
              <textarea className="input" value={draft.stem} onChange={(e) => setDraft({ ...draft, stem: e.target.value })} placeholder="输入题目内容" />
            </Field>

            {draft.type !== 'fill' && draft.type !== 'judge' && (
              <Field label="选项(至少 2 个)" error={errors.options}>
                <div className="col" style={{ gap: 6 }}>
                  {draft.options.map((o, i) => (
                    <div key={i} className="row">
                      <span className="abc" style={{ width: 22, height: 22, borderRadius: 6, background: '#EFF3F8', display: 'grid', placeItems: 'center', fontSize: 12, fontWeight: 700, color: 'var(--ink-2)', flex: 'none' }}>
                        {LETTERS[i]}
                      </span>
                      <input
                        className="input"
                        value={o}
                        onChange={(e) => setDraft({ ...draft, options: draft.options.map((x, j) => (j === i ? e.target.value : x)) })}
                        placeholder={`选项 ${LETTERS[i]}`}
                      />
                      {draft.options.length > 2 && (
                        <button className="mini-btn danger" aria-label="删除选项" onClick={() => setDraft({ ...draft, options: draft.options.filter((_, j) => j !== i) })}>
                          <Icon name="close" size={12} />
                        </button>
                      )}
                    </div>
                  ))}
                  {draft.options.length < 6 && (
                    <button className="btn btn-sm" onClick={() => setDraft({ ...draft, options: [...draft.options, ''] })}>
                      <Icon name="plus" size={12} /> 加一个选项
                    </button>
                  )}
                </div>
              </Field>
            )}

            <Field
              label={draft.type === 'fill' ? '标准答案' : '正确答案' + (draft.type === 'multiple' ? '(可多选,如 ABD)' : '')}
              error={errors.answer}
              hint={draft.type === 'single' || draft.type === 'multiple' ? '用字母表示' : undefined}
            >
              <input className="input" value={draft.answer} onChange={(e) => setDraft({ ...draft, answer: e.target.value })} placeholder={draft.type === 'fill' ? '填空的标准答案' : draft.type === 'judge' ? '正确(A)' : '如 A 或 ABD'} />
            </Field>

            <Field label="答案解析" error={errors.explanation}>
              <textarea className="input" value={draft.explanation} onChange={(e) => setDraft({ ...draft, explanation: e.target.value })} placeholder="分步骤写清楚为什么选它" />
            </Field>

            <div className="form-grid">
              <Field label="题目来源">
                <input className="input" value={draft.source} onChange={(e) => setDraft({ ...draft, source: e.target.value })} />
              </Field>
              <Field label="年份">
                <input className="input" type="number" value={draft.year} onChange={(e) => setDraft({ ...draft, year: Number(e.target.value) })} />
              </Field>
            </div>
          </>
        )}
      </Modal>
    </div>
  )
}
