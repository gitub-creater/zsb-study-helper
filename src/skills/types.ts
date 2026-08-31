// 技能模块类型定义:提示词集中在此管理,UI 组件只调用技能,不散落提示词文案

/** 思考程度:仅作为解答深度的等级(高=完整验证流程,低=精炼输出),不涉及模型隐藏思维链 */
export type ReasoningLevel = 'low' | 'medium' | 'high'

export interface SkillQuickAction {
  /** 按钮文案,如"换一种方法" */
  label: string
  /** 点击后发送的追问文本 */
  prompt: string
}

export interface Skill {
  id: string
  /** 技能名,如"专升本数学题分析解析" */
  name: string
  /** 一句话说明,展示在对话空状态 */
  tagline: string
  /** 空状态与回复下方展示的快捷追问 */
  quickActions: SkillQuickAction[]
  /** 组装系统提示词;思考程度只影响输出详细程度与验证强度 */
  buildSystemPrompt(opts?: { reasoningLevel?: ReasoningLevel }): string
  /** 发送前的本地预检;返回文案则拦截发送(如空输入),返回 null 放行 */
  guard?(userText: string, imageCount: number): string | null
}
