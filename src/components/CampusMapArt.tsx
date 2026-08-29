// 校园地图:原神风格动漫场景,含教学楼、路径、智慧树、粒子、灯光等游戏元素
import React from 'react'
import type { Subject, State } from '../types'
import { subjectInLibrary } from '../lib/selectors'
import { getMastery, subjectMastery } from '../lib/selectors'

interface BuildingVisual {
  x: number
  w: number
  bodyColor: string
  roofColor: string
  accentColor: string
  roofType: 'tower' | 'dome' | 'arch' | 'gable'
  windows: 'warm' | 'cool' | 'dark'
}

function getBuildingVisual(stColor: string, idx: number): BuildingVisual {
  const roofs: BuildingVisual['roofType'][] = ['tower', 'dome', 'arch', 'gable']
  const palettes = [
    { body: '#E8D5B7', roof: '#8B6914', accent: '#DAA520' },
    { body: '#D6E4F0', roof: '#4A7FA5', accent: '#5B9BD5' },
    { body: '#E8E0D0', roof: '#8B7355', accent: '#C4A882' },
    { body: '#F0DDD6', roof: '#A0522D', accent: '#D2691E' },
    { body: '#E0E8D8', roof: '#556B2F', accent: '#8FBC8F' },
    { body: '#E6E0F0', roof: '#6A5ACD', accent: '#9370DB' },
    { body: '#F5E6E0', roof: '#BC8F8F', accent: '#DEB887' },
  ]
  const warm = stColor === '#5FCB9F' || stColor === '#7EB9FF'
  return {
    x: 0, w: 90,
    bodyColor: palettes[idx % palettes.length].body,
    roofColor: palettes[idx % palettes.length].roof,
    accentColor: palettes[idx % palettes.length].accent,
    roofType: roofs[idx % roofs.length],
    windows: warm ? 'warm' : 'cool',
  }
}

export function CampusMapArt({
  onPick,
  showAll,
  state,
}: {
  onPick: (subjectId: string) => void
  showAll: boolean
  state: State
}) {
  const subjects = [...state.subjects]
    .sort((a, b) => a.order - b.order)
    .filter((s) => showAll || subjectInLibrary(state, s))

  const w = Math.max(720, subjects.length * 170 + 120)
  const groundY = 210

  const buildingStatus = (sid: string): { color: string; label: string; flag?: 'red' | 'yellow' } => {
    const m = subjectMastery(state, sid)
    const kpsOf = state.kps.filter((k) => k.subjectId === sid)
    if (kpsOf.length === 0 || m == null) return { color: '#C6CFDA', label: '未开始' }
    const hasWeak = kpsOf.some((k) => {
      const km = getMastery(state, k)
      return km != null && km < 40
    })
    const hasReview = kpsOf.some((k) => k.status === 'toReview')
    if (hasWeak) return { color: '#F08A7E', label: '有薄弱点', flag: 'red' }
    if (m >= 80) return { color: '#5FCB9F', label: '基本攻克', flag: hasReview ? 'yellow' : undefined }
    if (m >= 60) return { color: '#FFC96B', label: '巩固中', flag: hasReview ? 'yellow' : undefined }
    return { color: '#7EB9FF', label: '推进中' }
  }

  return (
    <div className="campus" style={{ padding: 0, overflow: 'hidden', border: '2px solid var(--primary-soft)', borderRadius: 12 }}>
      <svg viewBox={`0 0 ${w} 340`} style={{ width: '100%', display: 'block' }} role="img" aria-label="知识校园地图">
        <defs>
          {/* 天空渐变 */}
          <linearGradient id="skyGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#87CEEB" />
            <stop offset="40%" stopColor="#B0D4F1" />
            <stop offset="100%" stopColor="#E8F4FD" />
          </linearGradient>
          {/* 远山渐变 */}
          <linearGradient id="mountainGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#9DB8D4" />
            <stop offset="100%" stopColor="#C5D8E8" />
          </linearGradient>
          <linearGradient id="mountainGrad2" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#B8CCE0" />
            <stop offset="100%" stopColor="#D8E8F4" />
          </linearGradient>
          {/* 草地渐变 */}
          <linearGradient id="grassGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#7CB87C" />
            <stop offset="100%" stopColor="#5DA85D" />
          </linearGradient>
          <linearGradient id="pathGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#D4C4A0" />
            <stop offset="100%" stopColor="#C4B490" />
          </linearGradient>
          {/* 建筑体渐变 */}
          <linearGradient id="bldgGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#FFF8F0" />
            <stop offset="100%" stopColor="#F0E4D8" />
          </linearGradient>
          {/* 屋顶渐变 */}
          <linearGradient id="roofGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#6B4E8E" />
            <stop offset="100%" stopColor="#4A3570" />
          </linearGradient>
          <linearGradient id="roofGradBlue" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#4A7FA5" />
            <stop offset="100%" stopColor="#2E5A80" />
          </linearGradient>
          <radialGradient id="windowGlow" cx="0.5" cy="0.5" r="0.5">
            <stop offset="0%" stopColor="#FFE4B5" />
            <stop offset="100%" stopColor="#FFD700" stopOpacity="0.3" />
          </radialGradient>
          <radialGradient id="sunGlow" cx="0.5" cy="0.5" r="0.5">
            <stop offset="0%" stopColor="#FFF8DC" />
            <stop offset="60%" stopColor="#FFE4B5" stopOpacity="0.6" />
            <stop offset="100%" stopColor="#FFE4B5" stopOpacity="0" />
          </radialGradient>
          <filter id="softShadow" x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="0" dy="3" stdDeviation="3" floodOpacity="0.15" />
          </filter>
          <filter id="buildingShadow" x="-10%" y="-10%" width="120%" height="130%">
            <feDropShadow dx="0" dy="4" stdDeviation="4" floodOpacity="0.2" />
          </filter>
        </defs>

        {/* 天空 */}
        <rect x="0" y="0" width={w} height={groundY + 40} fill="url(#skyGrad)" />

        {/* 太阳 */}
        <circle cx={w - 80} cy={45} r={45} fill="url(#sunGlow)" />
        <circle cx={w - 80} cy={45} r={18} fill="#FFF8DC" opacity={0.95} />

        {/* 远山层1 */}
        <path
          d={`M0 ${groundY - 80} Q ${w * 0.1} ${groundY - 130} ${w * 0.2} ${groundY - 90} Q ${w * 0.35} ${groundY - 140} ${w * 0.5} ${groundY - 85} Q ${w * 0.65} ${groundY - 125} ${w * 0.8} ${groundY - 80} Q ${w * 0.92} ${groundY - 110} ${w} ${groundY - 75} L ${w} ${groundY} L 0 ${groundY} Z`}
          fill="url(#mountainGrad)"
          opacity={0.5}
        />
        {/* 远山层2 */}
        <path
          d={`M0 ${groundY - 50} Q ${w * 0.15} ${groundY - 95} ${w * 0.3} ${groundY - 55} Q ${w * 0.5} ${groundY - 100} ${w * 0.7} ${groundY - 50} Q ${w * 0.85} ${groundY - 85} ${w} ${groundY - 45} L ${w} ${groundY} L 0 ${groundY} Z`}
          fill="url(#mountainGrad2)"
          opacity={0.65}
        />

        {/* 云朵 */}
        {[
          { x: w * 0.1, y: 35, s: 1 },
          { x: w * 0.35, y: 20, s: 0.7 },
          { x: w * 0.55, y: 40, s: 1.2 },
          { x: w * 0.78, y: 25, s: 0.8 },
        ].map((c, i) => (
          <g key={'cloud' + i} opacity={0.75} transform={`translate(${c.x},${c.y}) scale(${c.s})`}>
            <ellipse cx="0" cy="0" rx="28" ry="12" fill="#FFF" />
            <ellipse cx="-14" cy="4" rx="18" ry="9" fill="#FFF" />
            <ellipse cx="14" cy="3" rx="20" ry="10" fill="#F8F8FF" />
          </g>
        ))}

        {/* 中景地平线树剪影 */}
        <g opacity={0.35}>
          {[...Array(Math.floor(w / 60))].map((_, i) => {
            const tx = i * 60 + 20
            const ty = groundY - 10
            return (
              <g key={'tree' + i}>
                <ellipse cx={tx} cy={ty - 15} rx={12} ry={18} fill="#5B8A5B" />
                <rect x={tx - 1.5} y={ty - 3} width={3} height={8} fill="#4A6B4A" />
              </g>
            )
          })}
        </g>

        {/* 草地 */}
        <rect x="0" y={groundY} width={w} height={130} fill="url(#grassGrad)" />
        {/* 草地纹理 */}
        {[...Array(Math.floor(w / 30))].map((_, i) => {
          const gx = i * 30 + (i % 3) * 8
          const gy = groundY + 15 + (i % 5) * 22
          return (
            <path key={'g' + i} d={`M${gx} ${gy} q 2 -5 4 0 q 2 -5 4 0`} stroke="#6BAA6B" strokeWidth="1" fill="none" opacity={0.4} />
          )
        })}

        {/* 石板路 */}
        <path
          d={`M${w * 0.05} ${groundY + 70} Q ${w * 0.3} ${groundY + 40} ${w * 0.5} ${groundY + 55} Q ${w * 0.7} ${groundY + 70} ${w * 0.95} ${groundY + 45}`}
          stroke="url(#pathGrad)"
          strokeWidth={24}
          fill="none"
          strokeLinecap="round"
        />
        {/* 路面石纹 */}
        {[...Array(Math.floor(w / 45))].map((_, i) => {
          const px = w * 0.05 + i * (w * 0.9 / Math.floor(w / 45)) + 10
          const py = groundY + 65 - Math.sin(i * 0.8) * 12
          return <ellipse key={'p' + i} cx={px} cy={py} rx={5} ry={3} fill="#C4B490" opacity={0.5} />
        })}

        {/* 教学楼 */}
        {subjects.map((s, i) => {
          const bx = 60 + i * (w - 120) / Math.max(subjects.length - 1, 1) - 45
          const st = buildingStatus(s.id)
          const vis = getBuildingVisual(st.color, i)
          const bw = 90
          const bh = 100
          const by = groundY - bh - 15

          return (
            <g
              key={s.id}
              className="building"
              onClick={() => onPick(s.id)}
              role="button"
              aria-label={`进入${s.name}`}
              style={{ cursor: 'pointer' }}
              filter="url(#buildingShadow)"
            >
              {/* 底座 */}
              <rect x={bx - 6} y={by + bh} width={bw + 12} height={8} rx={2} fill="var(--line-strong, #C4B490)" opacity={0.6} />

              {/* 建筑主体 */}
              <rect x={bx} y={by + 15} width={bw} height={bh - 15} rx={3} fill="url(#bldgGrad)" stroke="var(--line-strong, #C4B490)" strokeWidth={1} />

              {/* 屋顶 - 根据类型变化 */}
              {vis.roofType === 'tower' && (
                <>
                  <path d={`M${bx - 5} ${by + 18} L ${bx + bw / 2} ${by - 18} L ${bx + bw + 5} ${by + 18} Z`} fill="url(#roofGrad)" />
                  <rect x={bx + bw / 2 - 2} y={by - 26} width={4} height={10} fill={vis.accentColor} />
                  <circle cx={bx + bw / 2} cy={by - 28} r={3} fill="#FFD700" />
                </>
              )}
              {vis.roofType === 'dome' && (
                <>
                  <path d={`M${bx - 3} ${by + 18} Q ${bx + bw / 2} ${by - 22} ${bx + bw + 3} ${by + 18} Z`} fill="url(#roofGradBlue)" />
                  <circle cx={bx + bw / 2} cy={by - 20} r={4} fill={vis.accentColor} />
                </>
              )}
              {vis.roofType === 'arch' && (
                <>
                  <path d={`M${bx - 3} ${by + 18} Q ${bx + bw / 2} ${by - 16} ${bx + bw + 3} ${by + 18} L ${bx + bw} ${by + 18} L ${bx} ${by + 18} Z`} fill="url(#roofGrad)" />
                  <rect x={bx + bw / 2 - 8} y={by - 6} width={16} height={6} rx={2} fill={vis.accentColor} />
                </>
              )}
              {vis.roofType === 'gable' && (
                <>
                  <path d={`M${bx - 5} ${by + 18} L ${bx + 20} ${by - 12} L ${bx + bw / 2} ${by + 2} L ${bx + bw - 20} ${by - 12} L ${bx + bw + 5} ${by + 18} Z`} fill="url(#roofGradBlue)" />
                </>
              )}

              {/* 窗户 - 发光 */}
              {[0, 1, 2].map((r) =>
                [0, 1].map((c) => {
                  const wx = bx + 16 + c * 32
                  const wy = by + 28 + r * 26
                  const isLit = (r + c + i) % 3 !== 2
                  return (
                    <g key={`win${r}${c}`}>
                      {isLit && <circle cx={wx + 6} cy={wy + 7} r={9} fill="url(#windowGlow)" opacity={0.5} />}
                      <rect x={wx} y={wy} width={12} height={14} rx={2} fill={isLit ? '#FFE4B5' : '#B8C8D8'} stroke="#8B7355" strokeWidth={0.8} />
                      <line x1={wx + 6} y1={wy} x2={wx + 6} y2={wy + 14} stroke="#8B7355" strokeWidth={0.5} />
                    </g>
                  )
                })
              )}

              {/* 门 */}
              <rect x={bx + bw / 2 - 9} y={by + bh - 25} width={18} height={25} rx={2} fill="#8B6914" />
              <circle cx={bx + bw / 2 + 4} cy={by + bh - 12} r={1.5} fill="#FFD700" />

              {/* 旗帜 */}
              <g>
                <line x1={bx + bw - 8} y1={by - 10} x2={bx + bw - 8} y2={by - 35} stroke="#8B7355" strokeWidth={1.5} />
                <path d={`M${bx + bw - 8} ${by - 35} L ${bx + bw + 10} ${by - 30} L ${bx + bw - 8} ${by - 25} Z`} fill={s.color} />
              </g>

              {/* 科目颜色徽章 */}
              <circle cx={bx + 10} cy={by + 10} r={5} fill={s.color} stroke="#fff" strokeWidth={1} />

              {/* 状态旗标 */}
              {st.flag === 'red' && (
                <g>
                  <path d={`M${bx + bw - 20} ${by - 5}v-14`} stroke="#C4A882" strokeWidth={2} strokeLinecap="round" />
                  <path d={`M${bx + bw - 20} ${by - 19}l10-3-1 8z`} fill="#FF6B5B" />
                </g>
              )}
              {st.flag === 'yellow' && <circle cx={bx + bw - 16} cy={by - 8} r={5} fill="#FFD34D" stroke="#E8A100" strokeWidth={1.5} />}

              {/* 名称牌 */}
              <rect x={bx + 5} y={by + bh + 10} width={bw - 10} height={16} rx={3} fill="#F5F0E0" stroke="#C4B490" strokeWidth={0.8} />
              <text x={bx + bw / 2} y={by + bh + 22} textAnchor="middle" fontSize={9.5} fontWeight="700" fill="#3D4B5E">
                {s.name}
              </text>
              <text x={bx + bw / 2} y={by + bh + 34} textAnchor="middle" fontSize={8} fill="#6C7A8C">
                {st.label}
              </text>
            </g>
          )
        })}

        {/* 装饰树 */}
        {subjects.length > 0 &&
          [0, 1].map((side) => {
            const dx = side === 0 ? 20 : w - 30
            const dy = groundY + 30
            return (
              <g key={'deco' + side}>
                <ellipse cx={dx} cy={dy + 5} rx={12} ry={4} fill="#5DA85D" opacity={0.3} />
                <rect x={dx - 2} y={dy - 12} width={4} height={14} fill="#8B6914" />
                <circle cx={dx} cy={dy - 18} r={10} fill="#5CB85C" />
                <circle cx={dx - 5} cy={dy - 14} r={7} fill="#7DC87D" />
                <circle cx={dx + 5} cy={dy - 14} r={7} fill="#6DBE6D" />
              </g>
            )
          })}

        {/* 灯柱 */}
        {subjects.length > 1 &&
          [0, 1].map((side) => {
            const lx = side === 0 ? w * 0.15 : w * 0.85
            const ly = groundY + 30
            return (
              <g key={'lamp' + side}>
                <rect x={lx - 1.5} y={ly - 22} width={3} height={22} fill="#4A5B74" />
                <circle cx={lx} cy={ly - 25} r={4} fill="#FFE4B5" />
                <circle cx={lx} cy={ly - 25} r={7} fill="url(#windowGlow)" opacity={0.4} />
              </g>
            )
          })}

        {/* 漂浮粒子 */}
        {[...Array(12)].map((_, i) => (
          <circle
            key={'pt' + i}
            cx={(i * 137.5) % w}
            cy={groundY - 30 - (i % 6) * 25}
            r={i % 3 === 0 ? 1.5 : 1}
            fill={i % 2 === 0 ? '#FFE4B5' : '#98FB98'}
            opacity={0.4 + (i % 3) * 0.15}
          >
            <animate attributeName="cy" values={`${groundY - 30 - (i % 6) * 25};${groundY - 45 - (i % 6) * 25};${groundY - 30 - (i % 6) * 25}`} dur={`${3 + (i % 4)}s`} repeatCount="indefinite" />
          </circle>
        ))}

        {/* 蝴蝶 */}
        <g transform={`translate(${w * 0.25}, ${groundY - 60})`} opacity={0.8}>
          <ellipse cx="-3" cy="0" rx="4" ry="2.5" fill="#FFB6C1" transform="rotate(-20)">
            <animateTransform attributeName="transform" type="rotate" values="-20;-35;-20" dur="0.4s" repeatCount="indefinite" />
          </ellipse>
          <ellipse cx="3" cy="0" rx="4" ry="2.5" fill="#FFB6C1" transform="rotate(20)">
            <animateTransform attributeName="transform" type="rotate" values="20;35;20" dur="0.4s" repeatCount="indefinite" />
          </ellipse>
          <rect x="-1" y="-2" width="2" height="5" rx={1} fill="#55616E" />
          <animateTransform attributeName="transform" type="translate" values={`${w * 0.25},${groundY - 60};${w * 0.35},${groundY - 75};${w * 0.25},${groundY - 60}`} dur="6s" repeatCount="indefinite" />
        </g>

        {/* 底部标签 */}
        <text x={w / 2} y={330} textAnchor="middle" fontSize={11} fill="#55616E" opacity={0.6}>
          知识校园 · 点击建筑进入科目学习
        </text>
      </svg>
    </div>
  )
}
