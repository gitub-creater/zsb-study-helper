# 数据模型设计(山东专升本知识校园)

本应用为本机优先、云端可同步架构:浏览器 `localStorage` 保存离线副本(键 `zsb_helper_v1__<userId>`),内容包(科目/章节/知识点/题目)与代码分离存放于 `public/data/*.json`。启用 Supabase 后，`app_users`、`app_sessions`、`user_states` 分别保存账号、会话和每位用户的学习状态快照，具体部署见 `docs/CLOUD_SYNC.md`。

## 实体映射

| 规定实体 | 本项目实现 | 说明 |
|---|---|---|
| User | `Profile` | 单用户本地档案:昵称/头像/主题/专业/**报考类别 category**/**公共课 elective**/考试日期/基础/每日时长/每周天数 |
| ExamCategory | `ExamCategory`(gj1/gj2/gj3)+ `src/lib/categories.ts` | 高教一类=理/工(高数Ⅰ)、二类=经/农/医/管(高数Ⅱ)、三类=文/法/教/史/艺/哲(高数Ⅲ);常量含门类映射与差异说明 |
| Subject | `Subject` | 科目;`applicableCategories` 声明适用的考试类别(高数Ⅰ/Ⅱ/Ⅲ 各只属一类),`elective` 标记英语/政治二选一,`legacy` 标记旧示例科目(选类别后隐藏) |
| Chapter | `Chapter` | 章节,`subjectId` 归属,`order` 排序 |
| KnowledgePoint | `KnowledgePoint` | 知识点;学习状态五档 + 统计(attempts/correct/wrongCount/lastPracticedAt/streak/reviewBonus)+ 掌握度缓存;内容元数据:`applicableCategories`(一点多类)、`prerequisites`(前置)、`concepts/formulas/methods/commonTypes/example/mistakes`、难度/重要度/预计时长、`sourceRef` 来源 |
| LearningMaterial | `KP.notes` + `State.questionNotes` + `sourceRef` | 本地学习资料以笔记与来源引用形式存在;扩展视频/外链时新增 `materials` 集合即可 |
| Question | `Question` | 题干/选项/答案/解析/难度/来源/年份/`official`(是否官方资料);扩展:`categories`(适用类别)、`isReal`(真题)、`hot`(高频)、`tags`、`wrongAnalysis`、`updatedAt` |
| QuestionOption | `Question.options[]` | JSON 内嵌数组;服务端化时拆为独立表 |
| AnswerRecord | `Attempt` | 每次 作答 的完整记录:对错/用户答案/模式/时间戳/日期(趋势与正确率的数据源) |
| WrongQuestion | `State.wrong: Record<qid, WrongEntry>` | 错误次数/错误原因/历次复习记录/间隔档位/下次复习日期/归档状态 |
| FavoriteQuestion | `State.favorites` | 收藏题目 id 列表 |
| StudyPlan / StudyTask | `State.tasks: Record<date, Task[]>` | 按日期存储任务(学习知识点/章节练习/错题复习/阶段小测),支持调序、调量、顺延、重生成保留已完成 |
| TaskReminder | `State.schedules: ScheduleTask[]` | 定点提醒;名称/内容/日期/时间/北京时间/重复规则/提前分钟数/通知与语音开关/执行历史均随状态快照持久化。 |
| OfficeQuestion | `public/data/office-question-bank.v3.json` | 静态原创材料题库，包含题目、考点、难度、材料、步骤、答案、评分、易错点、来源/版权字段和学生/答案文件 URL。 |
| OfficeSubmission | `State.officeSubmissions` | 学生的客观核对作答、正确数、状态、分数和答案解锁时间；旧版成绩保存在 `legacyOfficeResults`。 |
| ExamPaper / ExamRecord | `Session` + `SessionSummary` + `Attempt` | 练习会话即轻量试卷(限时测试=定时试卷);模拟考试为第二阶段扩展,复用同两实体 |
| SourceReference | `src/lib/categories.ts SOURCE_REFS` + 字段级 `sourceRef` | 页面展示资料名称/机构/日期/URL/类型(官方/机构/经验)/核验状态;知识点与题目均携带来源 |
| UserProgress | 由 `Attempt`/`KnowledgePoint.stats`/`chapterMastery`/`subjectMastery` 派生 | 掌握度按 45% 近期正确率 + 25% 历史 + 20% 难度加权 + 复习成果 − 衰减计算,<3 次显示"数据不足" |

## 关键设计决策

1. **高数Ⅰ/Ⅱ/Ⅲ = 三个独立 Subject**(`s-m1/s-m2/s-m3`),各自有独立章节树;同一数学主题(如极限)在三个科目下按各自大纲深度分别建知识点,并用 `applicableCategories` 标注归属,满足"同名主题不同深度"的现实。
2. **一点多类 / 一题多考点**:知识点用 `applicableCategories[]`、题目用 `categories[]` 与 `secondaryKpIds[]` 表达多对多;生产化时把这两个数组升级为关联表即可。
3. **共享知识点**:内容包中 `大学英语(s1)`、`计算机基础(s3)` 沿用旧 id,内容包只增发章节/知识点/题目,老用户数据自然延续;旧通用《高等数学(s2)》标记 `applicableCategories: []`,选定类别后自动隐藏但记录保留。
4. **版本管理与大纲更新**:`State.catalogVersion` 与内容包 `meta.version` 比对,启动时执行 `MERGE_CATALOG`——**只按 id 新增,永不删除/覆盖**用户已有内容,大纲更新不破坏历史学习记录。
5. **来源可追踪**:每条官方事实在 `SOURCE_REFS` 登记名称/机构/日期/URL/核验状态;未逐条核验的细目标注"待核实",不冒充官方结论。
6. **安全与隐私**:CSV 导入在浏览器内解析并预览确认；Supabase service-role key 仅在 Vercel 环境变量。用户配置的 AI API Key 目前是本机设备私密数据，会在云同步上传前和下载后无条件清空远端副本；已有本机 Key 不会被云端覆盖。
7. **V3 兼容迁移**:数据库仍使用 `user_states.state JSONB`，不需要新增 SQL 表或删除旧数据。`normalizeState()` 为旧快照补齐 `speech`、`schedules`、`officeSubmissions`、`officeBankVersion` 等字段；旧提醒默认静音，旧实操成绩迁移到 `legacyOfficeResults`。题库静态备份、回滚和版权说明见 [FEATURES_V3.md](FEATURES_V3.md)。
