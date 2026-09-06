// 主题皮肤:内置主题切换 + 自定义皮肤(主色/辅助色/按钮色/圆角/阴影/透明度/深色/背景图)
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../store/store'
import { Modal, Field, useToast, useConfirm, EmptyState } from '../components/ui'
import { Icon } from '../components/Icon'
import { THEMES, THEME_ORDER, applySkin, checkSkinReadability, skinFromColors } from '../lib/theme'
import { SKIN_IMAGE_RULES, processSkinImage, readableOn } from '../lib/colorExtract'
import { SKIN_MODULE_TEXT } from '../types'
import type { CustomSkin, SkinModule, SkinVars, ThemeKind } from '../types'
import { uid } from '../lib/misc'

const DEFAULT_DRAFT: SkinVars = {
  primary: '#3E9BFF',
  secondary: '#2FA96E',
  accent: '#2465B8',
  radius: 8,
  shadow: 1,
  opacity: 1,
  dark: false,
  bgImage: undefined,
  bgModules: [],
}

function SkinPreviewCard({ label, vars }: { label: string; vars: SkinVars }) {
  const btnText = readableOn(vars.accent || vars.primary)
  return (
    <div
      className="theme-preview"
      style={{
        background: vars.dark ? '#0f141c' : '#f2f6fb',
        borderRadius: vars.radius + 4,
        border: '1px solid rgba(120,140,170,0.25)',
      }}
      aria-label={`${label}预览`}
    >
      <div className="theme-preview-side" style={{ background: vars.dark ? '#161d29' : '#ffffff', borderRadius: vars.radius }}>
        <i style={{ background: vars.primary }} />
        <i style={{ background: vars.secondary, width: 14 }} />
      </div>
      <div className="theme-preview-main">
        <div
          className="theme-preview-card"
          style={{
            background: vars.dark ? 'rgba(22,29,41,0.92)' : `rgba(255,255,255,${vars.opacity})`,
            borderRadius: vars.radius,
            boxShadow: vars.shadow === 0 ? 'none' : vars.shadow === 2 ? '0 4px 14px rgba(0,0,0,0.18)' : '0 1px 6px rgba(0,0,0,0.10)',
            color: vars.dark ? '#dee7f2' : '#26313e',
          }}
        >
          <b style={{ color: vars.primary }}>今日学习</b>
          <span>高等数学Ⅰ · 极限与连续</span>
          <div className="theme-preview-btns">
            <span className="theme-preview-btn" style={{ background: vars.accent, color: btnText, borderRadius: vars.radius }}>
              开始练习
            </span>
            <span
              className="theme-preview-btn theme-preview-btn-soft"
              style={{ background: vars.dark ? 'rgba(92,169,255,0.18)' : '#e7f2ff', color: vars.primary, borderRadius: vars.radius }}
            >
              复习错题
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}

export function ThemePage() {
  const { state, dispatch } = useStore()
  const toast = useToast()
  const [confirmNode, confirm] = useConfirm()
  const skins = state.skins ?? { activeId: null, customs: [] }
  const builtin = state.profile?.theme ?? 'sky'
  const route = window.location.hash.replace(/^#\//, '').split('/')[0]

  // 编辑中的皮肤草稿;null = 未在编辑
  const [draft, setDraft] = useState<(SkinVars & { id?: string; name?: string }) | null>(null)
  const [savingName, setSavingName] = useState('')
  const [renameTarget, setRenameTarget] = useState<CustomSkin | null>(null)
  const [renameText, setRenameText] = useState('')
  const [imgBusy, setImgBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const activeCustom = useMemo(() => skins.customs.find((s) => s.id === skins.activeId) ?? null, [skins])

  // 状态变化(切换主题/应用皮肤/进入页面)时,把真实保存的皮肤应用回去
  useEffect(() => {
    if (!draft) applySkin(activeCustom, builtin, route)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCustom, builtin, route])

  // 卸载时恢复保存的皮肤,避免预览残留
  useEffect(() => {
    return () => applySkin(activeCustom, builtin, route)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function livePreview(next: SkinVars & { id?: string; name?: string }) {
    setDraft(next)
    const check = checkSkinReadability(next)
    if (!check.ok) check.issues.forEach((i) => toast(i, { kind: 'info' }))
    const preview: CustomSkin = {
      ...DEFAULT_DRAFT,
      ...next,
      id: next.id ?? 'preview',
      name: next.name ?? '预览',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    applySkin(preview, builtin, route)
  }

  function pickBuiltin(t: ThemeKind) {
    dispatch({ type: 'UPDATE_PROFILE', patch: { theme: t } })
    dispatch({ type: 'SKIN_APPLY', id: null })
    setDraft(null)
    toast(`已切换到「${THEMES[t].name}」主题`, { kind: 'success' })
  }

  function startNewSkin() {
    const seed = activeCustom ?? skinFromColors(THEMES[builtin].primary, THEMES[builtin].sec ?? '#2FA96E', THEMES[builtin].deep, false)
    livePreview({ ...seed, id: undefined, name: '', bgImage: undefined, bgModules: [] })
  }

  function editSkin(s: CustomSkin) {
    livePreview({ ...s })
  }

  async function saveSkin() {
    if (!draft) return
    const name = (draft.name ?? '').trim() || (savingName.trim() || '').trim()
    if (!name) {
      toast('请先给皮肤起个名字', { kind: 'error' })
      return
    }
    const check = checkSkinReadability(draft)
    const skin: CustomSkin = {
      ...DEFAULT_DRAFT,
      ...draft,
      id: draft.id ?? uid('skin'),
      name,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    dispatch({ type: 'SKIN_SAVE', skin })
    dispatch({ type: 'SKIN_APPLY', id: skin.id })
    setDraft(null)
    setSavingName('')
    toast(check.ok ? `皮肤「${name}」已保存并应用` : `皮肤「${name}」已保存(对比度已自动修正)`, { kind: 'success' })
  }

  async function removeSkin(s: CustomSkin) {
    const ok = await confirm({
      title: '删除皮肤',
      desc: `确定删除自定义皮肤「${s.name}」吗?该操作不可撤销。`,
      danger: true,
      confirmText: '删除',
    })
    if (!ok) return
    dispatch({ type: 'SKIN_DELETE', id: s.id })
    toast('已删除皮肤')
  }

  async function onUpload(file: File | undefined) {
    if (!file || !draft) return
    setImgBusy(true)
    try {
      const res = await processSkinImage(file)
      livePreview({
        ...draft,
        bgImage: res.dataUrl,
        primary: res.palette.primary,
        secondary: res.palette.secondary,
        accent: res.palette.accent,
        dark: res.palette.dark,
      })
      toast(`已提取主色 ${res.palette.primary}、辅助色 ${res.palette.secondary}、强调色 ${res.palette.accent}`, { kind: 'success' })
    } catch (e) {
      toast(e instanceof Error ? e.message : '图片处理失败', { kind: 'error' })
    } finally {
      setImgBusy(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  function toggleModule(m: SkinModule) {
    if (!draft) return
    const cur = draft.bgModules ?? []
    const next = cur.includes(m) ? cur.filter((x) => x !== m) : [...cur, m]
    livePreview({ ...draft, bgModules: next })
  }

  return (
    <div className="page theme-page">
      {confirmNode}
      <input
        ref={fileRef}
        type="file"
        accept={SKIN_IMAGE_RULES.types.join(',')}
        style={{ display: 'none' }}
        onChange={(e) => void onUpload(e.target.files?.[0])}
      />

      <section className="card">
        <div className="card-h">
          <b>内置主题</b>
          <button className="btn btn-sm" onClick={() => pickBuiltin('sky')}>
            <Icon name="refresh" size={14} /> 恢复默认主题
          </button>
        </div>
        <p className="muted" style={{ marginBottom: 10 }}>
          点击卡片立即切换并保存到当前账号;深色护眼会同时切换全局底色。
        </p>
        <div className="theme-grid">
          {THEME_ORDER.map((k) => {
            const t = THEMES[k]
            const on = !skins.activeId && builtin === k
            return (
              <button key={k} type="button" className={`theme-card${on ? ' on' : ''}`} onClick={() => pickBuiltin(k)} aria-pressed={on}>
                <span className="theme-swatch" aria-hidden>
                  {[t.primary, t.deep, t.sec ?? '#2FA96E', t.soft].map((c, i) => (
                    <i key={i} style={{ background: c }} />
                  ))}
                </span>
                <b>{t.name}</b>
                {on && (
                  <span className="chip chip-blue">
                    <Icon name="check" size={12} /> 使用中
                  </span>
                )}
              </button>
            )
          })}
        </div>
      </section>

      <section className="card">
        <div className="card-h">
          <b>自定义皮肤</b>
          {!draft && (
            <button className="btn btn-sm btn-primary" onClick={startNewSkin}>
              <Icon name="plus" size={14} /> 新建皮肤
            </button>
          )}
        </div>

        {!draft ? (
          skins.customs.length === 0 ? (
            <EmptyState mood="think" title="还没有自定义皮肤" desc="新建皮肤后可以自由搭配主色、圆角、阴影,还可以上传背景图自动取色。" />
          ) : (
            <div className="theme-grid">
              {skins.customs.map((s) => (
                <div key={s.id} className={`theme-card skin-item${skins.activeId === s.id ? ' on' : ''}`}>
                  <button type="button" className="skin-item-main" onClick={() => dispatch({ type: 'SKIN_APPLY', id: s.id })} aria-label={`应用皮肤 ${s.name}`}>
                    <span className="theme-swatch" aria-hidden>
                      {[s.primary, s.secondary, s.accent, s.dark ? '#161d29' : '#ffffff'].map((c, i) => (
                        <i key={i} style={{ background: c }} />
                      ))}
                    </span>
                    <b>{s.name}</b>
                    {skins.activeId === s.id && (
                      <span className="chip chip-blue">
                        <Icon name="check" size={12} /> 使用中
                      </span>
                    )}
                  </button>
                  <div className="skin-item-ops">
                    <button className="btn btn-xs" onClick={() => editSkin(s)}>
                      <Icon name="edit" size={12} /> 编辑
                    </button>
                    <button
                      className="btn btn-xs"
                      onClick={() => {
                        setRenameTarget(s)
                        setRenameText(s.name)
                      }}
                    >
                      重命名
                    </button>
                    <button className="btn btn-xs btn-danger-soft" onClick={() => void removeSkin(s)}>
                      <Icon name="trash" size={12} /> 删除
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )
        ) : (
          <div className="skin-editor">
            <SkinPreviewCard label="皮肤" vars={draft} />
            <div className="skin-form">
              <Field label="皮肤名称" hint="保存后可随时重命名">
                <input value={draft.name ?? ''} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="例如:我的夜自习" maxLength={20} />
              </Field>
              <div className="skin-colors">
                <Field label="主色">
                  <input type="color" value={draft.primary} onChange={(e) => livePreview({ ...draft, primary: e.target.value })} aria-label="主色" />
                </Field>
                <Field label="辅助色">
                  <input type="color" value={draft.secondary} onChange={(e) => livePreview({ ...draft, secondary: e.target.value })} aria-label="辅助色" />
                </Field>
                <Field label="按钮色">
                  <input type="color" value={draft.accent} onChange={(e) => livePreview({ ...draft, accent: e.target.value })} aria-label="按钮色" />
                </Field>
              </div>
              <Field label={`圆角 ${draft.radius}px`}>
                <input type="range" min={0} max={20} step={1} value={draft.radius} onChange={(e) => livePreview({ ...draft, radius: Number(e.target.value) })} aria-label="圆角大小" />
              </Field>
              <Field label={`阴影强度 ${['关', '标准', '强'][draft.shadow] ?? '标准'}`}>
                <input type="range" min={0} max={2} step={1} value={draft.shadow} onChange={(e) => livePreview({ ...draft, shadow: Number(e.target.value) })} aria-label="阴影强度" />
              </Field>
              <Field label={`卡片不透明度 ${Math.round(draft.opacity * 100)}%`}>
                <input type="range" min={0.5} max={1} step={0.05} value={draft.opacity} onChange={(e) => livePreview({ ...draft, opacity: Number(e.target.value) })} aria-label="卡片不透明度" />
              </Field>
              <label className="check-row">
                <input type="checkbox" checked={draft.dark} onChange={(e) => livePreview({ ...draft, dark: e.target.checked })} />
                深色护眼模式(深色底 + 浅色文字)
              </label>

              <div className="skin-upload">
                <b>上传界面皮肤图片</b>
                <ul className="skin-rules">
                  <li>支持格式:{SKIN_IMAGE_RULES.typeText}</li>
                  <li>建议尺寸:{SKIN_IMAGE_RULES.suggestSizeText}(小于该尺寸会拉伸模糊)</li>
                  <li>建议比例:{SKIN_IMAGE_RULES.suggestRatio}</li>
                  <li>文件大小:不超过 {SKIN_IMAGE_RULES.maxSizeText}</li>
                  <li>适合的界面模块:登录页背景、首页 Banner、侧边栏背景、学习页面背景、个人中心背景</li>
                </ul>
                {draft.bgImage ? (
                  <div className="skin-bg-preview">
                    <img src={draft.bgImage} alt="皮肤背景图预览" />
                    <button className="btn btn-sm btn-danger-soft" onClick={() => livePreview({ ...draft, bgImage: undefined })}>
                      <Icon name="trash" size={13} /> 移除图片
                    </button>
                  </div>
                ) : (
                  <button className="btn" disabled={imgBusy} onClick={() => fileRef.current?.click()}>
                    <Icon name="image" size={15} /> {imgBusy ? '处理中…' : '选择图片并自动取色'}
                  </button>
                )}
                {draft.bgImage && (
                  <>
                    <p className="muted" style={{ margin: '6px 0 4px' }}>
                      勾选背景图应用到的模块(不勾选 = 全局背景):
                    </p>
                    <div className="skin-modules">
                      {(Object.keys(SKIN_MODULE_TEXT) as SkinModule[]).map((m) => (
                        <label key={m} className={`chip chip-${(draft.bgModules ?? []).includes(m) ? 'blue' : 'gray'}`}>
                          <input
                            type="checkbox"
                            checked={(draft.bgModules ?? []).includes(m)}
                            onChange={() => toggleModule(m)}
                            aria-label={`背景应用到${SKIN_MODULE_TEXT[m]}`}
                          />
                          {SKIN_MODULE_TEXT[m]}
                        </label>
                      ))}
                    </div>
                  </>
                )}
                <p className="muted" style={{ marginTop: 6 }}>
                  上传后自动提取图片主色 / 辅助色 / 强调色并生成配色,同时按对比度自动调整文字、按钮与背景透明度;效果不满意可手动改回来。
                </p>
              </div>

              <div className="skin-actions">
                <button className="btn" onClick={() => { setDraft(null); applySkin(activeCustom, builtin, route) }}>
                  取消
                </button>
                <button className="btn btn-primary" onClick={() => void saveSkin()}>
                  <Icon name="check" size={14} /> 保存并应用
                </button>
              </div>
            </div>
          </div>
        )}
      </section>

      <Modal open={!!renameTarget} title="重命名皮肤" onClose={() => setRenameTarget(null)} width={360}>
        <Field label="新名称">
          <input value={renameText} onChange={(e) => setRenameText(e.target.value)} maxLength={20} autoFocus />
        </Field>
        <div className="modal-actions">
          <button className="btn" onClick={() => setRenameTarget(null)}>
            取消
          </button>
          <button
            className="btn btn-primary"
            onClick={() => {
              const name = renameText.trim()
              if (!name) {
                toast('名称不能为空', { kind: 'error' })
                return
              }
              if (renameTarget) {
                dispatch({ type: 'SKIN_SAVE', skin: { ...renameTarget, name, updatedAt: new Date().toISOString() } })
                toast('已重命名', { kind: 'success' })
              }
              setRenameTarget(null)
            }}
          >
            保存
          </button>
        </div>
      </Modal>
    </div>
  )
}
