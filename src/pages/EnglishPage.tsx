// 山东专升本英语打卡:今日学习 / 单词列表 / 打卡日历 / 历史记录
import React, { useEffect, useMemo, useState } from 'react'
import { useStore } from '../store/store'
import { Bar, Chip, EmptyState, Segmented, useToast } from '../components/ui'
import { Icon } from '../components/Icon'
import { Mascot } from '../components/Mascot'
import { Avatar } from '../components/Avatar'
import { AVATAR_INFO } from '../lib/theme'
import { loadEnglishWords, currentUnit, wordsOfUnit, totalUnits, englishStats } from '../lib/english'
import type { EngWord } from '../lib/english'
import { fmtDate, todayStr, addDays } from '../lib/date'

export function EnglishPage() {
  const { state, dispatch } = useStore()
  const toast = useToast()
  const [words, setWords] = useState<EngWord[]>([])
  const [tab, setTab] = useState<'today' | 'list' | 'calendar' | 'history'>('today')
  const [hideCn, setHideCn] = useState(false)
  const today = todayStr()

  useEffect(() => {
    loadEnglishWords().then((b) => setWords(b.words))
  }, [])

  const eng = state.english ?? { checkedDates: [], mastered: [] }
  const stats = englishStats(state, today)
  const done = stats.todayChecked
  const unit = currentUnit(eng.checkedDates, today)
  const allUnits = totalUnits(words)
  const todayWords = useMemo(() => wordsOfUnit(words, unit), [words, unit])

  const mastered = (w: EngWord) => eng.mastered.includes(w.word)
  const toggleMaster = (w: EngWord) => dispatch({ type: 'TOGGLE_WORD_MASTERED', word: w.word })

  const checkin = () => {
    if (done) return
    const count = todayWords.length
    dispatch({ type: 'CHECKIN', date: today, count })
    toast(`打卡成功!今天学了 ${count} 个单词,连续打卡 ${stats.streak + 1} 天`, { kind: 'success' })
  }

  // 打卡日历(当月)
  const now = new Date(today)
  const year = now.getFullYear()
  const month = now.getMonth()
  const firstDay = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const checkedSet = new Set(eng.checkedDates)

  const history = [...eng.checkedDates].reverse()

  const wordCard = (w: EngWord) => (
    <div key={w.word} className="card" style={{ padding: '12px 14px' }}>
      <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
        <b style={{ fontSize: 16 }}>{w.word}</b>
        <span className="fs12 muted">{w.phon}</span>
        <span className="chip chip-blue">{w.pos}</span>
        <div className="grow" />
        <button className="btn btn-sm" onClick={() => setHideCn((v) => !v)} title="显示/隐藏中文释义">
          <Icon name="eye" size={13} />
        </button>
        <button className={`btn btn-sm ${mastered(w) ? 'btn-soft' : ''}`} onClick={() => toggleMaster(w)}>
          <Icon name="check" size={13} />
          {mastered(w) ? '已掌握' : '标记掌握'}
        </button>
      </div>
      <div className="fs14 mt8" style={{ fontWeight: 600 }}>{hideCn ? '· · · · · ·' : w.cn}</div>
      <div className="explain-box mt8" style={{ fontSize: 13 }}>
        {w.ex}
        {'\n'}
        <span className="muted">{w.ext}</span>
      </div>
    </div>
  )

  return (
    <div>
      <div className="page-h">
        <h2>山东专升本英语</h2>
        <Chip tone="blue">{words.length} 词 · 每日 20 词打卡</Chip>
      </div>

      <div className="mb12">
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: 'today', label: '今日学习' },
            { value: 'list', label: '单词列表' },
            { value: 'calendar', label: '打卡日历' },
            { value: 'history', label: '历史记录' },
          ]}
        />
      </div>

      {tab === 'today' && (
        <div className="grid2">
          <div className="col">
            {done && (
              <div className="card" style={{ borderColor: 'var(--green)', background: 'var(--green-weak)' }}>
                <div className="row">
                  <Mascot mood="happy" size={44} />
                  <b className="fs14 grow" style={{ color: 'var(--green-deep)' }}>
                    今日已完成打卡,做得好!
                  </b>
                </div>
              </div>
            )}
            {todayWords.length === 0 ? (
              <EmptyState mood="happy" title="单词已全部学完!" desc="词库已全部完成,可以到「单词列表」中复习未掌握的词。" />
            ) : (
              <>
                <div className="row mb8">
                  <Chip tone="blue">第 {unit} 单元</Chip>
                  <span className="fs12 muted">今天要学的 {todayWords.length} 个单词 · 学完点击右侧打卡</span>
                </div>
                {todayWords.map(wordCard)}
              </>
            )}
          </div>

          <div className="col">
            <div className="card" style={{ textAlign: 'center' }}>
              <div style={{ display: 'flex', justifyContent: 'center' }}>
                <Mascot mood={done ? 'happy' : 'remind'} size={72} />
              </div>
              {done ? (
                <>
                  <h3 style={{ fontSize: 15 }}>今日已完成</h3>
                  <p className="fs12 muted mt8">明天继续,坚持就是胜利!</p>
                </>
              ) : (
                <>
                  <h3 style={{ fontSize: 15 }}>今日打卡</h3>
                  <p className="fs12 muted mt8">完成上方第 {unit} 单元后点击打卡。</p>
                </>
              )}
              <button className={`btn btn-lg w100 mt12 ${done ? '' : 'btn-primary'}`} disabled={done} onClick={checkin}>
                <Icon name={done ? 'check' : 'flag'} size={15} />
                {done ? '今日已完成' : `今日打卡(${todayWords.length} 词)`}
              </button>
            </div>

            <div className="card">
              <div className="card-h">
                <span className="icon-chip">
                  <Icon name="chart" size={15} />
                </span>
                <b>学习进度</b>
              </div>
              <div className="stat-line"><span>连续打卡</span><b className="num">{stats.streak} 天</b></div>
              <div className="stat-line"><span>累计打卡</span><b className="num">{stats.totalChecked} 天</b></div>
              <div className="stat-line"><span>当前单元</span><b className="num">第 {unit} / {allUnits} 单元</b></div>
              <div className="stat-line"><span>已掌握单词</span><b className="num">{stats.mastered} / {words.length}</b></div>
              <div className="bar-row mt8">
                <Bar value={words.length ? (stats.mastered / words.length) * 100 : 0} tone="green" />
                <span className="val num">{words.length ? Math.round((stats.mastered / words.length) * 100) : 0}%</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {tab === 'list' && (
        <div className="col" style={{ gap: 8 }}>
          <div className="row mb8">
            <Chip tone="blue">共 {words.length} 词 · {allUnits} 个单元</Chip>
            <div className="grow" />
            <span className="fs12 muted">已掌握 {stats.mastered} 个</span>
          </div>
          {words.map(wordCard)}
        </div>
      )}

      {tab === 'calendar' && (
        <div className="card">
          <div className="card-h">
            <span className="icon-chip">
              <Icon name="calendar" size={15} />
            </span>
            <b>{year} 年 {month + 1} 月打卡日历</b>
            <div className="right fs12 muted">✓ = 已打卡</div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 4, textAlign: 'center' }}>
            {['日', '一', '二', '三', '四', '五', '六'].map((d) => (
              <div key={d} className="fs12 muted">{d}</div>
            ))}
            {Array.from({ length: firstDay }).map((_, i) => <div key={'e' + i} />)}
            {Array.from({ length: daysInMonth }, (_, i) => {
              const d = i + 1
              const ds = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
              const checked = checkedSet.has(ds)
              const isToday = ds === today
              return (
                <div
                  key={ds}
                  className="num"
                  style={{
                    padding: '6px 0',
                    borderRadius: 6,
                    fontSize: 12.5,
                    background: checked ? 'var(--green)' : isToday ? 'var(--primary-weak)' : '#f5f8fc',
                    color: checked ? '#fff' : isToday ? 'var(--primary-deep)' : 'var(--ink-2)',
                    fontWeight: checked || isToday ? 700 : 400,
                  }}
                >
                  {d}{checked ? ' ✓' : ''}
                </div>
              )
            })}
          </div>
          <p className="fs12 muted mt12">绿色 = 完成打卡的日期。累计打卡 {stats.totalChecked} 天,连续 {stats.streak} 天。</p>
        </div>
      )}

      {tab === 'history' && (
        <div className="col" style={{ gap: 6 }}>
          {history.length === 0 ? (
            <EmptyState mood="remind" title="还没有打卡记录" desc="完成今天的学习并打卡,记录会出现在这里。" />
          ) : (
            history.map((d, i) => (
              <div key={d} className="row" style={{ border: '1px solid var(--line)', borderRadius: 8, padding: '8px 12px' }}>
                <Icon name="check" size={14} />
                <b className="fs13 grow num">{fmtDate(d)}</b>
                <span className="fs12 muted num">{addDays(d, 1) === d ? '' : `第 ${history.length - i} 次打卡`}</span>
                <Chip tone="green">20 词</Chip>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}
