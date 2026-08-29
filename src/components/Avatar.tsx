// 可爱头像:芽芽(豆芽)/ 团团(猫)/ 雪球(兔)/ 布丁(熊)
import React from 'react'
import type { AvatarKind } from '../types'

export function Avatar({
  kind,
  color,
  size = 40,
  ring,
}: {
  kind: AvatarKind
  color: string
  size?: number
  ring?: string
}) {
  const ears = () => {
    switch (kind) {
      case 'cat':
        return (
          <>
            <path d="M17 26 13 9l15 9z" fill={color} />
            <path d="M47 26 51 9l-15 9z" fill={color} />
            <path d="M19 22 17.5 14l7 4z" fill="#FFE3EE" />
            <path d="M45 22 46.5 14l-7 4z" fill="#FFE3EE" />
          </>
        )
      case 'rabbit':
        return (
          <>
            <ellipse cx="25" cy="12" rx="5.5" ry="12" fill={color} />
            <ellipse cx="39" cy="12" rx="5.5" ry="12" fill={color} />
            <ellipse cx="25" cy="12" rx="2.6" ry="8" fill="#FFE3EE" />
            <ellipse cx="39" cy="12" rx="2.6" ry="8" fill="#FFE3EE" />
          </>
        )
      case 'bear':
        return (
          <>
            <circle cx="17" cy="17" r="7.5" fill={color} />
            <circle cx="47" cy="17" r="7.5" fill={color} />
            <circle cx="17" cy="17" r="3.4" fill="#FFE3EE" />
            <circle cx="47" cy="17" r="3.4" fill="#FFE3EE" />
          </>
        )
      default:
        return (
          <>
            <path d="M32 16V7" stroke="#2FA96E" strokeWidth="3" strokeLinecap="round" />
            <path d="M32 12c-7 0-10-3.5-10-8 6 0 10 3 10 8z" fill="#2FA96E" />
            <path d="M32 9c7-1.5 10-5 10-9-6 0-10 4-10 9z" fill="#5FCB9F" />
          </>
        )
    }
  }
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" role="img" aria-label="头像">
      <circle cx="32" cy="34" r="26" fill={ring ?? 'transparent'} />
      <circle cx="32" cy="34" r="21" fill={color} />
      {ears()}
      <circle cx="25" cy="33" r="2.7" fill="#26313E" />
      <circle cx="39" cy="33" r="2.7" fill="#26313E" />
      <circle cx="26" cy="32" r="0.9" fill="#fff" />
      <circle cx="40" cy="32" r="0.9" fill="#fff" />
      <ellipse cx="20.5" cy="38.5" rx="3" ry="2" fill="#FF9D9D" opacity="0.7" />
      <ellipse cx="43.5" cy="38.5" rx="3" ry="2" fill="#FF9D9D" opacity="0.7" />
      <path d="M29 39q3 3 6 0" stroke="#26313E" strokeWidth="2" fill="none" strokeLinecap="round" />
    </svg>
  )
}
