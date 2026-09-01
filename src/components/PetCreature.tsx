// 活的宠物生物渲染器:多角色(芽芽/团团/雪球/布丁),走路迈腿、打盹冒 Zzz、
// 张望动瞳孔、开心撒星星。只负责"这只宠物现在长什么样",行为节奏由调用方驱动。
import React from 'react'
import type { CreatureProfile, CreatureState } from '../lib/pet'

export function PetCreature({
  species,
  state,
  size = 96,
  facing = 1,
}: {
  species: CreatureProfile
  state: CreatureState
  size?: number
  facing?: 1 | -1
}) {
  const sleeping = state === 'sleep'
  const walking = state === 'walk'
  const excited = state === 'excited'
  const remind = state === 'remind'
  const ear = species.ear

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 120 118"
      role="img"
      aria-label={`宠物${species.name}`}
      className={`petc petc-${species.id} petc-is-${state}`}
      style={facing === -1 ? { transform: 'scaleX(-1)' } : undefined}
    >
      <ellipse className="petc-shadow" cx="60" cy="112" rx="27" ry="5.5" fill="#26313e" opacity="0.16" />
      <g className="petc-body">
        {/* 耳朵:画在帽子后面 */}
        {ear === 'cat' && (
          <g fill={species.body}>
            <path className="petc-ear petc-ear-l" d="M34 24 L26 4 L48 14 Z" />
            <path className="petc-ear petc-ear-r" d="M86 24 L94 4 L72 14 Z" />
          </g>
        )}
        {ear === 'rabbit' && (
          <g fill={species.body} stroke={species.belly} strokeWidth="2">
            <ellipse className="petc-ear petc-ear-l" cx="46" cy="8" rx="7.5" ry="15" />
            <ellipse className="petc-ear petc-ear-r" cx="74" cy="8" rx="7.5" ry="15" />
          </g>
        )}
        {ear === 'bear' && (
          <g fill={species.body}>
            <circle className="petc-ear petc-ear-l" cx="33" cy="20" r="9" />
            <circle className="petc-ear petc-ear-r" cx="87" cy="20" r="9" />
            <circle cx="33" cy="20" r="4" fill={species.belly} />
            <circle cx="87" cy="20" r="4" fill={species.belly} />
          </g>
        )}
        {ear === 'sprout' && (
          <g fill="#5FBF9C">
            <path className="petc-ear petc-ear-l" d="M52 8q-10-8-16-2 8 8 16 2z" />
            <path className="petc-ear petc-ear-r" d="M68 8q10-8 16-2-8 8-16 2z" />
          </g>
        )}

        {/* 学士帽 */}
        <path d="M60 4 96 18 60 32 24 18Z" fill="#2B3A55" />
        <path d="M44 24v7c0 3.6 7 6.5 16 6.5s16-2.9 16-6.5v-7" fill="#22314A" />
        <circle cx="60" cy="4" r="3" fill="#FFD34D" />
        <path className="petc-tassel" d="M96 18v13" stroke="#FFD34D" strokeWidth="2.5" strokeLinecap="round" />
        <circle className="petc-tassel" cx="96" cy="33.5" r="3" fill="#FFD34D" />

        {/* 身体、肚皮与尾巴 */}
        <path d="M60 30c-22 0-35 14-35 33s15 35 35 35 35-16 35-35-13-33-35-33z" fill={species.body} />
        <ellipse cx="60" cy="80" rx="20" ry="14" fill={species.belly} opacity="0.55" />
        {ear === 'cat' && <path className="petc-tail" d="M94 84q16-2 12-18" stroke={species.body} strokeWidth="7" fill="none" strokeLinecap="round" />}

        {/* 脚:走路时交替迈步 */}
        <ellipse className={`petc-foot petc-foot-l${walking ? ' is-step' : ''}`} cx="47" cy="100" rx="8" ry="4" fill={species.belly} />
        <ellipse className={`petc-foot petc-foot-r${walking ? ' is-step' : ''}`} cx="73" cy="100" rx="8" ry="4" fill={species.belly} />

        {/* 腮红 */}
        <ellipse cx="40" cy="72" rx="5" ry="3.5" fill="#FFB1B1" opacity="0.8" />
        <ellipse cx="80" cy="72" rx="5" ry="3.5" fill="#FFB1B1" opacity="0.8" />

        {/* 眼睛与嘴:按状态切换表情 */}
        {sleeping ? (
          <>
            <path d="M42 64q5 4 10 0" stroke="#26313E" strokeWidth="2.6" fill="none" strokeLinecap="round" />
            <path d="M68 64q5 4 10 0" stroke="#26313E" strokeWidth="2.6" fill="none" strokeLinecap="round" />
            <ellipse cx="60" cy="74" rx="3" ry="2.2" fill="#26313E" />
          </>
        ) : excited ? (
          <>
            <path d="M42 65q5.5-7 11 0" stroke="#26313E" strokeWidth="3" fill="none" strokeLinecap="round" />
            <path d="M67 65q5.5-7 11 0" stroke="#26313E" strokeWidth="3" fill="none" strokeLinecap="round" />
            <path d="M51 72q9 10 18 0" stroke="#26313E" strokeWidth="3" fill="none" strokeLinecap="round" />
          </>
        ) : remind ? (
          <>
            <circle className="petc-eye" cx="47" cy="62" r="3.6" fill="#26313E" />
            <circle className="petc-eye" cx="73" cy="62" r="3.6" fill="#26313E" />
            <circle cx="48.4" cy="60.6" r="1.2" fill="#fff" />
            <circle cx="74.4" cy="60.6" r="1.2" fill="#fff" />
            <ellipse cx="60" cy="74" rx="4.5" ry="3.2" fill="#26313E" />
          </>
        ) : (
          <>
            <circle className="petc-eye" cx="47" cy="64" r="3.6" fill="#26313E" />
            <circle className="petc-eye" cx="73" cy="64" r="3.6" fill="#26313E" />
            <circle className="petc-pupil" cx="48.4" cy="62.6" r="1.2" fill="#fff" />
            <circle className="petc-pupil" cx="74.4" cy="62.6" r="1.2" fill="#fff" />
            <path d="M55 74q5 4.5 10 0" stroke="#26313E" strokeWidth="2.6" fill="none" strokeLinecap="round" />
          </>
        )}

        {/* remind:举小旗 */}
        {remind && (
          <g>
            <path d="M92 56v20" stroke="#8A6A3A" strokeWidth="3" strokeLinecap="round" />
            <path className="petc-flag" d="M92 56l16-5-1.5 11z" fill="#FF8A7A" />
          </g>
        )}
      </g>

      {/* sleep:Zzz 依次上浮 */}
      {sleeping && (
        <g className="petc-zzz" fill="#7B8794" fontSize="13" fontWeight="700">
          <text className="petc-z petc-z-1" x="88" y="42">z</text>
          <text className="petc-z petc-z-2" x="97" y="30">z</text>
          <text className="petc-z petc-z-3" x="106" y="18">Z</text>
        </g>
      )}

      {/* excited:星星迸发 */}
      {excited && (
        <g fill="#FFD34D">
          <path className="petc-star petc-star-1" d="M14 44l2.2 4.6 4.8.6-3.5 3.4.9 4.9-4.4-2.4-4.4 2.4.9-4.9L7 49.2l4.8-.6z" />
          <path className="petc-star petc-star-2" d="M106 38l2.2 4.6 4.8.6-3.5 3.4.9 4.9-4.4-2.4-4.4 2.4.9-4.9-3.5-3.4 4.8-.6z" />
        </g>
      )}
    </svg>
  )
}
