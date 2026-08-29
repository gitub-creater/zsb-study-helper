// 原创学习吉祥物「芽芽」:一颗戴学士帽的豆芽
// 四种状态:idle 待机 / think 思考 / happy 庆祝 / remind 提醒
import React from 'react'

export type MascotMood = 'idle' | 'think' | 'happy' | 'remind'

export function Mascot({
  mood = 'idle',
  size = 72,
  bubble,
}: {
  mood?: MascotMood
  size?: number
  bubble?: string
}) {
  return (
    <span className="mascot-wrap" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox="0 0 120 110" role="img" aria-label="学习吉祥物芽芽">
        <g className={mood === 'idle' || mood === 'remind' ? 'm-float' : undefined}>
          {/* 学士帽 */}
          <path d="M60 4 96 18 60 32 24 18Z" fill="#2B3A55" />
          <path d="M44 24v7c0 3.6 7 6.5 16 6.5s16-2.9 16-6.5v-7" fill="#22314A" />
          <circle cx="60" cy="4" r="3" fill="#FFD34D" />
          <path d="M96 18v13" stroke="#FFD34D" strokeWidth="2.5" strokeLinecap="round" />
          <circle cx="96" cy="33.5" r="3" fill="#FFD34D" />
          {/* 身体 */}
          <path d="M60 30c-22 0-35 14-35 33s15 35 35 35 35-16 35-35-13-33-35-33z" fill="#8FE3C8" />
          <ellipse cx="60" cy="93" rx="27" ry="8" fill="#79D5B9" />
          <ellipse cx="47" cy="100" rx="8" ry="4" fill="#6BC9AC" />
          <ellipse cx="73" cy="100" rx="8" ry="4" fill="#6BC9AC" />
          {/* 腮红 */}
          <ellipse cx="40" cy="72" rx="5" ry="3.5" fill="#FFB1B1" opacity="0.8" />
          <ellipse cx="80" cy="72" rx="5" ry="3.5" fill="#FFB1B1" opacity="0.8" />
          {/* 眼睛与嘴 */}
          {mood === 'happy' ? (
            <>
              <path d="M42 65q5.5-7 11 0" stroke="#26313E" strokeWidth="3" fill="none" strokeLinecap="round" />
              <path d="M67 65q5.5-7 11 0" stroke="#26313E" strokeWidth="3" fill="none" strokeLinecap="round" />
              <path d="M51 72q9 10 18 0" stroke="#26313E" strokeWidth="3" fill="none" strokeLinecap="round" />
            </>
          ) : mood === 'think' ? (
            <>
              <circle cx="47" cy="61" r="3.4" fill="#26313E" className="m-eye" />
              <circle cx="73" cy="61" r="3.4" fill="#26313E" className="m-eye" />
              <circle cx="48.4" cy="59.8" r="1.1" fill="#fff" />
              <circle cx="74.4" cy="59.8" r="1.1" fill="#fff" />
              <circle cx="61" cy="75" r="2.6" fill="#26313E" />
              <path d="M87 44q4.5 6.5 0 10-4.5-3.5 0-10z" fill="#7EC8FF" />
              <circle cx="92" cy="27" r="2.4" fill="#9BB3CC" />
              <circle cx="99" cy="21" r="3" fill="#9BB3CC" />
              <circle cx="107" cy="14" r="3.6" fill="#9BB3CC" />
            </>
          ) : (
            <>
              <circle cx="47" cy="64" r="3.6" fill="#26313E" className="m-eye" />
              <circle cx="73" cy="64" r="3.6" fill="#26313E" className="m-eye" />
              <circle cx="48.4" cy="62.6" r="1.2" fill="#fff" />
              <circle cx="74.4" cy="62.6" r="1.2" fill="#fff" />
              <path d="M55 74q5 4.5 10 0" stroke="#26313E" strokeWidth="2.6" fill="none" strokeLinecap="round" />
            </>
          )}
          {/* remind:举小旗 */}
          {mood === 'remind' && (
            <g>
              <path d="M92 56v20" stroke="#8A6A3A" strokeWidth="3" strokeLinecap="round" />
              <path d="M92 56l16-5-1.5 11z" fill="#FF8A7A" />
            </g>
          )}
        </g>
      </svg>
      {bubble && <span className="mascot-bubble">{bubble}</span>}
    </span>
  )
}
