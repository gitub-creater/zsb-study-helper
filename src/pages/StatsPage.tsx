// 数据分析(第一阶段基础版):总览 / 科目章节掌握度 / 薄弱排行 / 近7天趋势
import React, { useMemo, useRef, useState } from 'react'
import { useStore } from '../store/store'
import { Bar, Chip, EmptyState, Field, useToast } from '../components/ui'
import { Icon } from '../components/Icon'
import { chapterKps, chapterMastery, getMastery, subjectMastery, subjectAccuracy, totalAccuracy, weakKps } from '../lib/selectors'
import { totalReviewCount } from '../lib/spaced'
import { masteryTone } from '../lib/mastery'
import { startKpPractice } from '../lib/practice'
import { addDays, fmtDuration, fmtDate, todayStr } from '../lib/date'
import { nav } from '../lib/misc'
import { levelInfo } from '../lib/xp'
import { aiChatStream, type AiConfig } from '../services/ai'
import { buildWeaknessMessages, buildWeaknessPrompt } from '../lib/aiWeakness'

export function StatsPage() {
  const { state, dispatch } = useStore()
  const toast = useToast()
  const [aiMaterial, setAiMaterial] = useState('')
  const [aiResult, setAiResult] = useState('')
  const [aiBusy, setAiBusy] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  const today = todayStr()
  const totalAcc = totalAccuracy(state)
  const weak = useMemo(() => weakKps(state, 10), [state.kps, state.attempts, state.profile]) // eslint-disable-line react-hooks/exhaustive-deps
  const dueCount = Object.values(state.wrong).filter((e) => !e.archived && e.nextReviewAt != null && e.nextReviewAt <= today).length

  const days = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => {
      const d = addDays(today, -6 + i)
      const attempts = state.attempts.filter((a) => a.date === d).length
      const sec = state.studyTime[d] ?? 0
      return { date: d, attempts, sec }
    })
  }, [state.attempts, state.studyTime, today])
  const maxAtt = Math.max(1, ...days.map((d) => d.attempts))

  if (!state.profile) return <EmptyState title="请先完成角色创建" />

  const totalMin = Object.values(state.studyTime).reduce((s, v) => s + v, 0)
  const latestExam = (state.examHistory ?? [])[0]
  const level = levelInfo(state.xp)
  const aiSettings = state.settings.ai
  const aiConfigured = Boolean(aiSettings?.baseURL && aiSettings.apiKey && aiSettings.model)

  const runAiAnalysis = async (mode: 'pasted' | 'wrong' | 'exam') => {
    if (!aiConfigured || !aiSettings) {
      toast('请先在「设置 → AI 服务」配置接口地址、API Key 和模型名', { kind: 'error' })
      nav('settings')
      return
    }
    if (mode === 'pasted' && !aiMaterial.trim()) {
      toast('请先粘贴试卷、错题或作答材料', { kind: 'error' })
      return
    }
    if (mode === 'exam' && !latestExam) {
      toast('还没有模拟考试记录', { kind: 'error' })
      return
    }
    const controller = new AbortController()
    abortRef.current = controller
    setAiBusy(true)
    setAiResult('')
    try {
      const material = buildWeaknessPrompt({
        state,
        pastedText: aiMaterial,
        wrongOnly: mode === 'wrong',
        exam: mode === 'exam' ? latestExam : null,
      })
      const messages = buildWeaknessMessages(material, state)
      const cfg: AiConfig = {
        provider: (aiSettings.provider || 'custom') as AiConfig['provider'],
        baseURL: aiSettings.baseURL,
        apiKey: aiSettings.apiKey,
        model: aiSettings.model,
        transport: aiSettings.transport,
        proxyURL: aiSettings.proxyURL,
        reasoningEffort: aiSettings.reasoningEffort,
        apiMode: aiSettings.apiMode,
        timeoutMs: aiSettings.timeoutMs,
        stream: false,
        customHeaders: aiSettings.customHeaders,
        temperature: aiSettings.temperature,
        maxTokens: aiSettings.maxTokens,
      }
      const result = await aiChatStream(cfg, messages, {
        signal: controller.signal,
        onDelta: (delta) => setAiResult((previous) => previous + delta),
        timeoutMs: 90000,
      })
      setAiResult(result)
    } catch (error) {
      if (!controller.signal.aborted) toast(error instanceof Error ? error.message : 'AI 分析失败，请稍后重试', { kind: 'error' })
    } finally {
      abortRef.current = null
      setAiBusy(false)
    }
  }

  const stopAiAnalysis = () => abortRef.current?.abort()

  return (
    <div>
      <div className="page-h">
        <h2>数据分析</h2>
        <span className="fs12 muted">学习数据与游戏化数据分开统计,等级不代替真实水平</span>
      </div>

      <div className="card mb12">
        <div className="card-h">
          <span className="icon-chip" style={{ background: 'var(--primary-weak)', color: 'var(--primary-deep)' }}>
            <Icon name="sparkle" size={15} />
          </span>
          <b>AI 薄弱点分析</b>
          <Chip tone={aiConfigured ? 'green' : 'gray'}>{aiConfigured ? `已连接 · ${aiSettings?.model}` : '未配置 AI'}</Chip>
        </div>
        <p className="fs12 muted">粘贴考试试卷、错题和作答，AI 会根据材料分析薄弱章节、知识点和复习顺序。结果只保留在当前页面，不会改动你的学习统计。</p>
        <textarea
          className="input mt8"
          rows={6}
          value={aiMaterial}
          onChange={(event) => setAiMaterial(event.target.value)}
          placeholder="例如：高等数学选择题第 1、4、8 题答错；我的答案……标准答案……解析……"
          disabled={aiBusy}
        />
        <div className="row mt8" style={{ flexWrap: 'wrap', gap: 8 }}>
          <button className="btn btn-primary" disabled={aiBusy} onClick={() => void runAiAnalysis('pasted')}>
            <Icon name="sparkle" size={14} /> 分析粘贴材料
          </button>
          <button className="btn" disabled={aiBusy || Object.keys(state.wrong).length === 0} onClick={() => void runAiAnalysis('wrong')}>
            分析当前错题
          </button>
          <button className="btn" disabled={aiBusy || !latestExam} onClick={() => void runAiAnalysis('exam')}>
            分析最近模拟考
          </button>
          {aiBusy && <button className="btn" onClick={stopAiAnalysis}>停止分析</button>}
          {!aiConfigured && <button className="link-btn" onClick={() => nav('settings')}>去设置 AI 服务</button>}
        </div>
        {aiResult && (
          <div className="explain-box mt12" style={{ whiteSpace: 'pre-wrap', lineHeight: 1.65 }}>
            <div className="row mb8" style={{ justifyContent: 'space-between' }}>
              <b>分析结果</b>
              <span className="fs12 muted">AI 判断，不等于应用统计结论</span>
            </div>
            {aiResult}
          </div>
        )}
      </div>

      <div className="cards mb12">
        <div className="card">
          <div className="fs12 muted">累计练习</div>
          <b className="num" style={{ fontSize: 24 }}>{state.attempts.length}</b>
          <div className="fs12 muted">题</div>
        </div>
        <div className="card">
          <div className="fs12 muted">总正确率</div>
          <b className="num" style={{ fontSize: 24, color: 'var(--green-deep)' }}>{totalAcc == null ? '—' : `${Math.round(totalAcc * 100)}%`}</b>
          <div className="fs12 muted">{totalAcc == null ? '做几道题就有数据啦' : '全部作答的平均值'}</div>
        </div>
        <div className="card">
          <div className="fs12 muted">待复习错题</div>
          <b className="num" style={{ fontSize: 24, color: dueCount > 0 ? 'var(--coral-deep)' : 'var(--ink)' }}>{dueCount}</b>
          <div className="fs12 muted">累计复习 {totalReviewCount(state.wrong)} 次</div>
        </div>
        <div className="card">
          <div className="fs12 muted">累计学习时长</div>
          <b className="num" style={{ fontSize: 24 }}>{fmtDuration(totalMin)}</b>
          <div className="fs12 muted">连续学习 {state.streak.current} 天(最佳 {state.streak.best})</div>
        </div>
      </div>

      <div className="grid2">
        <div className="col">
          <div className="card">
            <div className="card-h">
              <span className="icon-chip">
                <Icon name="chart" size={15} />
              </span>
              <b>科目与章节掌握度</b>
            </div>
            {state.subjects.length === 0 ? (
              <p className="fs13 muted">先添加科目和知识点。</p>
            ) : (
              <div className="col" style={{ gap: 12 }}>
                {state.subjects.map((s) => {
                  const sm = subjectMastery(state, s.id)
                  const chs = state.chapters.filter((c) => c.subjectId === s.id).sort((a, b) => a.order - b.order)
                  return (
                    <div key={s.id}>
                      <div className="row mb8">
                        <span className="dot" style={{ background: s.color }} />
                        <b className="fs13">{s.name}</b>
                        <span className="fs12 muted num">
                          目标 {s.targetScore} 分 · 练习正确率 {subjectAccuracy(state, s.id) == null ? '—' : `${Math.round(subjectAccuracy(state, s.id)! * 100)}%`}
                        </span>
                      </div>
                      <div className="bar-row mb8">
                        <span className="lbl">科目总体</span>
                        <Bar value={sm} tone={masteryTone(sm)} />
                        <span className="val num">{sm == null ? '—' : `${sm}%`}</span>
                      </div>
                      {chs.map((c) => {
                        const cm = chapterMastery(state, c.id)
                        return (
                          <div key={c.id} className="bar-row" style={{ marginBottom: 6 }}>
                            <span className="lbl" style={{ paddingLeft: 12 }}>{c.name}</span>
                            <Bar value={cm} tone={masteryTone(cm)} />
                            <span className="val num">{cm == null ? '—' : `${cm}%`}</span>
                          </div>
                        )
                      })}
                      {chs.every((c) => chapterKps(state, c.id).length === 0) && (
                        <p className="fs12 muted">该科目还没有知识点,掌握度将在练习后出现。</p>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          <div className="card">
            <div className="card-h">
              <span className="icon-chip">
                <Icon name="calendar" size={15} />
              </span>
              <b>最近 7 天练习量</b>
            </div>
            <div className="trend">
              {days.map((d) => (
                <div key={d.date} className="col-bar" title={`${fmtDate(d.date)}:${d.attempts} 题 · ${fmtDuration(d.sec)}`}>
                  <span className="fs12 num" style={{ color: d.attempts > 0 ? 'var(--primary-deep)' : 'var(--ink-3)' }}>
                    {d.attempts || ''}
                  </span>
                  <div className="stick" style={{ height: `${(d.attempts / maxAtt) * 70}px`, opacity: d.attempts > 0 ? 1 : 0.25 }} />
                  <span className="lbl num">{d.date.slice(5)}</span>
                </div>
              ))}
            </div>
            <p className="fs12 muted mt8">柱子越高代表当天练习题越多;悬停可看当日时长。最近 30 天趋势图将在第二阶段加入。</p>
          </div>

          <div className="card">
            <div className="card-h">
              <span className="icon-chip">
                <Icon name="zap" size={15} />
              </span>
              <b>模拟考试成绩变化</b>
              <div className="right">
                <a className="btn btn-sm" href="#/exam">
                  去模拟考
                </a>
              </div>
            </div>
            {latestExam ? (
              <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
                <span className="fs13">
                  最近一场:{latestExam.name}
                </span>
                <b className="num" style={{ fontSize: 22, color: 'var(--primary-deep)' }}>
                  {latestExam.score}/{latestExam.totalScore}
                </b>
              </div>
            ) : (
              <p className="fs13 muted">还没考过模拟考。考一场,这里就会展示最新成绩与得分率。</p>
            )}
          </div>
        </div>

        <div className="col">
          <div className="card">
            <div className="card-h">
              <span className="icon-chip" style={{ background: 'var(--coral-weak)', color: 'var(--coral-deep)' }}>
                <Icon name="fire" size={15} />
              </span>
              <b>薄弱知识点排行</b>
            </div>
            {weak.length === 0 ? (
              <p className="fs13 muted">练习之后,这里会列出最需要优先巩固的知识点。</p>
            ) : (
              <div className="col" style={{ gap: 9 }}>
                {weak.map((k, i) => {
                  const m = getMastery(state, k)
                  const subject = state.subjects.find((s) => s.id === k.subjectId)
                  return (
                    <div key={k.id} className="row">
                      <span className="fs12 muted num" style={{ width: 16 }}>{i + 1}</span>
                      <div className="grow" style={{ minWidth: 0 }}>
                        <div className="fs13" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {k.name} <span className="muted fs12">· {subject?.name}</span>
                        </div>
                        <div className="bar-row mt8" style={{ marginTop: 4 }}>
                          <Bar value={m} tone={masteryTone(m)} />
                        </div>
                      </div>
                      <button
                        className="btn btn-sm"
                        onClick={() => {
                          const sess = startKpPractice(state, k.id, 6)
                          if (!sess) {
                            toast('该知识点暂无题目,先去题库添加', { kind: 'error' })
                            return
                          }
                          dispatch({ type: 'START_SESSION', session: sess })
                          nav('practice')
                        }}
                      >
                        练
                      </button>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          <div className="card">
            <div className="card-h">
              <span className="icon-chip" style={{ background: 'var(--yellow-weak)', color: 'var(--yellow-deep)' }}>
                <Icon name="cap" size={15} />
              </span>
              <b>游戏化数据(仅供激励)</b>
            </div>
            <div className="stat-line">
              <span>角色等级</span>
              <b>Lv.{level.level} {level.title}</b>
            </div>
            <div className="stat-line">
              <span>累计经验</span>
              <b className="num">{state.xp}</b>
            </div>
            <div className="stat-line">
              <span>已掌握知识点</span>
              <b className="num">{state.kps.filter((k) => k.status === 'mastered').length}</b>
            </div>
            <p className="fs12 muted mt8">等级和徽章只是学习行为的纪念,上面的掌握度才是真实水平。</p>
          </div>
        </div>
      </div>

      <StudyHeatmap />
    </div>
  )
}

/** 学习热力图:最近 26 周,颜色=当日题量(绿点=英语打卡日) */
function StudyHeatmap() {
  const { state } = useStore()
  const today = todayStr()
  const weeks = 26
  // 以今天所在周(周一为一周开始)对齐
  const d = new Date(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 1, Number(today.slice(8, 10)))
  const dow = (d.getDay() + 6) % 7
  const end = new Date(d)
  end.setDate(end.getDate() + (6 - dow))
  const cells: { date: string; count: number }[] = []
  for (let w = weeks - 1; w >= 0; w--) {
    for (let i = 0; i < 7; i++) {
      const day = new Date(end)
      day.setDate(end.getDate() - w * 7 - (6 - i))
      const y = day.getFullYear()
      const m = String(day.getMonth() + 1).padStart(2, '0')
      const dd = String(day.getDate()).padStart(2, '0')
      const date = `${y}-${m}-${dd}`
      cells.push({ date, count: state.attempts.filter((a) => a.date === date).length })
    }
  }
  const max = Math.max(1, ...cells.map((c) => c.count))
  const level = (n: number) => (n === 0 ? 0 : n <= max * 0.25 ? 1 : n <= max * 0.5 ? 2 : n <= max * 0.75 ? 3 : 4)
  return (
    <div className="card heatmap-card">
      <div className="card-h">
        <b>学习热力图</b>
        <span className="fs12 muted">最近 26 周 · 颜色越深当天做题越多</span>
      </div>
      <div className="heatmap" role="img" aria-label="最近 26 周学习热力图">
        {Array.from({ length: weeks }, (_, w) => (
          <div key={w} className="heatmap-col">
            {cells.slice(w * 7, w * 7 + 7).map((c) => (
              <i
                key={c.date}
                className={`hm hm-${level(c.count)}${c.date === today ? ' today' : ''}`}
                title={`${c.date}:${c.count} 题`}
              />
            ))}
          </div>
        ))}
      </div>
      <div className="row fs12 muted mt8" style={{ alignItems: 'center', gap: 6 }}>
        少
        {[0, 1, 2, 3, 4].map((n) => (
          <i key={n} className={`hm hm-${n}`} />
        ))}
        多
      </div>
    </div>
  )
}
