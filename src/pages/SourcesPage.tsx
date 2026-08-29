// 考试资料:年度大纲(随年份更新) / 类别体系 / 高数Ⅰ/Ⅱ/Ⅲ差异 / 院校与专业查询 / 资料来源 / 检查更新
import React, { useEffect, useMemo, useState } from 'react'
import { useStore } from '../store/store'
import { Chip, Segmented, useToast } from '../components/ui'
import { Icon } from '../components/Icon'
import { CATEGORY_ORDER, EXAM_CATEGORIES, SOURCE_REFS, SYLLABUS_YEARS } from '../lib/categories'
import { CATALOG_VERSION } from '../lib/seed'
import { fmtDateTime } from '../lib/date'
import { loadColleges } from '../lib/colleges'
import type { CollegeData } from '../lib/colleges'
import { subjectInLibrary } from '../lib/selectors'
import type { CatalogData } from '../types'

const MATH_DIFF_ROWS: { topic: string; m1: string; m2: string; m3: string }[] = [
  { topic: '函数、极限与连续', m1: '含严格定义与综合技巧', m2: '基础计算为主', m3: '最基础,直接计算' },
  { topic: '一元函数微分学', m1: '含微分中值定理证明', m2: '计算与几何应用', m3: '基本求导与简单应用' },
  { topic: '一元函数积分学', m1: '换元/分部/应用全考', m2: '常规计算与面积', m3: '基本积分公式' },
  { topic: '常微分方程', m1: '一阶方程,要求较高', m2: '一阶方程', m3: '可分离变量,简单要求' },
  { topic: '向量代数与空间解析几何', m1: '✅ 考查', m2: '❌ 不考', m3: '❌ 不考' },
  { topic: '多元函数微积分', m1: '偏导+二重积分,要求高', m2: '偏导+简单二重积分', m3: '❌ 不考(待核实)' },
  { topic: '无穷级数', m1: '✅ 数项级数与幂级数', m2: '❌ 不考', m3: '❌ 不考' },
  { topic: '整体难度', m1: '★★★', m2: '★★', m3: '★' },
]

export function SourcesPage() {
  const { state, dispatch } = useStore()
  const toast = useToast()
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear())
  const [url, setUrl] = useState(state.settings.updateSourceUrl ?? '')
  const [checking, setChecking] = useState(false)
  const [collegeData, setCollegeData] = useState<CollegeData | null>(null)
  const [collegeKw, setCollegeKw] = useState('')
  const [natureFilter, setNatureFilter] = useState('')
  const [majorKw, setMajorKw] = useState('')
  const [tabCollege, setTabCollege] = useState<'colleges' | 'majors'>('colleges')
  const currentYear = new Date().getFullYear()
  const yearInfo = SYLLABUS_YEARS.find((y) => y.year === selectedYear)

  useEffect(() => {
    loadColleges().then(setCollegeData)
  }, [])

  const colleges = useMemo(
    () =>
      (collegeData?.colleges ?? []).filter(
        (c) =>
          (!natureFilter || c.nature === natureFilter) &&
          (!collegeKw || c.name.includes(collegeKw.trim()) || (c.city ?? '').includes(collegeKw.trim()))
      ),
    [collegeData, collegeKw, natureFilter]
  )
  const majors = useMemo(
    () =>
      (collegeData?.majors ?? []).filter(
        (m) => (!majorKw || m.name.includes(majorKw.trim()) || m.gate.includes(majorKw.trim()))
      ),
    [collegeData, majorKw]
  )

  const checkUpdate = async () => {
    if (!url.trim()) {
      toast('请先填写更新源 URL(指向静态托管的 catalog JSON)', { kind: 'error' })
      return
    }
    setChecking(true)
    try {
      const res = await fetch(`${url.trim()}${url.includes('?') ? '&' : '?'}t=${Date.now()}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const cat = (await res.json()) as CatalogData
      if (!Array.isArray(cat.subjects) || !Array.isArray(cat.kps)) throw new Error('格式不是内容包')
      const remoteVer = cat.meta.version ?? 0
      if (remoteVer > (state.catalogVersion ?? 0)) {
        dispatch({ type: 'MERGE_CATALOG', catalog: cat })
        toast(`已更新到内容包 v${remoteVer}(${cat.meta.updatedAt ?? ''}),新增内容已合并,学习记录不受影响`, { kind: 'success' })
      } else {
        toast(`已是最新(内容包 v${remoteVer})`)
      }
      dispatch({ type: 'SET_SETTINGS', patch: { updateSourceUrl: url.trim() } })
      dispatch({ type: 'SET_UPDATE_CHECKED', t: Date.now() })
    } catch (e) {
      toast(`检查失败:${e instanceof Error ? e.message : '网络或跨域限制'}。可稍后再试,或用「设置 → 导入备份」手动更新`, { kind: 'error' })
    } finally {
      setChecking(false)
    }
  }

  return (
    <div>
      <div className="page-h">
        <h2>考试资料</h2>
        <span className="fs12 muted">
          检索更新时间:2026-08-28 · 政策每年可能调整,以省教育招生考试院当年发布为准
          {state.lastUpdateCheck ? ` · 上次检查更新:${fmtDateTime(new Date(state.lastUpdateCheck).toISOString())}` : ''}
        </span>
      </div>

      <div className="card mb12">
        <div className="card-h">
          <span className="icon-chip">
            <Icon name="refresh" size={15} />
          </span>
          <b>大纲年份与自动更新</b>
          <div className="right">
            <Chip tone="blue">当前内容包 v{Math.max(CATALOG_VERSION, state.catalogVersion ?? 0)}</Chip>
          </div>
        </div>
        <div className="row mb12" style={{ flexWrap: 'wrap', gap: 6 }}>
          {SYLLABUS_YEARS.map((y) => (
            <button
              key={y.year}
              className={`btn btn-sm ${selectedYear === y.year ? 'btn-soft' : ''}`}
              onClick={() => setSelectedYear(y.year)}
            >
              {y.year} 年 · {y.status}
              {y.year === currentYear && ' ●'}
            </button>
          ))}
          <div className="grow" />
          <span className="fs12 muted">你选择的大纲年份:{state.profile?.syllabusYear ?? '—'}</span>
        </div>
        {yearInfo && (
          <div className="explain-box">
            <b>{selectedYear} 年 · {yearInfo.status}</b>
            {'\n'}
            {yearInfo.note}
            {'\n'}
            核验状态:{yearInfo.verified}
          </div>
        )}
        {state.profile?.syllabusYear != null && state.profile.syllabusYear < currentYear && (
          <p className="fs12 mt8" style={{ color: 'var(--coral-deep)' }}>
            提示:你设置的大纲年份({state.profile.syllabusYear})早于当前年份({currentYear}),请在「设置 → 备考信息」中核对新年度要求。
          </p>
        )}
        <div className="row mt12" style={{ flexWrap: 'wrap', gap: 8 }}>
          <input
            className="input grow"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="更新源 URL(可选,指向静态托管的 catalog.json;如 GitHub Raw / 自建静态服务)"
            aria-label="更新源地址"
          />
          <button className="btn btn-primary" disabled={checking} onClick={checkUpdate}>
            <Icon name="refresh" size={14} /> {checking ? '检查中…' : '检查更新'}
          </button>
          <a
            className="btn"
            href="https://www.sdzk.cn/NewsInfo.aspx?NewsID=7081"
            target="_blank"
            rel="noreferrer"
          >
            官方发布页 ↗
          </a>
        </div>
        <p className="fs12 muted mt8">
          更新机制:内容包按版本管理,本地包随应用内置;远程源比对版本号后自动合并(只增不删,历史学习记录不受影响)。跨域或断网导致检查失败时,本地学习功能不受影响;也可随时用「设置 → 导入备份」手动更新。每年新大纲发布后,把新版内容包放到更新源即可完成"随年份更新"。
        </p>
      </div>

      <div className="card mb12">
        <div className="card-h">
          <span className="icon-chip">
            <Icon name="cap" size={15} />
          </span>
          <b>考试类别体系</b>
          <div className="right">
            <Chip tone="blue">4 门公共课 · 每科 100 分 · 总分 400</Chip>
          </div>
        </div>
        <p className="fs13 muted mb8">
          科目组合:大学语文 + 高等数学(Ⅰ/Ⅱ/Ⅲ)+ 英语或政治(二选一)+ 计算机;全部为全省统考。
        </p>
        <div className="col" style={{ gap: 8 }}>
          {CATEGORY_ORDER.map((c) => {
            const def = EXAM_CATEGORIES[c]
            return (
              <div key={c} className="node-h" style={{ border: '1px solid var(--line)', borderRadius: 8 }}>
                <Chip tone="blue">{def.name}</Chip>
                <b className="fs13">{def.math}</b>
                <span className="fs13 muted grow">{def.gates}</span>
                <span className="fs12 muted">{def.desc}</span>
              </div>
            )
          })}
        </div>
      </div>

      <div className="card mb12">
        <div className="card-h">
          <span className="icon-chip">
            <Icon name="book" size={15} />
          </span>
          <b>考纲章节体系(版本化)</b>
          <div className="right">
            <Chip tone="green">官方优先 · 差异已标记</Chip>
          </div>
        </div>
        <div className="col" style={{ gap: 10 }}>
          {state.subjects
            .filter((s) => subjectInLibrary(state, s))
            .map((s) => (
              <div key={s.id} className="node-h" style={{ border: '1px solid var(--line)', borderRadius: 8, alignItems: 'flex-start' }}>
                <div className="grow">
                  <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
                    <span className="dot" style={{ background: s.color }} />
                    <b className="fs13">{s.name}</b>
                    {s.syllabus && (
                      <>
                        <Chip tone="blue">考纲 {s.syllabus.version}({s.syllabus.year} 年)</Chip>
                        <Chip tone={s.syllabus.verified.includes('待') ? 'yellow' : 'green'}>{s.syllabus.verified}</Chip>
                      </>
                    )}
                  </div>
                  {s.syllabus && (
                    <div className="fs12 muted mt8">
                      来源:{s.syllabus.source} · 最后核验:{s.syllabus.updatedAt}
                    </div>
                  )}
                </div>
              </div>
            ))}
        </div>
        <p className="fs12 muted mt8">
          各科目章节的「考查要求」已录入知识校园的章节树(知识校园 → 列表管理中可见);不同来源存在差异时保留原始来源并标记待核实,以官方资料优先。
        </p>
      </div>

      <div className="card mb12">
        <div className="card-h">
          <span className="icon-chip">
            <Icon name="book" size={15} />
          </span>
          <b>高等数学Ⅰ / Ⅱ / Ⅲ 差异对比</b>
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 560 }}>
          <thead>
            <tr style={{ textAlign: 'left', color: 'var(--ink-2)' }}>
              <th style={th}>内容</th>
              <th style={th}>高等数学Ⅰ(理/工)</th>
              <th style={th}>高等数学Ⅱ(经/农/医/管)</th>
              <th style={th}>高等数学Ⅲ(文/法/教/史/艺/哲)</th>
            </tr>
          </thead>
          <tbody>
            {MATH_DIFF_ROWS.map((r) => (
              <tr key={r.topic} style={{ borderTop: '1px solid var(--line)' }}>
                <td style={td}><b>{r.topic}</b></td>
                <td style={td}>{r.m1}</td>
                <td style={td}>{r.m2}</td>
                <td style={td}>{r.m3}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="fs12 muted mt8">
          依据官方类别设置文件与历年考试要求整理;"不考/待核实"项请以省教育招生考试院当年《公共基础课考试要求》原文为准。学习顺序建议:极限 → 导数 → 积分 →(Ⅰ/Ⅱ)多元 →(Ⅰ)级数,前置知识已标注在每个知识点的详情页。
        </p>
      </div>

      <div className="card mb12">
        <div className="card-h">
          <span className="icon-chip">
            <Icon name="cap" size={15} />
          </span>
          <b>院校与专业查询</b>
          <div className="right">
            <Chip tone="yellow">招生院校/专业每年增减,以当年公布为准</Chip>
          </div>
        </div>
        <div className="row mb12" style={{ flexWrap: 'wrap', gap: 10 }}>
          <Segmented
            small
            value={tabCollege}
            onChange={setTabCollege}
            options={[
              { value: 'colleges', label: `招生院校(${collegeData?.colleges.length ?? 0})` },
              { value: 'majors', label: `本科专业(${collegeData?.majors.length ?? 0})` },
            ]}
          />
          <div className="grow" />
          {tabCollege === 'colleges' ? (
            <>
              <select className="input" style={{ width: 110 }} value={natureFilter} onChange={(e) => setNatureFilter(e.target.value)} aria-label="办学性质">
                <option value="">全部性质</option>
                <option value="公办">公办</option>
                <option value="民办">民办</option>
                <option value="独立学院">独立学院</option>
              </select>
              <input className="input" style={{ width: 180 }} value={collegeKw} onChange={(e) => setCollegeKw(e.target.value)} placeholder="院校名 / 城市" aria-label="搜索院校" />
            </>
          ) : (
            <input className="input" style={{ width: 220 }} value={majorKw} onChange={(e) => setMajorKw(e.target.value)} placeholder="专业名 / 门类,如:计算机 工学" aria-label="搜索专业" />
          )}
        </div>

        {collegeData == null ? (
          <p className="fs13 muted">院校库加载中…</p>
        ) : tabCollege === 'colleges' ? (
          colleges.length === 0 ? (
            <p className="fs13 muted">没有匹配的院校,换个关键词试试。</p>
          ) : (
            <div className="col" style={{ gap: 6 }}>
              {colleges.map((c) => (
                <div key={c.name} className="row" style={{ border: '1px solid var(--line)', borderRadius: 8, padding: '8px 12px' }}>
                  <b className="fs13 grow">{c.name}</b>
                  <span className="fs12 muted">{c.city}</span>
                  <Chip tone={c.nature === '公办' ? 'green' : c.nature === '民办' ? 'yellow' : 'gray'}>{c.nature}</Chip>
                </div>
              ))}
            </div>
          )
        ) : majors.length === 0 ? (
          <p className="fs13 muted">没有匹配的专业,换个关键词试试。</p>
        ) : (
          <div className="col" style={{ gap: 6 }}>
            {majors.map((m) => {
              const def = EXAM_CATEGORIES[m.category]
              return (
                <div key={m.name} className="row" style={{ border: '1px solid var(--line)', borderRadius: 8, padding: '8px 12px' }}>
                  <b className="fs13 grow">{m.name}</b>
                  <span className="fs12 muted">{m.gate}</span>
                  <Chip tone="blue">
                    {def.name} · {def.math}
                  </Chip>
                </div>
              )
            })}
          </div>
        )}
        <p className="fs12 muted mt8">
          报考规则:考生按专科毕业专业与指导目录的对应关系选报,所选专业对应的高数科目一经确定不得更改;具体招生院校与专业计划以省教育厅当年公布为准(此列表为参考,待核实当年名单)。
        </p>
      </div>

      <div className="card">
        <div className="card-h">
          <span className="icon-chip">
            <Icon name="eye" size={15} />
          </span>
          <b>资料来源</b>
          <div className="right fs12 muted">官方优先 · 机构与经验类内容均标注待核实</div>
        </div>
        <div className="col" style={{ gap: 10 }}>
          {SOURCE_REFS.map((s) => (
            <div key={s.name} className="node-h" style={{ border: '1px solid var(--line)', borderRadius: 8, alignItems: 'flex-start' }}>
              <div className="grow">
                <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
                  <b className="fs13">{s.name}</b>
                  <Chip tone={s.type === '官方规定' ? 'green' : 'yellow'}>{s.type}</Chip>
                  <Chip tone={s.status === '已核验' ? 'green' : 'yellow'}>{s.status}</Chip>
                </div>
                <div className="fs12 muted mt8">
                  {s.org} · {s.date}
                </div>
                <div className="fs12 muted">{s.note}</div>
                <a className="fs12" href={s.url} target="_blank" rel="noreferrer">
                  查看原文链接 ↗
                </a>
              </div>
            </div>
          ))}
        </div>
        <p className="fs12 muted mt12">
          使用说明:官方文件界定考试范围;本应用题库中的练习题为自编示例(official=false,不冒充真题)。每年大纲更新后,可在「设置 → 数据管理」导出备份,更新 public/data/ 下的内容包文件后重新进入应用即可合并,历史学习记录不受影响。
        </p>
      </div>
    </div>
  )
}

const th: React.CSSProperties = { padding: '8px 10px', fontWeight: 600, whiteSpace: 'nowrap' }
const td: React.CSSProperties = { padding: '8px 10px', verticalAlign: 'top', lineHeight: 1.6 }
