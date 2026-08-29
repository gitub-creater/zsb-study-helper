// 开场动画:首次进入时的欢迎画面,逐字出现+星光粒子+书本元素,2.5s后自动进入或点击跳过
import React, { useEffect, useState, useCallback } from 'react'
import { Mascot } from './Mascot'
import { Avatar } from './Avatar'
import { getSession } from '../lib/auth'

const LINE_1 = '少年，快来和我一起'
const LINE_2 = '开启一场升本学习之旅吧！'

export function Splash({ onFinish }: { onFinish: () => void }) {
  const [visible, setVisible] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const [charCount, setCharCount] = useState(0)
  const totalChars = LINE_1.length + LINE_2.length

  const finish = useCallback(() => {
    setLeaving(true)
    setTimeout(onFinish, 500)
  }, [onFinish])

  useEffect(() => {
    // 逐字出现
    const iv = window.setInterval(() => {
      setCharCount((c) => {
        if (c >= totalChars) {
          window.clearInterval(iv)
          return c
        }
        return c + 1
      })
    }, 55)

    // 2.8s后自动结束
    const timer = window.setTimeout(() => {
      finish()
    }, 2800)

    return () => {
      window.clearInterval(iv)
      window.clearTimeout(timer)
    }
  }, [totalChars, finish])

  const skip = () => {
    setCharCount(totalChars)
    finish()
  }

  const showLine1 = charCount <= LINE_1.length
  const line1Text = LINE_1.slice(0, charCount)
  const line2Text = charCount > LINE_1.length ? LINE_2.slice(0, charCount - LINE_1.length) : ''

  return (
    <div
      className={`splash ${leaving ? 'splash-leave' : ''}`}
      onClick={skip}
      style={{ cursor: 'pointer' }}
      role="button"
      aria-label="点击跳过开场动画"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') skip() }}
    >
      {/* 背景装饰 */}
      <div className="splash-bg">
        {/* 大圆光晕 */}
        <div className="splash-circle splash-circle-1" />
        <div className="splash-circle splash-circle-2" />
        <div className="splash-circle splash-circle-3" />
        {/* 书本 emoji 漂浮 */}
        <span className="splash-float splash-book-1">📖</span>
        <span className="splash-float splash-book-2">📚</span>
        <span className="splash-float splash-book-3">✏️</span>
        <span className="splash-float splash-star-1">✦</span>
        <span className="splash-float splash-star-2">✦</span>
        <span className="splash-float splash-star-3">✦</span>
        <span className="splash-float splash-star-4">✧</span>
        <span className="splash-float splash-star-5">✧</span>
      </div>

      {/* 主内容 */}
      <div className="splash-content">
        {/* 吉祥物 */}
        <div className="splash-mascot">
          <Mascot mood="happy" size={88} />
        </div>

        {/* 文案逐字 */}
        <div className="splash-text">
          <p className="splash-line">
            {showLine1 ? (
              line1Text.split('').map((c, i) => (
                <span
                  key={i}
                  className="splash-char"
                  style={{ animationDelay: `${i * 0.04}s` }}
                >
                  {c}
                </span>
              ))
            ) : (
              <span className="splash-char">{LINE_1}</span>
            )}
          </p>
          <p className="splash-line splash-line-2">
            {line2Text.split('').map((c, i) => (
              <span
                key={i}
                className="splash-char"
                style={{ animationDelay: `${(LINE_1.length + i) * 0.04}s` }}
              >
                {c}
              </span>
            ))}
          </p>
        </div>

        {/* 进度线 */}
        <div className="splash-progress">
          <div
            className="splash-progress-bar"
            style={{ width: `${Math.min((charCount / totalChars) * 100, 100)}%` }}
          />
        </div>

        {/* 跳过提示 */}
        <p className="splash-skip">点击任意处跳过</p>
      </div>
    </div>
  )
}
