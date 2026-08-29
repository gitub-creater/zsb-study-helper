// 智慧树:原神动漫风格,每科目一棵,学习进度 = 养料
// 生长阶段:种子 → 破土 → 嫩芽 → 小树 → 茂盛 → 开花 → 智慧果满枝
import React from 'react'

export interface TreeStage {
  stage: number
  label: string
}

export function getTreeStage(progress: number): TreeStage {
  if (progress <= 0) return { stage: 0, label: '沉睡的种子' }
  if (progress < 15) return { stage: 1, label: '刚破土' }
  if (progress < 30) return { stage: 2, label: '嫩芽' }
  if (progress < 50) return { stage: 3, label: '小树' }
  if (progress < 70) return { stage: 4, label: '枝繁叶茂' }
  if (progress < 90) return { stage: 5, label: '智慧花开' }
  return { stage: 6, label: '智慧果满枝' }
}

export function WisdomTreeSVG({
  stage,
  color,
  size = 100,
  label,
  sub,
}: {
  stage: number
  color: string
  size?: number
  label: string
  sub?: string
}) {
  const s = size / 100
  const cx = 60
  const baseY = 150

  // 颜色系统(原神风:清新高饱和+柔和光效)
  const trunkC = stage >= 4 ? '#7A5C3E' : stage >= 2 ? '#9E7E5E' : '#B8A07A'
  const trunkDark = stage >= 4 ? '#5C4030' : '#7A6045'
  const leafMain = stage >= 5 ? '#4CC94C' : stage >= 4 ? '#5DBB63' : stage >= 3 ? '#7DC87D' : '#8FCC8F'
  const leafLight = stage >= 5 ? '#6DD86D' : '#9FD89F'
  const leafDark = stage >= 4 ? '#3D9E4D' : '#5DAA5D'
  const glow = color + '33'

  return (
    <div style={{ width: size + 20, textAlign: 'center', position: 'relative' }}>
      <svg width={size + 20} height={size * 1.7} viewBox="0 0 120 170">
        <defs>
          <radialGradient id={`glow-${label}`} cx="0.5" cy="0.5" r="0.5">
            <stop offset="0%" stopColor={color} stopOpacity="0.15" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </radialGradient>
          <linearGradient id={`trunk-${label}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={trunkC} />
            <stop offset="100%" stopColor={trunkDark} />
          </linearGradient>
          <radialGradient id={`leaf-${label}`} cx="0.35" cy="0.35" r="0.65">
            <stop offset="0%" stopColor={leafLight} />
            <stop offset="100%" stopColor={leafDark} />
          </radialGradient>
          <radialGradient id={`fruit-${label}`} cx="0.35" cy="0.35" r="0.65">
            <stop offset="0%" stopColor="#FFF8DC" />
            <stop offset="60%" stopColor="#FFD700" />
            <stop offset="100%" stopColor="#DAA520" />
          </radialGradient>
          <filter id={`blur-${label}`}>
            <feGaussianBlur stdDeviation="2" />
          </filter>
        </defs>

        {/* 发光底座(游戏风光效) */}
        {stage >= 3 && (
          <circle cx={cx} cy={baseY + 5} r={35 * s} fill={`url(#glow-${label})`}>
            <animate attributeName="r" values={`${33 * s};${37 * s};${33 * s}`} dur="4s" repeatCount="indefinite" />
          </circle>
        )}

        {/* 草地台座 */}
        <ellipse cx={cx} cy={baseY + 5} rx={35 * s} ry={9 * s} fill="#7CB87C" opacity={0.4} />
        <ellipse cx={cx} cy={baseY + 4} rx={28 * s} ry={7 * s} fill="#8FC88F" opacity={0.5} />

        {/* 草丛 */}
        {stage >= 1 &&
          [-20, -12, 8, 18].map((dx, i) => (
            <path
              key={'g' + i}
              d={`M${cx + dx * s} ${baseY + 2} q ${2 * s} ${-6 * s} ${4 * s} 0 q ${2 * s} ${-5 * s} ${3 * s} 0`}
              stroke="#6BAA6B"
              strokeWidth={1.2 * s}
              fill="none"
              opacity={0.6}
            />
          ))}

        {/* 阶段 0:种子(发光的蛋) */}
        {stage === 0 && (
          <g>
            <ellipse cx={cx} cy={baseY - 8} rx={8 * s} ry={11 * s} fill="#8B6914" stroke="#6B4E10" strokeWidth={1.2} />
            <ellipse cx={cx - 2 * s} cy={baseY - 11} rx={2.5 * s} ry={3.5 * s} fill="#A67B2E" opacity={0.5} />
            {/* 种子上的纹路 */}
            <path d={`M${cx - 5 * s} ${baseY - 4} Q ${cx} ${baseY - 10} ${cx + 5 * s} ${baseY - 4}`} stroke="#6B4E10" strokeWidth={0.8} fill="none" opacity={0.4} />
            {/* 微光粒子 */}
            <circle cx={cx - 6 * s} cy={baseY - 16} r={1.5 * s} fill={color} opacity={0.5}>
              <animate attributeName="opacity" values="0;0.6;0" dur="3s" repeatCount="indefinite" />
            </circle>
            <circle cx={cx + 7 * s} cy={baseY - 12} r={1 * s} fill="#FFE4B5" opacity={0.4}>
              <animate attributeName="opacity" values="0;0.5;0" dur="2.5s" begin="1s" repeatCount="indefinite" />
            </circle>
          </g>
        )}

        {/* 阶段 1:破土嫩芽 */}
        {stage >= 1 && (
          <g>
            <path
              d={`M${cx} ${baseY - 2} Q ${cx - 1 * s} ${baseY - 14 * s} ${cx} ${baseY - 20 * s}`}
              stroke="#5FA85F"
              strokeWidth={3 * s}
              fill="none"
              strokeLinecap="round"
            />
            {/* 两片子叶 */}
            <ellipse
              cx={cx - 7 * s}
              cy={baseY - 22 * s}
              rx={6 * s}
              ry={3 * s}
              fill="#6DBE6D"
              transform={`rotate(-35 ${cx - 7 * s} ${baseY - 22 * s})`}
            />
            <ellipse
              cx={cx + 7 * s}
              cy={baseY - 20 * s}
              rx={5 * s}
              ry={2.5 * s}
              fill="#8FCC8F"
              transform={`rotate(30 ${cx + 7 * s} ${baseY - 20 * s})`}
            />
            {/* 露珠 */}
            <circle cx={cx - 6 * s} cy={baseY - 23 * s} r={1.2 * s} fill="#E0F0FF" opacity={0.8} />
          </g>
        )}

        {/* 阶段 2+:树干 */}
        {stage >= 2 && (
          <g>
            {/* 主干 - 有弯曲和粗细变化 */}
            <path
              d={`M${cx - 3 * s} ${baseY} Q ${cx - 2 * s} ${baseY - 20 * s} ${cx - 1 * s} ${baseY - 30 * s} Q ${cx} ${baseY - 40 * s} ${cx + 1 * s} ${baseY - 35 * s} L ${cx + 2 * s} ${baseY} Z`}
              fill={`url(#trunk-${label})`}
              stroke={trunkDark}
              strokeWidth={0.8}
            />
            {/* 树干纹理 */}
            {stage >= 3 && (
              <>
                <line x1={cx - 1 * s} y1={baseY - 8 * s} x2={cx + 1 * s} y2={baseY - 8 * s} stroke={trunkDark} strokeWidth={0.5} opacity={0.4} />
                <line x1={cx - 1.5 * s} y1={baseY - 18 * s} x2={cx + 0.5 * s} y2={baseY - 18 * s} stroke={trunkDark} strokeWidth={0.5} opacity={0.3} />
              </>
            )}
            {/* 分支 */}
            {stage >= 3 && (
              <>
                <path d={`M${cx} ${baseY - 28 * s} Q ${cx - 10 * s} ${baseY - 38 * s} ${cx - 16 * s} ${baseY - 42 * s}`} stroke={trunkC} strokeWidth={2.5 * s} fill="none" strokeLinecap="round" />
                <path d={`M${cx + 1 * s} ${baseY - 30 * s} Q ${cx + 10 * s} ${baseY - 40 * s} ${cx + 16 * s} ${baseY - 44 * s}`} stroke={trunkC} strokeWidth={2.5 * s} fill="none" strokeLinecap="round" />
              </>
            )}
            {stage >= 4 && (
              <>
                <path d={`M${cx} ${baseY - 32 * s} Q ${cx - 5 * s} ${baseY - 50 * s} ${cx - 2 * s} ${baseY - 58 * s}`} stroke={trunkC} strokeWidth={2 * s} fill="none" strokeLinecap="round" />
                <path d={`M${cx + 1 * s} ${baseY - 34 * s} Q ${cx + 5 * s} ${baseY - 50 * s} ${cx + 3 * s} ${baseY - 58 * s}`} stroke={trunkC} strokeWidth={2 * s} fill="none" strokeLinecap="round" />
              </>
            )}
          </g>
        )}

        {/* 阶段 3+:树冠(多层叶片+原神风渐变) */}
        {stage >= 3 && (
          <g>
            {/* 后层暗叶 */}
            {stage >= 4 && (
              <>
                <circle cx={cx - 18 * s} cy={baseY - 50 * s} r={14 * s} fill={leafDark} opacity={0.5} />
                <circle cx={cx + 18 * s} cy={baseY - 52 * s} r={15 * s} fill={leafDark} opacity={0.5} />
                <circle cx={cx} cy={baseY - 65 * s} r={18 * s} fill={leafDark} opacity={0.4} />
              </>
            )}
            {/* 主叶团 */}
            <circle cx={cx - 16 * s} cy={baseY - 48 * s} r={13 * s} fill={`url(#leaf-${label})`} />
            <circle cx={cx + 16 * s} cy={baseY - 50 * s} r={14 * s} fill={`url(#leaf-${label})`} />
            {stage >= 4 && (
              <>
                <circle cx={cx} cy={baseY - 62 * s} r={18 * s} fill={`url(#leaf-${label})`} />
                <circle cx={cx - 8 * s} cy={baseY - 58 * s} r={12 * s} fill={leafLight} opacity={0.6} />
                <circle cx={cx + 10 * s} cy={baseY - 60 * s} r={12 * s} fill={leafLight} opacity={0.5} />
              </>
            )}
            {/* 顶叶 */}
            <circle cx={cx} cy={baseY - 55 * s} r={10 * s} fill={leafLight} opacity={0.7} />
          </g>
        )}

        {/* 阶段 5:花朵 */}
        {stage >= 5 && (
          <g>
            {[
              { x: cx - 12 * s, y: baseY - 55 * s },
              { x: cx + 10 * s, y: baseY - 58 * s },
              { x: cx - 2 * s, y: baseY - 65 * s },
              { x: cx + 16 * s, y: baseY - 48 * s },
              { x: cx - 20 * s, y: baseY - 46 * s },
              { x: cx + 4 * s, y: baseY - 52 * s },
            ].map((f, i) => (
              <g key={'fl' + i}>
                {[...Array(5)].map((_, j) => {
                  const ang = (j / 5) * Math.PI * 2
                  return (
                    <ellipse
                      key={'p' + j}
                      cx={f.x + Math.cos(ang) * 2.5 * s}
                      cy={f.y + Math.sin(ang) * 2.5 * s}
                      rx={1.8 * s}
                      ry={1.2 * s}
                      fill="#FFB6C1"
                      transform={`rotate(${(j / 5) * 360} ${f.x + Math.cos(ang) * 2.5 * s} ${f.y + Math.sin(ang) * 2.5 * s})`}
                    />
                  )
                })}
                <circle cx={f.x} cy={f.y} r={1.5 * s} fill="#FFD700" />
              </g>
            ))}
          </g>
        )}

        {/* 阶段 6:智慧果(发光金色果实) */}
        {stage >= 6 && (
          <g>
            {[
              { x: cx - 18 * s, y: baseY - 50 * s, r: 5 * s },
              { x: cx + 14 * s, y: baseY - 55 * s, r: 5.5 * s },
              { x: cx - 2 * s, y: baseY - 62 * s, r: 5 * s },
              { x: cx + 20 * s, y: baseY - 46 * s, r: 4.5 * s },
              { x: cx - 22 * s, y: baseY - 44 * s, r: 4 * s },
              { x: cx + 2 * s, y: baseY - 50 * s, r: 4.5 * s },
              { x: cx - 8 * s, y: baseY - 58 * s, r: 4 * s },
            ].map((f, i) => (
              <g key={'fr' + i}>
                <circle cx={f.x} cy={f.y} r={f.r + 3 * s} fill="#FFD700" opacity={0.15}>
                  <animate attributeName="opacity" values="0.1;0.25;0.1" dur={`${2 + i * 0.3}s`} repeatCount="indefinite" />
                </circle>
                <circle cx={f.x} cy={f.y} r={f.r} fill={`url(#fruit-${label})`} stroke="#DAA520" strokeWidth={0.8} />
                <circle cx={f.x - f.r * 0.3} cy={f.y - f.r * 0.3} r={f.r * 0.25} fill="#FFF" opacity={0.7} />
              </g>
            ))}
            {/* 顶部星星 */}
            <text
              x={cx}
              y={baseY - 75 * s}
              textAnchor="middle"
              fontSize={12 * s}
              fill="#FFD700"
              fontWeight="bold"
            >
              ✦
              <animate attributeName="opacity" values="0.5;1;0.5" dur="2s" repeatCount="indefinite" />
            </text>
          </g>
        )}

        {/* 魔法粒子(阶段4+出现) */}
        {stage >= 4 &&
          [...Array(6)].map((_, i) => {
            const px = cx + ((i * 37) % 60 - 30) * s
            const py = baseY - 30 - ((i * 23) % 40) * s
            return (
              <circle
                key={'mp' + i}
                cx={px}
                cy={py}
                r={1.2 * s}
                fill={i % 2 === 0 ? '#FFE4B5' : color}
                opacity={0.5}
              >
                <animate
                  attributeName="cy"
                  values={`${py};${py - 15 * s};${py}`}
                  dur={`${2.5 + (i % 3)}s`}
                  repeatCount="indefinite"
                />
                <animate
                  attributeName="opacity"
                  values="0;0.7;0"
                  dur={`${2.5 + (i % 3)}s`}
                  repeatCount="indefinite"
                />
              </circle>
            )
          })}

        {/* 标签 */}
        <text x={cx} y={baseY + 18 * s} textAnchor="middle" fontSize={10} fontWeight="700" fill="#3D4B5E">
          {label}
        </text>
        {sub && (
          <text x={cx} y={baseY + 28 * s} textAnchor="middle" fontSize={8} fill="#8792A0">
            {sub}
          </text>
        )}
      </svg>
    </div>
  )
}
