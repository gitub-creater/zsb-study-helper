// 设置:备考信息 / 复习间隔 / 外观动效 / 数据管理 / 路线图
import React, { useEffect, useRef, useState } from 'react'
import { useStore, emptyState } from '../store/store'
import { Chip, Field, Segmented, useConfirm, useToast } from '../components/ui'
import { Icon } from '../components/Icon'
import { Mascot } from '../components/Mascot'
import { intervalStageText } from '../lib/spaced'
import { CATEGORY_ORDER, ELECTIVE_TEXT, EXAM_CATEGORIES } from '../lib/categories'
import { download, nav } from '../lib/misc'
import { todayStr, fmtDateTime } from '../lib/date'
import { ABOUT, compareVersions } from '../lib/about'
import { loadColleges } from '../lib/colleges'
import type { College } from '../lib/colleges'
import { AI_PRESETS, DEFAULT_AI_PROXY_URL, aiModels as fetchAiModels, aiTest } from '../services/ai'
import type { AiConfig, AiModelOption, AiProviderId, AiTransport } from '../services/ai'
import type { CatalogData, ExamCategory, Elective, State } from '../types'

export function SettingsPage() {
  const { state, dispatch } = useStore()
  const toast = useToast()
  const [, confirm] = useConfirm()
  const fileRef = useRef<HTMLInputElement>(null)

  const p = state.profile
  const [major, setMajor] = useState(p?.major ?? '')
  const [category, setCategory] = useState<ExamCategory>(p?.category ?? 'gj1')
  const [elective, setElective] = useState<Elective>(p?.elective ?? 'english')
  const [targetCollege, setTargetCollege] = useState(p?.targetCollege ?? '')
  const [colleges, setColleges] = useState<College[]>([])
  const [examDate, setExamDate] = useState(p?.examDate ?? todayStr())

  useEffect(() => {
    loadColleges().then((c) => setColleges(c.colleges))
  }, [])
  const [dailyMinutes, setDailyMinutes] = useState(p?.dailyMinutes ?? 60)
  const [weeklyDays, setWeeklyDays] = useState(p?.weeklyDays ?? 5)
  const [intervals, setIntervals] = useState<number[]>([...state.settings.intervals])
  const [cap, setCap] = useState(state.settings.dailyPracticeXpCap)
  const [manifestUrl, setManifestUrl] = useState(state.settings.updateManifestUrl ?? '')
  const [checkingApp, setCheckingApp] = useState(false)
  const [latest, setLatest] = useState<{ version: string; notes?: string; url?: string } | null>(null)
  const [appUpdateMsg, setAppUpdateMsg] = useState('')

  // AI 判题服务配置
  const preset0: AiProviderId = (state.settings.ai?.provider as AiProviderId) ?? 'deepseek'
  const [aiProvider, setAiProvider] = useState<AiProviderId>(preset0)
  const [aiBase, setAiBase] = useState(state.settings.ai?.baseURL ?? AI_PRESETS[preset0].baseURL)
  const [aiKey, setAiKey] = useState(state.settings.ai?.apiKey ?? '')
  const [aiModel, setAiModel] = useState(state.settings.ai?.model ?? AI_PRESETS[preset0].model)
  const [aiTransport, setAiTransport] = useState<AiTransport>(state.settings.ai?.transport ?? 'auto')
  // 本地 Vercel 预览包含同一份 Serverless API，优先走当前入口，避免模型目录仍命中旧线上版本。
  const defaultAiProxyURL = typeof window !== 'undefined' && (() => {
    const host = window.location.hostname
    const localHost = /^(localhost|127\.0\.0\.1|\[::1\])$/i.test(host)
    const privateIpv4 = /^(10|192\.168|172\.(?:1[6-9]|2\d|3[0-1]))\./.test(host)
    return localHost || privateIpv4
  })()
    ? `${window.location.origin}/api/ai/proxy`
    : DEFAULT_AI_PROXY_URL
  const savedAiProxyURL = state.settings.ai?.proxyURL?.trim()
  const initialAiProxyURL = defaultAiProxyURL !== DEFAULT_AI_PROXY_URL && savedAiProxyURL === DEFAULT_AI_PROXY_URL
    ? defaultAiProxyURL
    : savedAiProxyURL || defaultAiProxyURL
  const [aiProxyURL, setAiProxyURL] = useState(initialAiProxyURL)
  const [aiEffort, setAiEffort] = useState<'low' | 'medium' | 'high'>(state.settings.ai?.reasoningEffort ?? 'medium')
  const [aiMode, setAiMode] = useState<'chat' | 'responses'>(state.settings.ai?.apiMode ?? 'chat')
  const [aiTimeout, setAiTimeout] = useState(state.settings.ai?.timeoutMs ?? 60000)
  const [aiStream, setAiStream] = useState(state.settings.ai?.stream !== false)
  const [aiTemperature, setAiTemperature] = useState(state.settings.ai?.temperature ?? 0.2)
  const [aiMaxTokens, setAiMaxTokens] = useState(state.settings.ai?.maxTokens ?? 2048)
  const [aiHeaders, setAiHeaders] = useState(() => JSON.stringify(state.settings.ai?.customHeaders ?? {}, null, 2))
  const [aiTesting, setAiTesting] = useState(false)
  const [availableModels, setAvailableModels] = useState<AiModelOption[]>([])
  const [loadingModels, setLoadingModels] = useState(false)

  const currentAiCfg = (): AiConfig => ({
    provider: aiProvider,
    baseURL: aiBase.trim(),
    apiKey: aiKey.trim(),
    model: aiModel.trim(),
    transport: aiTransport,
    proxyURL: aiProxyURL.trim(),
    reasoningEffort: aiEffort,
    apiMode: aiMode,
    timeoutMs: aiTimeout,
    stream: aiStream,
    temperature: aiTemperature,
    maxTokens: aiMaxTokens,
    customHeaders: (() => {
      try { return JSON.parse(aiHeaders || '{}') as Record<string, string> } catch { return {} }
    })(),
  })

  const saveAi = () => {
    const cfg = currentAiCfg()
    if (!cfg.baseURL || !cfg.apiKey || !cfg.model) {
      toast('接口地址 / API Key / 模型名都需要填写', { kind: 'error' })
      return
    }
    if (cfg.transport !== 'direct' && !cfg.proxyURL) {
      toast('使用自动或应用中转时，需要填写应用中转地址', { kind: 'error' })
      return
    }
    let headers: Record<string, string>
    try {
      const parsed = JSON.parse(aiHeaders || '{}') as unknown
      if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object' || Object.values(parsed).some((value) => typeof value !== 'string')) throw new Error('请求头必须是 JSON 对象，值为文本')
      headers = parsed as Record<string, string>
    } catch (error) {
      toast(error instanceof Error ? error.message : '自定义请求头格式不正确', { kind: 'error' })
      return
    }
    dispatch({ type: 'SET_SETTINGS', patch: { ai: { ...cfg, customHeaders: headers, reasoningEffort: aiEffort } } })
    toast('AI 服务配置已保存(密钥仅存本机)', { kind: 'success' })
  }

  const testAi = async () => {
    setAiTesting(true)
    try {
      const reply = await aiTest(currentAiCfg())
      toast(`连接成功,模型回复:${reply.slice(0, 40)}`, { kind: 'success' })
    } catch (e) {
      toast(e instanceof Error ? e.message : '连接失败', { kind: 'error' })
    } finally {
      setAiTesting(false)
    }
  }

  const loadModels = async () => {
    const cfg = currentAiCfg()
    if (!cfg.baseURL || !cfg.apiKey) {
      toast('读取模型列表需要先填写接口地址和 API Key', { kind: 'error' })
      return
    }
    setLoadingModels(true)
    try {
      const models = await fetchAiModels(cfg)
      setAvailableModels(models)
      if (!aiModel.trim() && models[0]) setAiModel(models[0].id)
      toast(`已从上游读取 ${models.length} 个模型`, { kind: 'success' })
    } catch (e) {
      setAvailableModels([])
      toast(e instanceof Error ? e.message : '读取模型列表失败', { kind: 'error' })
    } finally {
      setLoadingModels(false)
    }
  }

  const checkAppUpdate = async () => {
    if (!manifestUrl.trim()) {
      toast('请先填写版本清单 URL(指向 {version, notes, url} 的 JSON 文件)', { kind: 'error' })
      return
    }
    setCheckingApp(true)
    setAppUpdateMsg('')
    try {
      const res = await fetch(`${manifestUrl.trim()}${manifestUrl.includes('?') ? '&' : '?'}t=${Date.now()}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const m = (await res.json()) as { version?: string; notes?: string; url?: string }
      if (!m.version) throw new Error('清单缺少 version 字段')
      setLatest({ version: m.version, notes: m.notes, url: m.url })
      dispatch({ type: 'SET_SETTINGS', patch: { updateManifestUrl: manifestUrl.trim() } })
      dispatch({ type: 'SET_APP_UPDATE_CHECKED', t: Date.now() })
      const cmp = compareVersions(m.version, ABOUT.version)
      setAppUpdateMsg(cmp > 0 ? `发现新版本 v${m.version}` : `已是最新版本(v${ABOUT.version})`)
    } catch (e) {
      setAppUpdateMsg('')
      toast(`检查失败:${e instanceof Error ? e.message : '网络或跨域限制'}`, { kind: 'error' })
    } finally {
      setCheckingApp(false)
    }
  }

  if (!p) return null

  const saveProfile = () => {
    if (!major.trim()) {
      toast('报考专业不能为空', { kind: 'error' })
      return
    }
    if (examDate <= todayStr()) {
      toast('考试日期需要晚于今天', { kind: 'error' })
      return
    }
    dispatch({
      type: 'UPDATE_PROFILE',
      patch: { major: major.trim(), category, elective, targetCollege: targetCollege || undefined, examDate, dailyMinutes, weeklyDays },
    })
    toast(`已保存:当前类别 ${EXAM_CATEGORIES[category].name} · ${EXAM_CATEGORIES[category].math}。可在「学习计划」重新生成任务。`, { kind: 'success' })
  }

  const saveIntervals = () => {
    if (intervals.some((n) => !Number.isFinite(n) || n < 1 || n > 90)) {
      toast('每档间隔需在 1–90 天之间', { kind: 'error' })
      return
    }
    const sorted = [...intervals].sort((a, b) => a - b)
    if (sorted.some((n, i) => n === sorted[i + 1])) {
      toast('各档间隔不能重复', { kind: 'error' })
      return
    }
    dispatch({ type: 'SET_SETTINGS', patch: { intervals: sorted } })
    setIntervals(sorted)
    toast('复习间隔已更新:' + intervalStageText(sorted), { kind: 'success' })
  }

  const exportData = () => {
    download(`zsb-backup-${todayStr()}.json`, JSON.stringify(state, null, 2))
    toast('备份文件已导出', { kind: 'success' })
  }

  const importData = (file: File) => {
    const reader = new FileReader()
    reader.onload = async () => {
      try {
        const data = JSON.parse(String(reader.result)) as State
        if (!Array.isArray(data.subjects) || typeof data.onboarded !== 'boolean') {
          throw new Error('格式不对')
        }
        const ok = await confirm({
          title: '导入备份?',
          desc: '当前所有数据会被备份文件覆盖,此操作无法撤销。',
          danger: true,
          confirmText: '覆盖导入',
        })
        if (ok) {
          dispatch({ type: 'IMPORT_STATE', state: data })
          toast('备份已导入', { kind: 'success' })
        }
      } catch {
        toast('文件格式不正确,导入失败', { kind: 'error' })
      }
    }
    reader.readAsText(file)
  }

  return (
    <div>
      <div className="page-h">
        <h2>设置</h2>
      </div>

      <div className="grid2">
        <div className="col">
          <div className="card">
            <div className="card-h">
              <span className="icon-chip">
                <Icon name="user" size={15} />
              </span>
              <b>备考信息</b>
            </div>
            <Field label="报考专业">
              <input className="input" value={major} onChange={(e) => setMajor(e.target.value)} />
            </Field>
            <Field label="报考类别" hint={EXAM_CATEGORIES[category].desc}>
              <select className="input" value={category} onChange={(e) => setCategory(e.target.value as ExamCategory)}>
                {CATEGORY_ORDER.map((c) => (
                  <option key={c} value={c}>
                    {EXAM_CATEGORIES[c].name}({EXAM_CATEGORIES[c].gates})
                  </option>
                ))}
              </select>
            </Field>
            <Field label="公共课(二选一)">
              <Segmented
                value={elective}
                onChange={(v) => setElective(v)}
                options={[
                  { value: 'english' as Elective, label: '英语' },
                  { value: 'politics' as Elective, label: '政治' },
                ]}
              />
            </Field>
            <div className="form-grid">
            <Field label="目标院校(可选)" hint="可在「考试资料」查询院校与专业">
              <select className="input" value={targetCollege} onChange={(e) => setTargetCollege(e.target.value)}>
                <option value="">暂不确定</option>
                {colleges.map((c) => (
                  <option key={c.name} value={c.name}>
                    {c.name}({c.city} · {c.nature})
                  </option>
                ))}
              </select>
            </Field>
            <Field label="考试日期">
              <input className="input" type="date" value={examDate} min={todayStr()} onChange={(e) => setExamDate(e.target.value)} />
            </Field>
              <Field label="考试大纲年份">
                <select className="input" value={p.syllabusYear} onChange={(e) => dispatch({ type: 'UPDATE_PROFILE', patch: { syllabusYear: Number(e.target.value) } })}>
                  {[2024, 2025, 2026, 2027].map((y) => (
                    <option key={y} value={y}>{y} 年</option>
                  ))}
                </select>
              </Field>
              <Field label="每天可学习时间(分钟)">
                <select className="input" value={dailyMinutes} onChange={(e) => setDailyMinutes(Number(e.target.value))}>
                  {[30, 60, 90, 120, 180, 240].map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              </Field>
              <Field label="每周可学习天数">
                <select className="input" value={weeklyDays} onChange={(e) => setWeeklyDays(Number(e.target.value))}>
                  {[3, 4, 5, 6, 7].map((d) => (
                    <option key={d} value={d}>{d} 天</option>
                  ))}
                </select>
              </Field>
            </div>
            <div className="row" style={{ justifyContent: 'flex-end' }}>
              <button className="btn btn-primary" onClick={saveProfile}>
                保存备考信息
              </button>
            </div>
            <p className="fs12 muted mt8">
              考试科目、章节与知识点随时可在「知识校园 → 列表管理」编辑,不会把考试内容写死在程序里。
            </p>
          </div>

          <div className="card">
            <div className="card-h">
              <span className="icon-chip" style={{ background: 'var(--coral-weak)', color: 'var(--coral-deep)' }}>
                <Icon name="wrongbook" size={15} />
              </span>
              <b>错题复习间隔</b>
            </div>
            <p className="fs13 mb8">当前:{intervalStageText(state.settings.intervals)}。再次答错回退一档,连续答对推进一档。</p>
            <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
              {intervals.map((n, i) => (
                <input
                  key={i}
                  className="input"
                  style={{ width: 64 }}
                  type="number"
                  min={1}
                  max={90}
                  value={n}
                  aria-label={`第 ${i + 1} 档间隔天数`}
                  onChange={(e) => setIntervals(intervals.map((x, j) => (j === i ? Number(e.target.value) : x)))}
                />
              ))}
              <span className="fs12 muted">天</span>
            </div>
            <div className="row mt12" style={{ justifyContent: 'flex-end' }}>
              <button className="btn" onClick={() => setIntervals([1, 3, 7, 14, 30])}>
                恢复默认
              </button>
              <button className="btn btn-primary" onClick={saveIntervals}>
                保存间隔
              </button>
            </div>
          </div>
        </div>

        <div className="col">
          <div className="card">
            <div className="card-h">
              <span className="icon-chip">
                <Icon name="settings" size={15} />
              </span>
              <b>外观与动效</b>
            </div>
            <div className="setting-row">
              <div className="info grow">
                <b>减少动画</b>
                <span>关闭吉祥物漂浮等动效,界面更安静</span>
              </div>
              <button
                className={`switch${state.settings.reduceMotion ? ' on' : ''}`}
                aria-label="减少动画"
                aria-pressed={state.settings.reduceMotion}
                onClick={() => dispatch({ type: 'SET_SETTINGS', patch: { reduceMotion: !state.settings.reduceMotion } })}
              />
            </div>
            <div className="setting-row">
              <div className="info grow">
                <b>显示吉祥物芽芽</b>
                <span>在首页与空状态页面出现,不会遮挡题目</span>
              </div>
              <button
                className={`switch${state.settings.mascotEnabled ? ' on' : ''}`}
                aria-label="显示吉祥物"
                aria-pressed={state.settings.mascotEnabled}
                onClick={() => dispatch({ type: 'SET_SETTINGS', patch: { mascotEnabled: !state.settings.mascotEnabled } })}
              />
            </div>
          </div>

          <div className="card">
            <div className="card-h">
              <span className="icon-chip" style={{ background: 'var(--primary-weak)', color: 'var(--primary-deep)' }}>
                <Icon name="volume" size={15} />
              </span>
              <b>语音朗读</b>
            </div>
            <div className="setting-row">
              <div className="info grow">
                <b>启用语音朗读</b>
                <span>可随时打开或关闭。关闭会立刻停止正在播放的讲题和任务播报，文字内容不会受影响。</span>
              </div>
              <button
                className={`switch${state.settings.speech?.enabled !== false ? ' on' : ''}`}
                aria-label="启用语音朗读"
                aria-pressed={state.settings.speech?.enabled !== false}
                onClick={() => dispatch({
                  type: 'SET_SETTINGS',
                  patch: {
                    speech: {
                      ...(state.settings.speech ?? { rate: 1, preferredLang: 'zh-CN' }),
                      enabled: state.settings.speech?.enabled === false,
                      preferredLang: 'zh-CN',
                    },
                  },
                })}
              />
            </div>
            <p className="fs12 muted mt8">语速和音色可在「AI 数字讲题」的讲解下方调整，并会自动保存在当前账号；已安排任务仍可单独开启或关闭播报。</p>
          </div>

          <div className="card">
            <div className="card-h">
              <span className="icon-chip" style={{ background: 'var(--yellow-weak)', color: 'var(--yellow-deep)' }}>
                <Icon name="zap" size={15} />
              </span>
              <b>经验防刷上限</b>
            </div>
            <p className="fs13 mb8">每天通过答题最多可获得的经验(任务/复习/掌握奖励不受此限制)。</p>
            <div className="row">
              <input className="input" style={{ width: 90 }} type="number" min={0} max={500} value={cap} onChange={(e) => setCap(Number(e.target.value))} aria-label="每日答题经验上限" />
              <span className="fs13 muted">经验/天</span>
              <div className="grow" />
              <button
                className="btn btn-primary"
                onClick={() => {
                  if (cap < 0 || cap > 500 || !Number.isFinite(cap)) {
                    toast('请输入 0–500 之间的数值', { kind: 'error' })
                    return
                  }
                  dispatch({ type: 'SET_SETTINGS', patch: { dailyPracticeXpCap: cap } })
                  toast('已保存', { kind: 'success' })
                }}
              >
                保存
              </button>
            </div>
          </div>

          <div className="card">
            <div className="card-h">
              <span className="icon-chip" style={{ background: 'var(--green-weak)', color: 'var(--green-deep)' }}>
                <Icon name="download" size={15} />
              </span>
              <b>数据管理</b>
            </div>
            <p className="fs13 mb8">
              所有学习数据保存在本机浏览器中,刷新或重启不会丢失;换设备时可用备份文件迁移。
            </p>
            <div className="row" style={{ flexWrap: 'wrap' }}>
              <button className="btn" onClick={exportData}>
                <Icon name="download" size={14} /> 导出备份
              </button>
              <button className="btn" onClick={() => fileRef.current?.click()}>
                <Icon name="upload" size={14} /> 导入备份
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="application/json"
                style={{ display: 'none' }}
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) importData(f)
                  e.target.value = ''
                }}
              />
              <div className="grow" />
              <button
                className="btn btn-danger-solid"
                onClick={async () => {
                  const ok1 = await confirm({ title: '清空全部数据?', desc: '角色、题库、错题、经验全部删除,恢复到初始状态。此操作不可撤销。', danger: true, confirmText: '继续' })
                  if (!ok1) return
                  const ok2 = await confirm({ title: '再次确认', desc: '真的要清空吗?建议先「导出备份」。', danger: true, confirmText: '确认清空' })
                  if (ok2) {
                    dispatch({ type: 'RESET' })
                    toast('已清空,欢迎重新开始')
                    nav('today')
                  }
                }}
              >
                <Icon name="trash" size={14} /> 清空全部数据
              </button>
            </div>
          </div>

          <div className="card">
            <div className="card-h">
              <span className="icon-chip">
                <Icon name="refresh" size={15} />
              </span>
              <b>软件更新</b>
              <div className="right">
                <span className="chip num">当前 v{ABOUT.version}</span>
              </div>
            </div>
            <p className="fs13 mb8">发布新版本后,把版本清单 JSON 放到任意静态托管地址,填入下方即可一键检查。</p>
            <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
              <input
                className="input grow"
                value={manifestUrl}
                onChange={(e) => setManifestUrl(e.target.value)}
                placeholder="版本清单 URL,内容如 {&quot;version&quot;:&quot;0.3.0&quot;,&quot;notes&quot;:&quot;…&quot;,&quot;url&quot;:&quot;…&quot;}"
                aria-label="版本清单地址"
              />
              <button className="btn btn-primary" disabled={checkingApp} onClick={checkAppUpdate}>
                <Icon name="refresh" size={14} /> {checkingApp ? '检查中…' : '检查更新'}
              </button>
            </div>
            {appUpdateMsg && (
              <div className="explain-box mt8">
                {appUpdateMsg}
                {latest && compareVersions(latest.version, ABOUT.version) > 0 && (
                  <>
                    {'\n'}
                    {latest.notes ? `更新内容:${latest.notes}` : ''}
                    {'\n'}
                    <b>更新前建议先「导出备份」;学习数据在新版本中可一键导入恢复。</b>
                    {'\n'}
                  </>
                )}
              </div>
            )}
            {latest && compareVersions(latest.version, ABOUT.version) > 0 && latest.url && (
              <div className="row mt8" style={{ justifyContent: 'flex-end' }}>
                <button className="btn btn-primary" onClick={() => window.open(latest.url, '_blank', 'noopener')}>
                  <Icon name="download" size={14} /> 一键获取新版本(v{latest.version})
                </button>
              </div>
            )}
            {state.lastAppUpdateCheck ? (
              <p className="fs12 muted mt8">上次检查:{fmtDateTime(new Date(state.lastAppUpdateCheck).toISOString())}</p>
            ) : null}
          </div>

          <div className="card">
            <div className="card-h">
              <span className="icon-chip" style={{ background: 'var(--coral-weak)', color: 'var(--coral-deep)' }}>
                <Icon name="sparkle" size={15} />
              </span>
              <b>AI 服务(判题 / 数学讲题)</b>
              <div className="right">
                <Chip tone={state.settings.ai?.apiKey ? 'green' : 'gray'}>
                  {state.settings.ai?.apiKey ? '已配置' : '未配置'}
                </Chip>
              </div>
            </div>
            <p className="fs13 mb8">
              接入豆包 / DeepSeek / 千问后，可在「AI 数学讲题」页面拍照或输入题目获得分步解析。实操大题会先按题目中的客观核对项判定，版式、动画等仍须按评分标准人工复核。密钥仅保存在当前设备，不会上传到云端。
            </p>
            <Field label="服务商">
              <select
                className="input"
                value={aiProvider}
                onChange={(e) => {
                  const id = e.target.value as AiProviderId
                  setAiProvider(id)
                  setAiBase(AI_PRESETS[id].baseURL)
                  setAiModel(AI_PRESETS[id].model)
                  setAvailableModels([])
                }}
              >
                {(Object.keys(AI_PRESETS) as AiProviderId[]).map((id) => (
                  <option key={id} value={id}>{AI_PRESETS[id].name}</option>
                ))}
              </select>
            </Field>
            <p className="fs12 muted" style={{ marginTop: -6, marginBottom: 10 }}>{AI_PRESETS[aiProvider].note}</p>
            <Field label="接口地址(OpenAI 兼容)" hint="填写服务商给出的 Base URL，例如 https://api.example.com 或带 /v1 的地址；不要填写密钥或模型路径">
              <input className="input" value={aiBase} onChange={(e) => { setAiBase(e.target.value); setAvailableModels([]) }} placeholder="https://…" />
            </Field>
            <Field label="请求方式" hint="CC Switch、Codex++ 等接口若被浏览器跨域拦截，使用“自动”或“应用中转”">
              <Segmented
                small
                value={aiTransport}
                onChange={setAiTransport}
                options={[
                  { value: 'auto' as const, label: '自动（推荐）' },
                  { value: 'proxy' as const, label: '应用中转' },
                  { value: 'direct' as const, label: '浏览器直连' },
                ]}
              />
            </Field>
            {aiTransport !== 'direct' && (
              <Field label="应用中转地址" hint="默认地址适用于网页、桌面和手机端；仅转发本次请求，不保存 API Key">
                <input className="input" value={aiProxyURL} onChange={(e) => setAiProxyURL(e.target.value)} placeholder={DEFAULT_AI_PROXY_URL} />
              </Field>
            )}
            <Field label="API Key">
              <input className="input" type="password" value={aiKey} onChange={(e) => { setAiKey(e.target.value); setAvailableModels([]) }} placeholder="sk-…" />
            </Field>
            <Field label="模型名">
              <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                <input
                  className="input grow"
                  value={aiModel}
                  onChange={(e) => setAiModel(e.target.value)}
                  placeholder="如 deepseek-chat / qwen-plus"
                  aria-describedby="upstream-ai-models-hint"
                />
                <button className="btn" type="button" disabled={loadingModels} onClick={loadModels}>
                  <Icon name="refresh" size={14} /> {loadingModels ? '读取中…' : '读取模型'}
                </button>
              </div>
              {availableModels.length > 0 && (
                <select
                  className="input mt8"
                  value={availableModels.some((model) => model.id === aiModel) ? aiModel : ''}
                  onChange={(e) => setAiModel(e.target.value)}
                  aria-label="选择已读取的上游模型"
                >
                  <option value="">从已读取模型中选择…</option>
                  {availableModels.map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.name === model.id ? model.id : `${model.name}（${model.id}）`}
                    </option>
                  ))}
                </select>
              )}
              <span id="upstream-ai-models-hint" className="fs12 muted">
                {availableModels.length ? `已读取 ${availableModels.length} 个上游模型，可在下方菜单选择；也可以手动填写模型名。` : '点击“读取模型”从当前上游的 GET /models 获取列表。'}
              </span>
            </Field>
            <Field label="接口协议" hint="大多数中转站使用 Chat Completions；Codex++ 常用 Responses API，请按服务商说明选择">
              <Segmented
                small
                value={aiMode}
                onChange={setAiMode}
                options={[
                  { value: 'chat' as const, label: '对话补全接口' },
                  { value: 'responses' as const, label: 'Responses API' },
                ]}
              />
            </Field>
            <div className="form-grid">
              <Field label="请求超时(秒)">
                <input className="input" type="number" min={5} max={300} value={Math.round(aiTimeout / 1000)} onChange={(e) => { const value = Number(e.target.value); if (Number.isFinite(value)) setAiTimeout(Math.max(5000, Math.min(300000, value * 1000))) }} />
              </Field>
              <Field label="最大输出 Token">
                <input className="input" type="number" min={128} max={32768} value={aiMaxTokens} onChange={(e) => { const value = Number(e.target.value); if (Number.isFinite(value)) setAiMaxTokens(Math.max(128, Math.min(32768, value))) }} />
              </Field>
              <Field label="温度">
                <input className="input" type="number" min={0} max={2} step={0.1} value={aiTemperature} onChange={(e) => { const value = Number(e.target.value); if (Number.isFinite(value)) setAiTemperature(Math.max(0, Math.min(2, value))) }} />
              </Field>
            </div>
            <div className="setting-row">
              <div className="info grow">
                <b>启用流式输出</b>
                <span>服务商支持 SSE 时边生成边显示；关闭后等待完整 JSON 回复。</span>
              </div>
              <button className={`switch${aiStream ? ' on' : ''}`} aria-label="启用流式输出" aria-pressed={aiStream} onClick={() => setAiStream((value) => !value)} />
            </div>
            <Field label="自定义请求头(JSON)" hint="例如 {&quot;X-Channel&quot;:&quot;codex&quot;}；需要 x-api-key 时在此填写，不要把密钥写进源码或分享给他人">
              <textarea className="input" rows={3} value={aiHeaders} onChange={(e) => setAiHeaders(e.target.value)} placeholder={'{\n  "X-Channel": "study"\n}'} />
            </Field>
            <Field label="思考程度" hint="只影响讲解详细程度与验证强度:高=完整验证流程,低=精炼输出">
              <Segmented
                value={aiEffort}
                onChange={(v) => setAiEffort(v)}
                options={[
                  { value: 'low' as const, label: '低' },
                  { value: 'medium' as const, label: '中' },
                  { value: 'high' as const, label: '高' },
                ]}
              />
            </Field>
            <div className="row" style={{ justifyContent: 'flex-end', gap: 8 }}>
              <button className="btn" disabled={aiTesting} onClick={testAi}>
                <Icon name="zap" size={14} /> {aiTesting ? '测试中…' : '测试连接'}
              </button>
              <button className="btn btn-primary" onClick={saveAi}>
                保存配置
              </button>
            </div>
          </div>

          <div className="card">
            <div className="card-h">
              <span className="icon-chip">
                <Icon name="sparkle" size={15} />
              </span>
              <b>开发路线图</b>
            </div>
            <div className="col" style={{ gap: 6 }}>
              {[
                ['第一阶段', '设置 / 科目管理 / 每日任务 / 题库 / 做题 / 错题本 / 间隔复习 / 掌握度 / 等级', true],
                ['第二阶段', 'Excel 导入 / 模拟考试 / 完整数据分析 / 互动地图 / 装扮解锁', false],
                ['第三阶段', '联网热门题 / 来源核验 / 相似题去重 / 考点趋势', false],
                ['第四阶段', 'AI 文字讲题 / 语音讲题 / 语音提问 / 隐私与费用控制', false],
              ].map(([phase, desc, done]) => (
                <div key={phase as string} className="row">
                  <Icon name={done ? 'check' : 'clock'} size={14} />
                  <b className="fs13" style={{ width: 64 }}>{phase as string}</b>
                  <span className="fs12 muted grow">{desc as string}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="card mt12" style={{ textAlign: 'center' }}>
        <div className="row" style={{ justifyContent: 'center', gap: 10 }}>
          <Mascot mood="idle" size={44} />
          <div style={{ textAlign: 'left' }}>
            <b className="fs14">{ABOUT.appName}</b>
            <div className="fs12 muted num">版本 v{ABOUT.version}</div>
          </div>
        </div>
        <div className="mt12 fs13">
          软件开发者:{ABOUT.developer}
          <br />
          {ABOUT.copyright}
        </div>
        <p className="fs12 muted mt8" style={{ maxWidth: 560, margin: '8px auto 0', lineHeight: 1.8 }}>
          {ABOUT.notice}
        </p>
      </div>
    </div>
  )
}
