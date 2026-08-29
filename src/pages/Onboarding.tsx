// 首次使用:创建备考角色(头像/昵称/主题色 → 备考信息 → 科目目标 → 完成)
import React, { useEffect, useState } from 'react'
import type { AvatarKind, ExamCategory, Elective, SeedData, ThemeKind } from '../types'
import { useStore } from '../store/store'
import { Mascot } from '../components/Mascot'
import { Avatar } from '../components/Avatar'
import { Field, Segmented, useToast } from '../components/ui'
import { AVATAR_INFO, AVATAR_ORDER, THEMES, THEME_ORDER, applyTheme } from '../lib/theme'
import { CATEGORY_ORDER, ELECTIVE_TEXT, EXAM_CATEGORIES } from '../lib/categories'
import { loadCatalog, loadSeed } from '../lib/seed'
import { loadColleges } from '../lib/colleges'
import type { College } from '../lib/colleges'
import { addDays, todayStr } from '../lib/date'
import { nav } from '../lib/misc'

export function Onboarding() {
  const { dispatch } = useStore()
  const toast = useToast()
  const [step, setStep] = useState(0)

  const [seed, setSeed] = useState<SeedData | null>(null)
  const [seedFailed, setSeedFailed] = useState(false)

  const [avatar, setAvatar] = useState<AvatarKind>('sprout')
  const [nickname, setNickname] = useState('')
  const [theme, setTheme] = useState<ThemeKind>('sky')

  const [major, setMajor] = useState('')
  const [category, setCategory] = useState<ExamCategory>('gj1')
  const [elective, setElective] = useState<Elective>('english')
  const [targetCollege, setTargetCollege] = useState('')
  const [colleges, setColleges] = useState<College[]>([])
  const [examDate, setExamDate] = useState(addDays(todayStr(), 180))
  const [syllabusYear, setSyllabusYear] = useState(new Date().getFullYear() + 1)
  const [baseLevel, setBaseLevel] = useState<'zero' | 'basic' | 'solid'>('basic')
  const [dailyMinutes, setDailyMinutes] = useState(90)
  const [weeklyDays, setWeeklyDays] = useState(5)

  const [subjectScores, setSubjectScores] = useState<Record<string, { name: string; targetScore: number }>>({})

  useEffect(() => {
    loadSeed().then((s) => {
      setSeed(s)
      setSeedFailed(s.questions.length === 0 && s.meta.name === '最小内置数据')
      const map: Record<string, { name: string; targetScore: number }> = {}
      for (const sub of s.subjects) map[sub.id] = { name: sub.name, targetScore: sub.targetScore }
      setSubjectScores(map)
    })
    loadColleges().then((c) => setColleges(c.colleges))
  }, [])

  useEffect(() => {
    applyTheme(theme)
  }, [theme])

  const bubbles = [
    '你好呀,我是芽芽!选个喜欢的伙伴形象吧。',
    '告诉我你的考试信息,我来帮你安排计划。',
    '给每科定个小目标,学习更有方向。',
    '准备好啦!带你进入知识校园!',
  ]

  const errs = {
    nickname: nickname.trim() === '' ? '给自己起个昵称吧' : '',
    major: major.trim() === '' ? '请填写报考专业,例如:计算机科学与技术' : '',
    examDate: examDate <= todayStr() ? '考试日期需要晚于今天' : '',
  }

  const canNext =
    (step === 0 && !errs.nickname) ||
    (step === 1 && !errs.major && !errs.examDate) ||
    step === 2

  const finish = async () => {
    if (!seed) return
    const subjects = seed.subjects.map((s) => ({
      ...s,
      name: subjectScores[s.id]?.name ?? s.name,
      targetScore: subjectScores[s.id]?.targetScore ?? s.targetScore,
    }))
    const finalSeed: SeedData = { ...seed, subjects }
    dispatch({
      type: 'INIT_WITH_SEED',
      profile: {
        nickname: nickname.trim(),
        avatar,
        theme,
        major: major.trim(),
        category,
        elective,
        targetCollege: targetCollege || undefined,
        examDate,
        syllabusYear,
        baseLevel,
        dailyMinutes,
        weeklyDays,
        createdAt: new Date().toISOString(),
      },
      seed: finalSeed,
    })
    // 加载考试类别内容包(语文/高数Ⅰ/Ⅱ/Ⅲ/政治及扩展章节)
    loadCatalog().then((cat) => dispatch({ type: 'MERGE_CATALOG', catalog: cat }))
    toast(`欢迎加入知识校园,${nickname.trim()}!`, { kind: 'success' })
    nav('today')
  }

  const inputDateMin = todayStr()

  return (
    <div className="onboard">
      <div className="onboard-card">
        <div className="row" style={{ gap: 12 }}>
          <Mascot mood={step === 3 ? 'happy' : 'idle'} size={64} />
          <div>
            <h2 style={{ fontSize: 18 }}>创建备考角色</h2>
            <p className="muted fs13">山东专升本 · 知识校园冒险</p>
          </div>
        </div>
        <div className="onboard-steps" aria-hidden="true">
          {[0, 1, 2, 3].map((i) => (
            <i key={i} className={i <= step ? 'on' : ''} />
          ))}
        </div>

        {step === 0 && (
          <div className="col" style={{ gap: 14 }}>
            <Field label="选择伙伴形象" hint="只是外观伙伴,不会影响任何学习数据">
              <div className="avatar-pick">
                {AVATAR_ORDER.map((k) => (
                  <button key={k} className={avatar === k ? 'on' : ''} onClick={() => setAvatar(k)} type="button">
                    <Avatar kind={k} color={AVATAR_INFO[k].color} size={52} />
                    {AVATAR_INFO[k].name}
                  </button>
                ))}
              </div>
            </Field>
            <Field label="昵称" error={errs.nickname}>
              <input className="input" value={nickname} onChange={(e) => setNickname(e.target.value)} placeholder="例如:小航" maxLength={12} />
            </Field>
            <Field label="界面主题色" hint="之后可在设置中更改">
              <div className="theme-pick">
                {THEME_ORDER.map((t) => (
                  <button
                    key={t}
                    type="button"
                    className={theme === t ? 'on' : ''}
                    style={{ background: THEMES[t].primary }}
                    aria-label={THEMES[t].name}
                    onClick={() => setTheme(t)}
                  />
                ))}
              </div>
            </Field>
          </div>
        )}

        {step === 1 && (
          <>
            <div className="form-grid">
              <Field label="报考类别" hint="依据山东省专业类别设置文件,决定高数科目">
                <select className="input" value={category} onChange={(e) => setCategory(e.target.value as ExamCategory)}>
                  {CATEGORY_ORDER.map((c) => (
                    <option key={c} value={c}>
                      {EXAM_CATEGORIES[c].name}({EXAM_CATEGORIES[c].gates})
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="公共课(二选一)" hint="公共外语为非英语的考生考政治">
                <Segmented
                  value={elective}
                  onChange={(v) => setElective(v)}
                  options={[
                    { value: 'english' as Elective, label: '英语' },
                    { value: 'politics' as Elective, label: '政治' },
                  ]}
                />
              </Field>
            </div>
            <p className="fs12 muted mb12" style={{ marginTop: -6 }}>
              {EXAM_CATEGORIES[category].desc};科目:{EXAM_CATEGORIES[category].subjects.join(' + ')}。类别之后可在设置中修改。
            </p>
            <div className="form-grid">
            <Field label="报考专业" error={errs.major}>
              <input className="input" value={major} onChange={(e) => setMajor(e.target.value)} placeholder="例如:计算机科学与技术" />
            </Field>
            <Field label="考试日期" error={errs.examDate}>
              <input className="input" type="date" value={examDate} min={inputDateMin} onChange={(e) => setExamDate(e.target.value)} />
            </Field>
            <Field label="目标院校(可选)" hint="报考意向,可在「考试资料」查询院校与专业,之后随时修改">
              <select className="input" value={targetCollege} onChange={(e) => setTargetCollege(e.target.value)}>
                <option value="">暂不确定</option>
                {colleges.map((c) => (
                  <option key={c.name} value={c.name}>
                    {c.name}({c.city} · {c.nature})
                  </option>
                ))}
              </select>
            </Field>
            <Field label="考试大纲年份" hint="政策每年可能变化,内容随时可编辑">
              <select className="input" value={syllabusYear} onChange={(e) => setSyllabusYear(Number(e.target.value))}>
                {[2024, 2025, 2026, 2027].map((y) => (
                  <option key={y} value={y}>
                    {y} 年
                  </option>
                ))}
              </select>
            </Field>
            <Field label="当前基础水平">
              <select className="input" value={baseLevel} onChange={(e) => setBaseLevel(e.target.value as 'zero' | 'basic' | 'solid')}>
                <option value="zero">刚起步,基础薄弱</option>
                <option value="basic">有一定基础</option>
                <option value="solid">基础较扎实</option>
              </select>
            </Field>
            <Field label="每天可学习时间">
              <select className="input" value={dailyMinutes} onChange={(e) => setDailyMinutes(Number(e.target.value))}>
                {[30, 60, 90, 120, 180, 240].map((m) => (
                  <option key={m} value={m}>
                    {m >= 60 ? `${m / 60} 小时` : `${m} 分钟`}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="每周可学习天数" hint="非学习日只安排错题复习,不排新课">
              <select className="input" value={weeklyDays} onChange={(e) => setWeeklyDays(Number(e.target.value))}>
                {[3, 4, 5, 6, 7].map((d) => (
                  <option key={d} value={d}>
                    每周 {d} 天
                  </option>
                ))}
              </select>
            </Field>
            </div>
          </>
        )}

        {step === 2 && (
          <div className="col" style={{ gap: 10 }}>
            {seed?.subjects.map((s) => (
              <div key={s.id} className="row" style={{ gap: 10 }}>
                <span className="dot" style={{ background: s.color }} />
                <input
                  className="input"
                  style={{ flex: 1 }}
                  value={subjectScores[s.id]?.name ?? s.name}
                  onChange={(e) => setSubjectScores((m) => ({ ...m, [s.id]: { ...(m[s.id] ?? { targetScore: s.targetScore }), name: e.target.value } }))}
                  aria-label="科目名称"
                />
                <div className="row" style={{ gap: 6 }}>
                  <span className="fs12 muted">目标</span>
                  <input
                    className="input"
                    style={{ width: 76 }}
                    type="number"
                    min={0}
                    max={100}
                    value={subjectScores[s.id]?.targetScore ?? s.targetScore}
                    onChange={(e) => setSubjectScores((m) => ({ ...m, [s.id]: { ...(m[s.id] ?? { name: s.name }), targetScore: Number(e.target.value) } }))}
                    aria-label="目标分数"
                  />
                  <span className="fs12 muted">分</span>
                </div>
              </div>
            ))}
            <p className="fs12 muted">
              这里是 {syllabusYear} 年大纲的示例科目结构,进入后可在「知识校园 → 列表管理」中增删改章节和知识点,也可以粘贴文本快速导入大纲。
            </p>
          </div>
        )}

        {step === 3 && (
          <div className="col" style={{ gap: 10 }}>
            <div className="stat-line">
              <span>角色</span>
              <b>
                {AVATAR_INFO[avatar].name} · {nickname || '未命名'}
              </b>
            </div>
            <div className="stat-line">
              <span>报考专业</span>
              <b>{major}</b>
            </div>
            <div className="stat-line">
              <span>考试类别</span>
              <b>
                {EXAM_CATEGORIES[category].name} · {EXAM_CATEGORIES[category].math} · {ELECTIVE_TEXT[elective]}
              </b>
            </div>
            <div className="stat-line">
              <span>考试日期</span>
              <b className="num">{examDate}</b>
            </div>
            <div className="stat-line">
              <span>科目</span>
              <b>{seed?.subjects.map((s) => subjectScores[s.id]?.name ?? s.name).join('、')}</b>
            </div>
            <div className="stat-line">
              <span>每日安排</span>
              <b>
                每天 {dailyMinutes} 分钟 × 每周 {weeklyDays} 天
              </b>
            </div>
            <p className="fs12 muted mt8">
              {seedFailed
                ? '注意:示例题库加载失败,已准备最小结构;可稍后在题库中自行添加题目。'
                : `将为你加载「${seed?.meta.name}」并生成第一天的学习计划。`}
            </p>
          </div>
        )}

        <div className="row mt12">
          {step > 0 && (
            <button className="btn" onClick={() => setStep((s) => s - 1)}>
              上一步
            </button>
          )}
          <div className="grow" />
          {step < 3 ? (
            <button className="btn btn-primary" disabled={!canNext} onClick={() => setStep((s) => s + 1)}>
              下一步
            </button>
          ) : (
            <button className="btn btn-primary btn-lg" disabled={!seed} onClick={finish}>
              进入知识校园
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
