// 独立排名窗口:金银铜大圆奖牌(冠军居中最大)+ 排名表格(可滚动),可从今日页"新窗口打开"
import React, { useEffect, useState } from 'react'
import { Icon } from '../components/Icon'
import { Mascot } from '../components/Mascot'
import { getTodayRanking } from '../lib/rank'
import type { RankRow } from '../lib/rank'
import { fmtDate, todayStr, clockFmt } from '../lib/date'

function TrophySolid({ size = 40 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="#fff" opacity="0.92" aria-hidden="true">
      <path d="M7 3h10v4a5 5 0 0 1-10 0V3z" />
      <path d="M7 4H4.5c0 2.6 1.3 4.2 3.2 4.6M17 4h2.5c0 2.6-1.3 4.2-3.2 4.6" stroke="#fff" strokeWidth="1.6" fill="none" strokeLinecap="round" />
      <path d="M11 12.6h2V16h-2z" />
      <path d="M8 17.5h8l1.2 3H6.8z" />
    </svg>
  )
}

export function RankWindow() {
  const [rows, setRows] = useState<RankRow[]>(() => getTodayRanking())
  const [checkedAt, setCheckedAt] = useState(Date.now())

  const refresh = () => {
    setRows(getTodayRanking())
    setCheckedAt(Date.now())
  }

  useEffect(() => {
    const iv = window.setInterval(refresh, 15000)
    return () => window.clearInterval(iv)
  }, [])

  const today = todayStr()
  const silver = rows[1] ?? null
  const gold = rows[0] ?? null
  const bronze = rows[2] ?? null
  const rest = rows.slice(3)

  const medal = (r: RankRow | null, tone: 'gold' | 'silver' | 'bronze') => (
    <div className={`rankmedal-wrap ${tone}`}>
      <div className={`rankmedal ${tone}`}>
        <TrophySolid size={tone === 'gold' ? 44 : tone === 'silver' ? 36 : 30} />
      </div>
      {r ? (
        <>
          <div className="rankmedal-name">
            {r.name}
            {r.isMe && <span className="chip chip-blue" style={{ marginLeft: 6 }}>我</span>}
          </div>
          <div className="rankmedal-big num">{r.questions}<span className="rankmedal-unit"> 题</span></div>
          <div className="rankmedal-sub num">
            学习 {clockFmt(r.minutes * 60)} · +{r.xpToday} XP
          </div>
        </>
      ) : (
        <>
          <div className="rankmedal-name empty">虚位以待</div>
          <div className="rankmedal-sub">今天练一题就能上榜</div>
        </>
      )}
    </div>
  )

  return (
    <div className="rankwin">
      <div className="row mb12">
        <Mascot mood={gold ? 'happy' : 'idle'} size={40} />
        <div className="grow">
          <h2 style={{ fontSize: 17 }}>每日学习排名</h2>
          <div className="fs12 muted num">{fmtDate(today)} · 本机账号友谊赛 · 数据不出设备</div>
        </div>
        <button className="btn btn-sm" onClick={refresh} title="刷新排名">
          <Icon name="refresh" size={13} /> 刷新
        </button>
      </div>

      <div className="rankmedals">
        {medal(silver, 'silver')}
        {medal(gold, 'gold')}
        {medal(bronze, 'bronze')}
      </div>

      <div className="card" style={{ padding: '6px 0 0', overflow: 'hidden' }}>
        <div className="ranktable-scroll">
          <table className="ranktable">
            <thead>
              <tr>
                <th style={{ width: 44 }}>#</th>
                <th style={{ textAlign: 'left' }}>用户</th>
                <th>练习题</th>
                <th>学习时长</th>
                <th>今日经验</th>
                <th>综合</th>
              </tr>
            </thead>
            <tbody>
              {rest.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ textAlign: 'center', padding: '22px 10px' }} className="muted fs13">
                    前三名之外暂时没有更多选手,邀请家人朋友在同一台设备创建账号一起学吧。
                  </td>
                </tr>
              ) : (
                rest.map((r, i) => (
                  <tr key={r.userId} className={r.isMe ? 'me' : ''}>
                    <td>
                      <span className="rankbadge num">{i + 4}</span>
                    </td>
                    <td style={{ textAlign: 'left' }}>
                      <b className="fs13">{r.name}</b>
                      {r.isMe && <span className="chip chip-blue" style={{ marginLeft: 6 }}>我</span>}
                    </td>
                    <td className="num">{r.questions}</td>
                    <td className="num">{clockFmt(r.minutes * 60)}</td>
                    <td className="num" style={{ color: 'var(--yellow-deep)' }}>+{r.xpToday}</td>
                    <td className="num" style={{ color: 'var(--green-deep)', fontWeight: 700 }}>{r.score}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <p className="fs12 muted mt12" style={{ textAlign: 'center' }}>
        综合分 = 练习题×100 + 时长×3 + 今日经验。热门但不焦虑:排名只用于互相打气,不代表学习好坏。
        <br />
        上次刷新:{new Date(checkedAt).toLocaleTimeString('zh-CN')} · 每 15 秒自动刷新
      </p>
    </div>
  )
}
