// 技能注册表:新增技能(英语/专业课等)只需在此追加,对话框自动获得该技能的提示词与快捷追问
import type { Skill } from './types'
import { MATH_SKILL } from './math'

export const SKILLS: Skill[] = [MATH_SKILL]

export const DEFAULT_SKILL_ID = 'math'

export function getSkill(id: string): Skill {
  return SKILLS.find((s) => s.id === id) ?? MATH_SKILL
}

export type { Skill, ReasoningLevel } from './types'
