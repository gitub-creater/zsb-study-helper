// 数据模型定义 —— 所有实体与状态的唯一来源

export type AvatarKind = 'sprout' | 'cat' | 'rabbit' | 'bear'
export type ThemeKind = 'sky' | 'mint' | 'sakura' | 'lemon' | 'lavender'

/** 考试类别:高教一类(理学/工学·高数Ⅰ)、二类(经/农/医/管·高数Ⅱ)、三类(文/法/教/史/艺/哲·高数Ⅲ) */
export type ExamCategory = 'gj1' | 'gj2' | 'gj3'
/** 公共课二选一 */
export type Elective = 'english' | 'politics'

/** 知识点状态 */
export type KPStatus = 'unlearned' | 'learning' | 'toReview' | 'basic' | 'mastered'
export const KP_STATUS_TEXT: Record<KPStatus, string> = {
  unlearned: '未学习',
  learning: '学习中',
  toReview: '待复习',
  basic: '基本掌握',
  mastered: '已掌握',
}
export const KP_STATUS_ORDER: KPStatus[] = ['unlearned', 'learning', 'toReview', 'basic', 'mastered']

export type QuestionType = 'single' | 'multiple' | 'judge' | 'fill'
export const QUESTION_TYPE_TEXT: Record<QuestionType, string> = {
  single: '单选',
  multiple: '多选',
  judge: '判断',
  fill: '填空',
}

export type WrongReason =
  | '概念不清'
  | '公式忘记'
  | '计算失误'
  | '审题错误'
  | '记忆混淆'
  | '完全不会'
  | '蒙对或蒙错'
  | '答案存疑'
export const WRONG_REASONS: WrongReason[] = [
  '概念不清',
  '公式忘记',
  '计算失误',
  '审题错误',
  '记忆混淆',
  '完全不会',
  '蒙对或蒙错',
  '答案存疑',
]

export type TaskType = 'learnKP' | 'chapterPractice' | 'reviewWrong' | 'memorize' | 'stageTest' | 'mockExam'
export const TASK_TYPE_TEXT: Record<TaskType, string> = {
  learnKP: '学习知识点',
  chapterPractice: '章节练习',
  reviewWrong: '错题复习',
  memorize: '背诵记忆',
  stageTest: '阶段小测',
  mockExam: '模拟考试',
}

export type PracticeMode = 'sequential' | 'random' | 'chapter' | 'kp' | 'weak' | 'wrong' | 'timed'
export const PRACTICE_MODE_TEXT: Record<PracticeMode, string> = {
  sequential: '顺序练习',
  random: '随机练习',
  chapter: '章节练习',
  kp: '知识点专项',
  weak: '薄弱点强化',
  wrong: '错题复习',
  timed: '限时测试',
}

export interface Profile {
  nickname: string
  avatar: AvatarKind
  theme: ThemeKind
  /** 报考专业 */
  major: string
  /** 报考类别(高教一类/二类/三类),决定高数科目与内容范围 */
  category?: ExamCategory
  /** 公共课二选一:英语或政治 */
  elective?: Elective
  /** 全部解锁(装扮/边框等外观项,仅影响显示) */
  allUnlocked?: boolean
  /** 目标院校(报考意向,可随时修改) */
  targetCollege?: string
  /** 考试日期 YYYY-MM-DD */
  examDate: string
  /** 考试大纲年份 */
  syllabusYear: number
  baseLevel: 'zero' | 'basic' | 'solid'
  /** 每天可学习时间(分钟) */
  dailyMinutes: number
  /** 每周可学习天数 */
  weeklyDays: number
  createdAt: string
}

export interface Subject {
  id: string
  name: string
  color: string
  targetScore: number
  order: number
  /** 适用考试类别;空=全部类别 */
  applicableCategories?: ExamCategory[]
  /** 公共课二选一归属;空=必考科目 */
  elective?: Elective
  /** 示例/旧版科目标记,仅用于展示分组,不影响数据 */
  legacy?: boolean
  /** 考纲信息(版本化,可追溯) */
  syllabus?: {
    version: string
    year: number
    source: string
    sourceUrl?: string
    verified: string
    updatedAt: string
  }
}

export interface Chapter {
  id: string
  subjectId: string
  name: string
  order: number
  /** 考纲考查要求 */
  requirement?: string
  /** 考纲来源说明 */
  source?: string
}

export interface KPStats {
  attempts: number
  correct: number
  wrongCount: number
  lastPracticedAt: string | null
  /** 连续答对次数 */
  streak: number
  /** 错题复习成功累计加分 */
  reviewBonus: number
}

export interface KnowledgePoint {
  id: string
  subjectId: string
  chapterId: string
  name: string
  status: KPStatus
  order: number
  notes: string
  stats: KPStats
  /** 缓存的掌握度(0-100),null=数据不足 */
  mastery: number | null
  // ---- 内容元数据(catalog 导入,均可选,兼容旧数据) ----
  /** 适用考试类别;空=全部 */
  applicableCategories?: ExamCategory[]
  /** 前置知识点名称 */
  prerequisites?: string[]
  /** 核心概念 */
  concepts?: string
  /** 重点公式(LaTeX,用 $...$ 包裹) */
  formulas?: string
  /** 解题方法 */
  methods?: string
  /** 常见题型 */
  commonTypes?: string
  /** 典型例题(LaTeX 用 $...$) */
  example?: string
  /** 易错点 */
  mistakes?: string
  /** 学习难度 1-3 */
  difficulty?: 1 | 2 | 3
  /** 重要程度 1-3 */
  importance?: 1 | 2 | 3
  /** 预计学习时间(分钟) */
  estMinutes?: number
  /** 资料来源说明 */
  sourceRef?: string
}

export interface Question {
  id: string
  subjectId: string
  chapterId: string
  kpId: string
  type: QuestionType
  stem: string
  options: string[]
  /** single/judge: 'A'/'B'... multiple: 'ABD' fill: 文本 */
  answer: string
  explanation: string
  difficulty: 1 | 2 | 3
  source: string
  year: number
  official: boolean
  createdAt: string
  // ---- 扩展字段(可选,兼容旧数据) ----
  /** 适用考试类别;空=全部 */
  categories?: ExamCategory[]
  /** 是否真题(需有可靠来源) */
  isReal?: boolean
  /** 高频考点题 */
  hot?: boolean
  /** 标签 */
  tags?: string[]
  /** 错误选项分析 */
  wrongAnalysis?: string
  /** 次要关联知识点(一题多考点) */
  secondaryKpIds?: string[]
  updatedAt?: string
  // ---- 题库管理扩展字段 ----
  /** 题目类型:真题/模拟题/预测题/机构题/原创题/AI生成 */
  qType?: '真题' | '模拟题' | '预测题' | '机构题' | '原创题' | 'AI生成'
  /** 是否已人工审核 */
  reviewed?: boolean
  /** 来源网址 */
  sourceUrl?: string
  /** 相似题标记(指向被关联的题目 id) */
  similarTo?: string
}

export interface Attempt {
  id: string
  questionId: string
  kpId: string
  subjectId: string
  correct: boolean
  userAnswer: string
  mode: PracticeMode
  at: string
  date: string
}

export interface WrongReviewLog {
  date: string
  correct: boolean
}

export interface WrongEntry {
  questionId: string
  kpId: string
  subjectId: string
  wrongCount: number
  firstWrongAt: string
  lastWrongAt: string
  lastUserAnswer: string
  correctAnswer: string
  reason: WrongReason | null
  /** 当前所处间隔档位(0..intervals.length-1) */
  intervalIndex: number
  streakCorrect: number
  reviewLog: WrongReviewLog[]
  /** 下次复习日期;null 且 archived=true 表示已克服 */
  nextReviewAt: string | null
  archived: boolean
}

export interface Task {
  id: string
  type: TaskType
  title: string
  kpIds?: string[]
  chapterId?: string
  subjectId?: string
  /** 练习类任务的题数(可调整);学习类=知识点个数 */
  questionCount: number
  progress: number
  done: boolean
  estMinutes: number
  xp: number
  note?: string
}

export interface SessionAnswer {
  userAnswer: string
  correct: boolean
}

export interface Session {
  id: string
  mode: PracticeMode
  name: string
  questionIds: string[]
  index: number
  answers: Record<string, SessionAnswer>
  startedAt: string
  taskId?: string
  /** 限时测试:总时长(秒) */
  limitSeconds?: number
  expiresAt?: number
  /** 本次练习已获得经验 */
  xpGained: number
}

export interface SessionSummary {
  mode: PracticeMode
  name: string
  total: number
  answered: number
  correct: number
  xpGained: number
  at: string
  wrongKpIds: string[]
}

export interface Settings {
  /** 错题间隔复习天数,如 [1,3,7,14,30] */
  intervals: number[]
  /** 每日答题经验上限(防刷) */
  dailyPracticeXpCap: number
  reduceMotion: boolean
  mascotEnabled: boolean
  /** 远程内容包更新源 URL(可为空;指向静态托管的 catalog JSON) */
  updateSourceUrl?: string
  /** 软件版本清单 URL(可为空;JSON 格式 {version, notes, url}) */
  updateManifestUrl?: string
  /** AI 判题/讲题服务配置(豆包/DeepSeek/千问/自定义 OpenAI 兼容),密钥仅存本机;思考程度只影响讲解深度 */
  ai?: AiSettings
  /** AI 讲题朗读偏好:使用设备原生语音,不随项目打包第三方语音文件 */
  speech?: SpeechSettings
}

/** OpenAI-compatible 服务配置。apiKey 仅保存在当前设备，不进入云端快照。 */
export interface AiSettings {
  provider: string
  baseURL: string
  apiKey: string
  model: string
  reasoningEffort?: 'low' | 'medium' | 'high'
  apiMode?: 'chat' | 'responses'
  timeoutMs?: number
  stream?: boolean
  customHeaders?: Record<string, string>
  temperature?: number
  maxTokens?: number
}

export type SpeechRate = 0.75 | 1 | 1.25 | 1.5

/** 浏览器/系统原生语音的可持久化偏好。voiceURI 是设备提供的稳定标识,失效时自动回退。 */
export interface SpeechSettings {
  /** 用户可随时关闭讲题朗读；关闭后保留完整文字讲解。 */
  enabled?: boolean
  rate: SpeechRate
  voiceURI?: string
  voiceName?: string
  preferredLang: 'zh-CN'
}

export interface OfficeResultRecord {
  level: string
  earned: number
  total: number
  at: string
}

// ---------- 实操大题(Office 可编辑材料) ----------

export type OfficeSoftware = 'word' | 'excel' | 'ppt'
export type OfficeDifficulty = '基础' | '进阶' | '综合'
export type OfficeCheckType = 'single' | 'multiple' | 'fill'

export interface OfficeCheckItem {
  id: string
  prompt: string
  type: OfficeCheckType
  options?: string[]
  /** 单选/多选使用 A/B/C;填空允许以 | 分隔等价答案 */
  answer: string
  explanation: string
}

export interface OfficeScoringItem {
  item: string
  points: number
  criterion: string
}

export interface OfficeSource {
  sourceType: '原创同类型题' | '根据公开资料改编' | '授权题目'
  sourceTitle: string
  sourceOrganization: string
  sourceYear: number
  sourceUrl: string
  license: string
  copyrightNote: string
}

/** 静态题库中的实操大题;材料文件由 scripts/generate-office-materials.mjs 确定性生成。 */
export interface OfficeQuestion {
  id: string
  order: number
  title: string
  software: OfficeSoftware
  category: string
  difficulty: OfficeDifficulty
  knowledgePoints: string[]
  prompt: string
  materials: string[]
  taskSteps: string[]
  referenceAnswer: string[]
  scoringRubric: OfficeScoringItem[]
  commonMistakes: string[]
  sourceType: OfficeSource['sourceType']
  sourceTitle: string
  sourceOrganization: string
  sourceYear: number
  sourceUrl: string
  license: string
  copyrightNote: string
  source: OfficeSource
  studentFileUrl: string
  answerFileUrl: string
  createdAt: string
  updatedAt: string
  checks: OfficeCheckItem[]
}

export interface OfficeQuestionBank {
  meta: {
    name: string
    version: number
    updatedAt: string
    sourceBasis: string
    sourceUrl: string
    sourceSha256: string
    note: string
  }
  questions: OfficeQuestion[]
}

/** 学生先完成客观检查并获得判定,才可在学生模式中查看答案/评分标准。 */
export interface OfficeSubmission {
  questionId: string
  answers: Record<string, string>
  correctCount: number
  totalChecks: number
  score: number
  totalScore: number
  status: 'correct' | 'incorrect' | 'needsReview'
  submittedAt: string
  answerUnlockedAt: string
}

export interface XpLogEntry {
  t: number
  amount: number
  reason: string
}

export interface State {
  version: number
  onboarded: boolean
  profile: Profile | null
  subjects: Subject[]
  chapters: Chapter[]
  kps: KnowledgePoint[]
  questions: Question[]
  attempts: Attempt[]
  wrong: Record<string, WrongEntry>
  /** 日期 -> 当日任务 */
  tasks: Record<string, Task[]>
  session: Session | null
  lastSummary: SessionSummary | null
  xp: number
  xpLog: XpLogEntry[]
  practiceXpDate: string
  practiceXpToday: number
  streak: { current: number; best: number; lastActive: string | null }
  /** 日期 -> 累计学习秒数 */
  studyTime: Record<string, number>
  favorites: string[]
  questionNotes: Record<string, string>
  /** 已发放"全部完成"奖励的日期 */
  allDoneBonus: string[]
  settings: Settings
  seedLoaded: boolean
  /** 已合并的内容包版本(考试类别目录) */
  catalogVersion?: number
  /** 热门题页用户手动隐藏的题目 */
  hiddenHot: string[]
  /** 上次检查更新的时间戳 */
  lastUpdateCheck?: number
  /** 上次检查软件新版本的时间戳 */
  lastAppUpdateCheck?: number
  /** 实操大题最近一次判题结果 */
  officeResults?: Record<string, OfficeResultRecord>
  /** 新版材料型实操题的学生提交记录;刷新、重开和云同步后仍保留 */
  officeSubmissions?: Record<string, OfficeSubmission>
  /** 已应用的材料型实操题库版本;仅用于迁移与回滚判断 */
  officeBankVersion?: number
  /** 升级时保留旧笔试型实操成绩,不与新版材料题混淆 */
  legacyOfficeResults?: Record<string, OfficeResultRecord>
  /** 英语打卡:打卡日期与已掌握单词 */
  english?: { checkedDates: string[]; mastered: string[] }
  /** 更新日志(导入/审核/迁移等事件) */
  qaLog?: { t: number; text: string }[]
  /** 已安排任务(定时提醒) */
  schedules?: ScheduleTask[]
}

// ---------- 已安排任务(定时提醒,类似"日程提醒") ----------

/** 重复规则:仅一次 / 每天 / 每周指定星期(0=周日 … 6=周六) */
export type ScheduleRepeat =
  | { kind: 'once' }
  | { kind: 'daily' }
  | { kind: 'weekly'; weekdays: number[] }
  /** 自定义每 N 天一次,N>=2 */
  | { kind: 'custom'; intervalDays: number }

/** 一次执行的记录 */
export interface ScheduleRun {
  /** 计划发生时刻(本地 YYYY-MM-DDTHH:MM,即防重复 key) */
  at: string
  /** 实际提醒/处理时间(ISO) */
  handledAt?: string
  status: 'notified' | 'done'
}

export interface ScheduleTask {
  id: string
  /** 任务名称,如"背诵英语词汇" */
  name: string
  /** 学习内容/描述 */
  note: string
  /** 执行时间 HH:MM */
  time: string
  /** 仅一次=执行日期;重复任务=起始日期(YYYY-MM-DD) */
  date: string
  repeat: ScheduleRepeat
  /** 固定为北京时间;旧任务升级后默认补齐 */
  timezone?: 'Asia/Shanghai'
  /** 用户要求的数据结构字段,与 name/note/time/date/repeat/remindBefore 保持一一对应 */
  title?: string
  content?: string
  /** ISO 风格的北京时间墙上时刻 YYYY-MM-DDTHH:MM */
  remindAt?: string
  repeatRule?: ScheduleRepeat
  advanceMinutes?: number
  /** 浏览器原生朗读提醒;默认 false,防止旧任务升级后突然发声 */
  voiceEnabled?: boolean
  /** 允许系统通知;默认 true */
  notificationEnabled?: boolean
  /** 提醒声音:语音播报 / 简短提示音 / 静音 */
  reminderSound?: 'voice' | 'chime' | 'silent'
  /** active/paused/completed,与 enabled 保持兼容 */
  status?: 'active' | 'paused' | 'completed'
  /** 结束日期(YYYY-MM-DD,含当天),仅重复任务可设 */
  endDate?: string
  /** 提前提醒分钟数,0=准时 */
  remindBefore: number
  /** 每次提醒"标记完成"后:继续下一次 / 暂停任务 */
  afterDone: 'continue' | 'pause'
  /** 启用中 / 已暂停 */
  enabled: boolean
  createdAt: string
  updatedAt: string
  /** 下次执行时刻(本地 YYYY-MM-DDTHH:MM);null=暂无(已暂停/已结束) */
  nextRunAt: string | null
  /** 已提醒过的发生时刻 key(确定性,防重复刷新/重启后重复提醒) */
  firedKeys: string[]
  /** 稍后提醒:到 until(ISO)再弹一次 */
  snoozed?: { key: string; until: string }
  /** 执行记录(最新在前,最多 50 条) */
  history: ScheduleRun[]
}

/** 内容包结构(public/data/catalog*.json,与代码分离,可随大纲年度更新) */
export interface CatalogKp {
  id: string
  subjectId: string
  chapterId: string
  name: string
  order: number
  applicableCategories?: ExamCategory[]
  prerequisites?: string[]
  concepts?: string
  formulas?: string
  methods?: string
  commonTypes?: string
  example?: string
  mistakes?: string
  difficulty?: 1 | 2 | 3
  importance?: 1 | 2 | 3
  estMinutes?: number
  sourceRef?: string
}

export interface CatalogQuestion {
  id: string
  subjectId: string
  chapterId: string
  kpId: string
  type: QuestionType
  stem: string
  options: string[]
  answer: string
  explanation: string
  difficulty: 1 | 2 | 3
  source: string
  year: number
  official: boolean
  categories?: ExamCategory[]
  isReal?: boolean
  hot?: boolean
  tags?: string[]
  wrongAnalysis?: string
}

export interface CatalogData {
  meta: { name: string; version: number; updatedAt: string; note?: string; legacySubjectIds?: string[]; removeSubjectIds?: string[]; removeQuestionIds?: string[] }
  subjects: Subject[]
  chapters: Chapter[]
  kps: CatalogKp[]
  questions?: CatalogQuestion[]
}

/** 种子数据结构(public/data/seed.json,与代码分离) */
export interface SeedData {
  meta: { name: string; version: number; note?: string }
  subjects: Subject[]
  chapters: Chapter[]
  kps: { id: string; subjectId: string; chapterId: string; name: string; order: number }[]
  questions: {
    id: string
    subjectId: string
    chapterId: string
    kpId: string
    type: QuestionType
    stem: string
    options: string[]
    answer: string
    explanation: string
    difficulty: 1 | 2 | 3
    source: string
    year: number
    official: boolean
  }[]
}
