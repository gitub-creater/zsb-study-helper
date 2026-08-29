// 近期热门题:本地热门榜(按真实练习/错误/收藏/高频标记计算,展示热门原因)+ 联网外链搜索
// 合规声明:不自动抓取网页;外部搜索由用户主动跳转,来源与答案需自行核验;联网失败不影响本地功能
import React, { useMemo, useState } from 'react'
import { useStore } from '../store/store'
import { Chip, EmptyState, Segmented, useToast } from '../components/ui'
import { Icon } from '../components/Icon'
import { Mascot } from '../components/Mascot'
import { makeSession } from '../lib/practice'
import { addDays, fmtDate, todayStr } from '../lib/date'
import { nav } from '../lib/misc'

export function HotPage() {
  const { state, dispatch } = useStore()
  const toast = useToast()
  const [subjectId, setSubjectId] = useState('')
  const [range, setRange] = useState<'7' | '30' | 'all'>('30')
  const [kw, setKw] = useState('')
  const today = todayStr()

  const items = useMemo(() => {
    const days = range === 'all' ? 3650 : Number(range)
    const since = addDays(today, -days)
    return state.questions
      .filter((q) => !state.hiddenHot.includes(q.id) && (!subjectId || q.subjectId === subjectId))
      .map((q) => {
        const att = state.attempts.filter((a) => a.questionId === q.id && a.date >= since)
        const wrongN = att.filter((a) => !a.correct).length
        const fav = state.favorites.includes(q.id)
        const kp = state.kps.find((k) => k.id === q.kpId)
        const score =
          att.length * 2 + wrongN * 3 + (fav ? 5 : 0) + (q.hot ? 10 : 0) +
          (kp?.importance === 3 ? 4 : kp?.importance === 2 ? 2 : 0) + (q.isReal ? 3 : 0)
        const reasons: string[] = []
        if (att.length >= 2) reasons.push(`近${range === 'all' ? '期' : range + '天'}练习 ${att.length} 次`)
        const wr = att.length > 0 ? wrongN / att.length : 0
        if (att.length >= 2 && wr >= 0.5) reasons.push(`错误率 ${Math.round(wr * 100)}%`)
        if (fav) reasons.push('已被收藏')
        if (q.hot) reasons.push('高频考点题')
        if (kp?.importance === 3) reasons.push('对应大纲重点知识点')
        if (q.isReal) reasons.push('标记真题(待核验)')
        return { q, score, reasons, att }
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 20)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.questions, state.attempts, state.favorites, state.hiddenHot, state.kps, subjectId, range, today])

  const practiceOne = (qid: string) => {
    const s = makeSession({ mode: 'kp', name: '热门题练习', questionIds: [qid] })
    dispatch({ type: 'START_SESSION', session: s })
    nav('practice')
  }

  const subjectName = state.subjects.find((s) => s.id === subjectId)?.name
  const doSearch = () => {
    const query = encodeURIComponent(`山东专升本 ${subjectName ?? ''} ${kw || '考试大纲 历年真题 考点'} `.trim())
    window.open(`https://www.bing.com/search?q=${query}`, '_blank', 'noopener')
  }

  return (
    <div>
      <div className="page-h">
        <h2>近期热门题</h2>
        <Chip tone="blue">本地题库 · 实时计算</Chip>
        <span className="fs12 muted">数据更新时间:今天(随练习实时变化)</span>
      </div>

      {/* 联网搜索区(用户主动跳转,不自动抓取) */}
      <div className="card mb12">
        <div className="card-h">
          <span className="icon-chip">
            <Icon name="search" size={15} />
          </span>
          <b>联网搜索</b>
          <div className="right">
            <Chip tone="yellow">外部结果请自行核验来源与答案</Chip>
          </div>
        </div>
        <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
          <select className="input" style={{ width: 130 }} value={subjectId} onChange={(e) => setSubjectId(e.target.value)} aria-label="搜索科目">
            <option value="">全部科目</option>
            {state.subjects.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
          <input
            className="input"
            style={{ width: 220 }}
            value={kw}
            onChange={(e) => setKw(e.target.value)}
            placeholder="关键词,如:极限 文言文 主谓一致"
            onKeyDown={(e) => e.key === 'Enter' && doSearch()}
            aria-label="搜索关键词"
          />
          <button className="btn btn-primary" onClick={doSearch}>
            <Icon name="search" size={14} /> 立即搜索
          </button>
        </div>
        <p className="fs12 muted mt8">
          将打开外部搜索引擎检索公开资料;本应用不会绕过登录、验证码或付费墙,也不自动保存网页内容。找到好题后可在题库手动录入并注明来源。自动聚合多来源与答案冲突提示将在后续版本接入。
        </p>
      </div>

      {/* 本地热门榜 */}
      <div className="card mb12">
        <div className="card-h">
          <span className="icon-chip" style={{ background: 'var(--coral-weak)', color: 'var(--coral-deep)' }}>
            <Icon name="fire" size={15} />
          </span>
          <b>热门榜</b>
          <div className="right">
            <select className="input" style={{ width: 110 }} value={subjectId} onChange={(e) => setSubjectId(e.target.value)} aria-label="榜单科目">
              <option value="">全部科目</option>
              {state.subjects.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
            <Segmented
              small
              value={range}
              onChange={setRange}
              options={[
                { value: '7', label: '近7天' },
                { value: '30', label: '近30天' },
                { value: 'all', label: '全部' },
              ]}
            />
          </div>
        </div>
        <p className="fs12 muted mb12">
          热门程度 = 练习次数 + 错误率 + 收藏 + 高频/真题标记 + 大纲重要度,全部来自你的真实学习数据;不使用"押题""内部题"等说法,热门不等于必考。
          <br />
          山东专升本真题受版权保护,不能自动抓取入库;每题右侧的「搜真题」直达权威检索,找到好题可在题库手动录入并注明来源。
        </p>
        {items.length === 0 ? (
          <EmptyState
            mood="think"
            title="还没有热门数据"
            desc="先去题库练几道题,练习多、错得多的题会自动上榜;也可以用上方联网搜索找资料。"
            action={
              <button className="btn btn-primary" onClick={() => nav('bank')}>
                去题库练习
              </button>
            }
          />
        ) : (
          <div className="col" style={{ gap: 8 }}>
            {items.map(({ q, reasons, att }, i) => {
              const subject = state.subjects.find((s) => s.id === q.subjectId)
              const kp = state.kps.find((k) => k.id === q.kpId)
              const last = att.length > 0 ? att[att.length - 1].date : null
              return (
                <div key={q.id} className="node-h" style={{ border: '1px solid var(--line)', borderRadius: 8, alignItems: 'flex-start' }}>
                  <span className="fs14 muted num" style={{ width: 22, fontWeight: 700, flex: 'none' }}>{i + 1}</span>
                  <div className="grow">
                    <div className="row" style={{ flexWrap: 'wrap', gap: 5 }}>
                      <span className="dot" style={{ background: subject?.color }} />
                      <span className="fs13">{subject?.name}</span>
                      {kp && <span className="chip chip-blue">{kp.name}</span>}
                      {q.hot && <span className="chip chip-red">高频</span>}
                      {q.isReal && <span className="chip chip-green">真题?</span>}
                      {last && <span className="chip num">最近练 {fmtDate(last)}</span>}
                    </div>
                    <p className="clamp2 fs13 mt8">{q.stem.replace(/\$([^$]+)\$/g, '$1')}</p>
                    <div className="row mt8" style={{ flexWrap: 'wrap', gap: 4 }}>
                      {reasons.map((r) => (
                        <span key={r} className="chip chip-yellow">{r}</span>
                      ))}
                    </div>
                    <div className="fs11 muted mt8">
                      来源:{q.source} · {q.year} · {q.official ? '官方资料' : '练习题(非官方)'}
                    </div>
                  </div>
                  <div className="col" style={{ gap: 6, flex: 'none' }}>
                    <button className="btn btn-sm btn-soft" onClick={() => practiceOne(q.id)}>
                      去练习
                    </button>
                    <a
                      className="btn btn-sm"
                      href={`https://www.bing.com/search?q=${encodeURIComponent(`山东专升本 ${state.kps.find((k) => k.id === q.kpId)?.name ?? ''} 真题`)}`}
                      target="_blank"
                      rel="noreferrer"
                      title="在搜索引擎检索该考点的山东专升本真题"
                    >
                      搜真题
                    </a>
                    <button
                      className="btn btn-sm"
                      onClick={() => dispatch({ type: 'TOGGLE_FAVORITE', questionId: q.id })}
                    >
                      <Icon name="star" size={12} />
                      {state.favorites.includes(q.id) ? '已收藏' : '收藏'}
                    </button>
                    <button
                      className="btn btn-sm btn-ghost"
                      onClick={() => {
                        dispatch({ type: 'HIDE_HOT', questionId: q.id })
                        toast('已从热门榜隐藏(题目仍在题库中)')
                      }}
                    >
                      隐藏
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      <div className="card">
        <div className="row">
          <Mascot mood="idle" size={44} />
          <p className="fs12 muted grow">
            热门 ≠ 必考:榜单只用于安排复习优先级。多来源聚合、相似题去重、答案冲突提示需要联网抓取能力,将在后续版本接入;届时每道联网题都会标注来源、日期与原始链接,经你确认后才导入题库。
          </p>
        </div>
      </div>
    </div>
  )
}
