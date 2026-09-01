// 宠物园:专门看宠物玩的界面。四只小生物在草坪上各自踱步、张望、打盹,
// 点击会蹦跳撒星星;选一只带走,它就会出现在各页面的底部陪你学习并负责任务提醒。
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useStore } from '../store/store'
import { useToast } from '../components/ui'
import { Icon } from '../components/Icon'
import { PetCreature } from '../components/PetCreature'
import {
  CREATURES,
  CREATURE_ORDER,
  advanceCreature,
  creatureStateDuration,
  nextCreatureState,
  nextWalkTarget,
} from '../lib/pet'
import type { CreatureProfile, CreatureState } from '../lib/pet'
import type { AvatarKind } from '../types'

const SCENE_MIN_W = 320

function useCreatureBrain(species: CreatureProfile, seed: number) {
  const [st, setSt] = useState(() => ({
    creature: (seed % 2 === 0 ? 'walk' : 'look') as CreatureState,
    x: 60 + seed * 140,
    target: 260 + seed * 90,
    facing: 1 as 1 | -1,
    until: Date.now() + 1200 + seed * 700,
  }))
  const stRef = useRef(st)
  stRef.current = st
  const sceneRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const timer = window.setInterval(() => {
      const scene = sceneRef.current
      const now = Date.now()
      const prev = stRef.current
      const width = scene ? scene.clientWidth : 800
      setSt((old) => {
        if (old.until > now) return old
        if (old.creature === 'excited') {
          const next = nextCreatureState('look', Math.random())
          return { ...old, creature: next, until: now + creatureStateDuration(next, Math.random()) }
        }
        if (old.creature === 'walk') {
          const moved = advanceCreature(old.x, old.target, species.speed, 120)
          if (!moved.arrived) return { ...old, x: moved.x, facing: moved.x < old.target ? -1 : 1 }
          const next = nextCreatureState('walk', Math.random())
          return { ...old, x: moved.x, creature: next, until: now + creatureStateDuration(next, Math.random()) }
        }
        const next = nextCreatureState(old.creature, Math.random())
        const duration = creatureStateDuration(next, Math.random())
        const maxX = Math.max(SCENE_MIN_W, width) - 110
        if (next === 'walk') {
          return { ...old, creature: 'walk', target: nextWalkTarget(Math.min(old.x, maxX), Math.max(SCENE_MIN_W, width)), until: now + duration }
        }
        return { ...old, creature: next, until: now + duration }
      })
    }, 120)
    return () => window.clearInterval(timer)
  }, [species.speed])

  const poke = useCallback(() => {
    setSt((old) => ({ ...old, creature: 'excited', until: Date.now() + 1500 }))
  }, [])

  return { st, sceneRef, poke }
}

function LawnCreature({
  species,
  seed,
  isCompanion,
  onPick,
}: {
  species: CreatureProfile
  seed: number
  isCompanion: boolean
  onPick: () => void
}) {
  const { st, sceneRef, poke } = useCreatureBrain(species, seed)
  const [hearts, setHearts] = useState<number>(0)

  const onClick = () => {
    poke()
    setHearts((n) => n + 1)
    onPick()
  }

  return (
    <div className="park-pet" style={{ left: st.x }}>
      {isCompanion && (
        <span className="park-crown" title="当前陪伴宠物">
          <Icon name="star" size={13} />
        </span>
      )}
      <button type="button" className="park-pet-btn" aria-label={`和${species.name}玩`} onClick={onClick}>
        <PetCreature species={species} state={st.creature} size={84} facing={st.facing} />
      </button>
      {hearts > 0 && <span key={hearts} className="park-heart" aria-hidden>♥</span>}
      <span className="park-name">{species.name}</span>
    </div>
  )
}

export function PetPark() {
  const { state, dispatch } = useStore()
  const toast = useToast()
  const companion = (state.settings.pet?.avatar ?? 'sprout') as AvatarKind
  const petEnabled = state.settings.pet?.enabled !== false
  const companionProfile = CREATURES[companion] ?? CREATURES.sprout

  const choose = useCallback(
    (id: AvatarKind, name: string) => {
      dispatch({ type: 'SET_SETTINGS', patch: { pet: { ...(state.settings.pet ?? { enabled: true }), avatar: id, minimized: false, enabled: true } } })
      toast(`${name}跟你回家啦!它会陪着你学习并在任务到点时提醒你`, { kind: 'success' })
    },
    [dispatch, state.settings.pet, toast],
  )

  return (
    <div className="park">
      <div className="card park-intro">
        <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
          <div className="col" style={{ gap: 3 }}>
            <b>宠物园 · 知识校园后山草坪</b>
            <span className="fs12 muted">点一点它们会和玩;选一只当陪伴宠物,它会在页面底部踱步、提醒任务、陪你听讲题。全程静音。</span>
          </div>
          <span className={`chip ${petEnabled ? 'chip-green' : ''}`}>
            <Icon name={petEnabled ? 'check' : 'close'} size={12} /> 陪伴宠物:{companionProfile.name}{petEnabled ? '(已在岗)' : '(已被送走,选择后接回)'}
          </span>
        </div>
      </div>

      <div className="park-scene card" role="group" aria-label="宠物活动草坪">
        <i className="park-sun" aria-hidden />
        <i className="park-cloud park-cloud-1" aria-hidden />
        <i className="park-cloud park-cloud-2" aria-hidden />
        <i className="park-cloud park-cloud-3" aria-hidden />
        <div className="park-ground" aria-hidden>
          <i className="park-flower park-flower-1">✿</i>
          <i className="park-flower park-flower-2">✾</i>
          <i className="park-flower park-flower-3">❀</i>
          <i className="park-flower park-flower-4">✿</i>
        </div>
        {CREATURE_ORDER.map((id, index) => (
          <LawnCreature
            key={id}
            species={CREATURES[id]}
            seed={index}
            isCompanion={companion === id}
            onPick={() => choose(id, CREATURES[id].name)}
          />
        ))}
      </div>

      <div className="park-cards">
        {CREATURE_ORDER.map((id) => {
          const profile = CREATURES[id]
          const active = companion === id
          return (
            <div key={id} className={`card park-card${active ? ' is-on' : ''}`}>
              <div className="row" style={{ gap: 10, alignItems: 'center' }}>
                <div className="park-card-avatar">
                  <PetCreature species={profile} state="sit" size={56} />
                </div>
                <div className="col" style={{ gap: 2, flex: 1, minWidth: 0 }}>
                  <b className="fs14">{profile.name}{active && <span className="chip chip-green" style={{ marginLeft: 6 }}>陪伴中</span>}</b>
                  <span className="fs12 muted">{profile.trait}</span>
                </div>
                <button
                  type="button"
                  className={`btn btn-sm${active ? '' : ' btn-primary'}`}
                  disabled={active}
                  onClick={() => choose(id, profile.name)}
                >
                  {active ? '陪着呢' : '带它回家'}
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
