# V3 功能、数据与发布说明

本文对应材料型实操题库 V3，更新时间为 2026-08-31。它说明当前已实现的能力、数据迁移方式和不能由网页伪装解决的环境限制。

## 当前架构

| 层级 | 当前方案 | 说明 |
| --- | --- | --- |
| 前端 | Vite + React 18 + TypeScript | `src/` 为网页、Windows 与 Android 共用代码，界面保持中文；英语打卡数据仍独立保存在 `State.english`。 |
| 网页/PWA | Web App Manifest + `public/sw.js` | Service Worker 提供安装和基础离线缓存，不负责后台定时调度。 |
| Windows | Electron + electron-updater | 打包后加载同一份 `dist/`，启动时检查 GitHub Releases。 |
| Android | Capacitor Android | `npm run android:sync` 将同一份 `dist/` 同步到 Android 工程。 |
| 云端接口 | Vercel Serverless `api/*` | 登录、会话、状态读写均经过 Vercel，不把 Supabase service-role key 放到客户端。 |
| 数据库 | Supabase PostgreSQL | `app_users`、`app_sessions`、`user_states`；学习状态以每用户一份 `JSONB` 快照保存。 |
| 本机数据 | `localStorage` + 状态 reducer | 断网仍可学习；恢复网络后尝试上传状态快照。 |
| Office 材料 | `docx`、`xlsx`、`pptxgenjs`、`jszip` | 生成可编辑 DOCX/XLSX/PPTX，不使用图片或 PDF 冒充材料。 |
| 讲题语音 | 浏览器/系统 Web Speech API | 使用 `SpeechSynthesis`，优先识别中文 Online/Natural 神经音色（如晓晓/云希），不下载或内置第三方声音包。 |

## 云同步与密钥隔离

`settings.ai.apiKey` 是当前设备私密配置，不是学习数据。

- 上传前，`src/services/cloud.ts` 会生成不含 API Key 的快照副本。
- 下载时同样无条件清空远端快照中的 API Key，覆盖历史版本可能错误上传的旧密钥。
- 若当前设备原本已经配置 API Key，状态合并时始终保留本机值；云端的空值或旧值都不能覆盖它。
- 云端服务端凭据只存在 Vercel 环境变量。用户 API Key 目前保存在设备本机状态中，因此应由设备所有者自行保护。

## 数据迁移与回滚

这次没有新增 Supabase 表，也没有执行删除性 SQL。原因是 `user_states.state` 已是 JSONB 快照，新增字段由 `normalizeState()` 兼容补齐。

| 内容 | V3 存储位置 | 升级策略 |
| --- | --- | --- |
| 实操题作答 | `State.officeSubmissions` | 新增字段；刷新、重开和云同步后保留。 |
| 旧实操成绩 | `State.legacyOfficeResults` | 从旧 `officeResults` 复制保留，不与新版材料题混淆。 |
| 题库版本 | `State.officeBankVersion` | 当前为 `3`，用于区分材料题库版本。 |
| 定时提醒 | `State.schedules` | 旧记录补齐 `Asia/Shanghai`、重复、通知和声音字段；旧任务默认静音，避免升级后突然播报。 |
| 讲题语音偏好 | `State.settings.speech` | 保存开关、语速、声音标识和普通话偏好。 |

旧实操题数据已备份为 `public/data/office-tasks.v2.backup.json`，备份 SHA-256 为 `FE8A4D675FDEEFF95D37AA71BB2829D19A408A91A6927FEB82A7D1175BDD7C13`。已发布的 `public/data/office-tasks.json` 现在是空的归档占位数据，V3 页面只加载 `public/data/office-question-bank.v3.json`；旧成绩不会在升级时删除。

回滚时应先在“设置”导出用户数据，再运行 `node scripts/restore-office-tasks-v2.mjs`，发布包含旧页面/加载器的上一版本，并保留 V3 文件与 V2 备份。旧版本会忽略未知 JSON 字段，因此不需要回滚数据库结构。

## 实操大题库

主要依据为山东省教育招生考试院 2025-11-29 发布的《山东省2026年普通高等教育专科升本科招生考试公共基础课考试要求》。公告链接：<https://www.sdzk.cn/NewsInfo.aspx?NewsID=7081>；原 PDF：<https://www.sdzk.cn/Floadup/file/20251129/6389999945835892448300421.pdf>；核验 SHA-256：`BD8650968562B9A06CB6FCA32A99D0525BC252F9BE1E80C1531F8A40E015CBCE`。

题库共 24 题，Word、Excel、PowerPoint 各 8 题，按官方列明的 Word 2016、Excel 2016、PowerPoint 2016 实操能力均衡覆盖。全部题目和材料为“原创同类型题”，没有复制、转载或公开发布历年真题、培训机构原题。每题 JSON 中均保留 `sourceType`、`sourceTitle`、`sourceOrganization`、`sourceYear`、`sourceUrl`、`license` 与 `copyrightNote` 字段。

| 题号 | 软件 | 题目 |
| --- | --- | --- |
| Q01 | Word | 会议通知规范排版 |
| Q02 | Word | 实训报告样式与目录 |
| Q03 | Word | 招生计划表制作与计算 |
| Q04 | Word | 校园新闻图文混排 |
| Q05 | Word | 奖学金通知邮件合并 |
| Q06 | Word | 实验报告题注与交叉引用 |
| Q07 | Word | 分节页眉页码设置 |
| Q08 | Word | 协同修订与批注核对 |
| Q09 | Excel | 社团报名数据整理 |
| Q10 | Excel | 成绩统计绝对引用 |
| Q11 | Excel | 课程成绩条件判定 |
| Q12 | Excel | 活动报名排序筛选 |
| Q13 | Excel | 销售明细分类汇总 |
| Q14 | Excel | 项目经费数据透视表 |
| Q15 | Excel | 月度成绩图表展示 |
| Q16 | Excel | 考场座次表页面打印 |
| Q17 | PowerPoint | 校园开放日演示文稿 |
| Q18 | PowerPoint | 实训课件母版统一 |
| Q19 | PowerPoint | 学习流程 SmartArt 图示 |
| Q20 | PowerPoint | 课程目标对象动画 |
| Q21 | PowerPoint | 资源导航超链接页面 |
| Q22 | PowerPoint | 课程结构切换与放映 |
| Q23 | PowerPoint | 答辩讲稿与备注页 |
| Q24 | PowerPoint | 图表数据与版式优化 |

每题均有学生材料和参考答案材料各一份，共 48 个文件，路径位于 `public/office-materials/v3/`；文件名以 `Qxx_软件_题名_学生材料` 或 `Qxx_软件_题名_参考答案` 开头。页面提供题目要求、材料说明、学生文件下载、任务目标、来源和版权信息。

学生模式的正常流程是“下载材料并完成操作 -> 填写客观核对项 -> 得到正确/错误判定 -> 解锁参考答案、评分标准和答案文件”。教师/答案模式可直接查看教学答案。客观核对只能验证题设中的可文本化项目；页边距、对象位置、分页、修订痕迹、动画、切换等必须由教师在 Microsoft Office 或 WPS 中打开文件人工复核。

学生模式是产品流程限制，不是防御开发者工具或直接 URL 访问的安全边界：题库和材料目前作为可离线静态资源发布，具备 URL 的人仍可能直接访问文件。若需要防作弊访问控制，应将答案元数据和答案文件移到受认证的服务端下载接口，这会改变当前离线可用设计。

## Office 文件生成与验证

运行下列命令可重新生成题库清单和全部材料：

```powershell
node scripts/generate-office-materials.mjs
```

需要验证可重复生成时，运行：

```powershell
node scripts/verify-office-materials.mjs
```

该校验会连续生成两次，并逐个比较 48 个材料文件的 SHA-256。

生成器使用固定题目、固定数据、固定时间元数据和固定文件名，并输出 `public/data/office-materials.v3.validation.json`。该清单记录 24 题、48 个文件、字节数与 SHA-256，用于发布前完整性检查。

- DOCX/PPTX 会检查 OOXML 容器中的核心文档入口；XLSX 会通过 `xlsx` 重新读取并检查所需工作表。
- `tests/office-materials.test.ts` 会检查题目数量、来源字段、学生/答案文件一一对应、哈希、可读容器与客观判题契约。
- 这些自动检查证明文件不是图片/PDF，并能作为 Office Open XML 容器读取；它们不能替代用 Microsoft Office 或 WPS 对版式和高级交互效果的人工验收。
- 特别是原生数据透视表缓存、Word 修订记录、PowerPoint 动画和切换效果属于 Office 客户端特性，库生成的参考内容和页面文字不能替代实际打开后的人工复核。不能稳定自动生成的效果会保留明确的操作目标/参考说明，而不伪称已经自动完成。

## AI 数字讲题语音

“AI 数字讲题”使用设备的 `SpeechSynthesis`：可以随时打开或关闭，支持朗读、暂停、继续、停止、重新播放、0.75/1/1.25/1.5 倍速、刷新声音和选择可用音色。默认优先中文 Online/Natural 自然音色，再回退到普通话；朗读时当前句子会高亮。语音设置随本机状态保存，刷新和重新打开后仍在。设置页的“启用语音朗读”是总开关，AI 讲题页和每条安排任务还提供独立开关；关闭总开关会停止正在进行的语音朗读，但不会关闭任务单独选择的“短提示音”。

设备不支持 Web Speech API、系统没有普通话音色、浏览器限制媒体播放或语音服务失败时，界面会显示中文原因，文字讲解始终保留。当前没有下载或打包本地声音模型，也没有接入来源不明的语音文件。

如未来评估本地模型，只能在逐个模型确认权利、版本、来源、商用/项目许可、模型权重许可证和安全校验后再引入。已做过代码许可证核对的 Piper 为 MIT、sherpa-onnx 为 Apache-2.0，但两者本身不等于其任意模型权重都可直接使用；本版本未安装任何模型或语音包。

## 已安排任务与通知限制

任务在 `Asia/Shanghai`（北京时间）计算，支持一次、每天、每周和每 N 天自定义重复，保存任务名称、内容、日期、时间、提前提醒、通知/语音开关和辅助提示音。到点后应用内弹窗始终是兜底；网页/Electron 在获得权限时会使用 Notification API，Android 使用 Capacitor Local Notifications 排入未来 31 天的系统通知，并在应用启动、任务变更或授权后重新覆盖这段窗口。任务可测试提醒、完成、稍后提醒、关闭、编辑、删除、暂停/恢复，并保存历史。任务语音开关控制中文朗读，辅助短提示音是独立的任务级声音选项；全局语音总开关关闭时，Android 语音通知会静音，但独立短提示音仍按任务设置执行。

PWA Service Worker 仅做缓存，当前没有实现浏览器关闭后的后台定时音频或可靠调度。以下场景受环境限制，不能宣称可靠提醒：网页、Electron 应用或手机应用完全关闭；浏览器标签被冻结；系统休眠；电量优化/Android Doze 限制；浏览器拒绝通知；系统禁止通知或媒体播放。Android 系统通知可以在应用退到后台甚至进程被系统回收后显示，但本项目只预排未来 31 天；连续关闭超过该窗口后，需重新打开应用才能继续排程。重新打开应用后，调度器会检查逾期任务并显示应用内提醒，但这不是准点后台通知的替代品。使用者应保持应用运行，并通过每个任务旁的“测试提醒”验证本设备的通知和声音。

## 三端发布步骤

每次发布前先运行：

```powershell
npm run typecheck
npm test
npm run build
```

网页端：使用已配置的 GitHub Pages/Vercel 部署流程；本项目的 `deploy.bat` 可调用 Vercel 生产部署。若启用云同步，应先按 [CLOUD_SYNC.md](CLOUD_SYNC.md) 配置 Supabase、Vercel 环境变量和 CORS。

Android：先执行 `npm run android:sync`；本地调试 APK 使用 `npm run android:apk`。正式版本必须继续使用同一签名密钥并提高版本号，否则不能覆盖用户已有应用。

Windows：执行 `npm run desktop:installer` 生成 NSIS 安装包。推送 `v*` 标签会触发 `.github/workflows/release-installers.yml`，构建签名 APK、Windows 安装包并发布到 GitHub Releases；Windows 已安装程序在启动时检查该发布源。

发布后至少在网页、Windows 安装包和 Android 安装包各验证一次：题库文件下载并能由 Office/WPS 打开，讲题语音可关闭/开启，测试提醒可显示，云端登录后学习状态可恢复且 AI Key 未跨设备出现。
