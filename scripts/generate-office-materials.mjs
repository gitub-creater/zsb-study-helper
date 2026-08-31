/*
 * 生成山东专升本 Office 实操题库的可编辑材料。
 *
 * 设计约束：
 * - 题目为原创同类型题，不复制历年真题或机构原题。
 * - 输出完全确定：固定日期、固定数据、固定文件名，不使用随机数或当前时间。
 * - 每题生成学生初始材料与参考答案文件，并检查 OOXML / XLSX 可重读性。
 *
 * 运行：node scripts/generate-office-materials.mjs
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import {
  AlignmentType,
  Document,
  Footer,
  Header,
  HeadingLevel,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from 'docx'
import XLSX from 'xlsx'
import JSZip from 'jszip'
import PptxGenJS from 'pptxgenjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const publicDir = path.join(root, 'public')
const dataDir = path.join(publicDir, 'data')
const materialDir = path.join(publicDir, 'office-materials', 'v3')
const manifestPath = path.join(dataDir, 'office-question-bank.v3.json')
const validationPath = path.join(dataDir, 'office-materials.v3.validation.json')

const CREATED_AT = '2026-08-31T00:00:00.000Z'
const OOXML_TIMESTAMP = '2026-08-31T00:00:00Z'
const OOXML_DATE = new Date(OOXML_TIMESTAMP)
const OFFICIAL_URL = 'https://www.sdzk.cn/NewsInfo.aspx?NewsID=7081'
const OFFICIAL_PDF_URL = 'https://www.sdzk.cn/Floadup/file/20251129/6389999945835892448300421.pdf'
const OFFICIAL_SHA256 = 'BD8650968562B9A06CB6FCA32A99D0525BC252F9BE1E80C1531F8A40E015CBCE'
const SOURCE = {
  sourceType: '原创同类型题',
  sourceTitle: '山东省2026年普通高等教育专科升本科招生考试公共基础课考试要求',
  sourceOrganization: '山东省教育招生考试院',
  sourceYear: 2026,
  sourceUrl: OFFICIAL_URL,
  license: '题目与材料为本项目原创；官方考试要求仅作为公开依据链接引用。',
  copyrightNote: '未复制、转载或公开发布历年真题及培训机构原题；按官方列出的 Word 2016、Excel 2016、PowerPoint 2016 能力范围创作。',
}

const score = (items) => items.map(([item, points, criterion]) => ({ item, points, criterion }))
const check = (id, prompt, type, answer, explanation, options) => ({ id, prompt, type, answer, explanation, ...(options ? { options } : {}) })

/** 每一题均有至少两个可客观判定的检查点；版式和视觉要求仍需学生按评分标准人工复核。 */
const specs = [
  {
    software: 'word', title: '会议通知规范排版', category: '文档编辑与字符段落格式', difficulty: '基础',
    knowledgePoints: ['Word 2016 文本编辑', '字符格式', '段落格式', '查找替换'],
    prompt: '根据学生材料中的会议通知草稿，完成标题、正文、落款和日期的规范排版；把文中所有“计院”替换为“计算机学院”，并保留通知正文的完整信息。',
    materials: ['学生材料含会议通知草稿、活动安排和落款信息。', '材料中“计院”共出现 3 次，需使用查找和替换功能统一修改。'],
    taskSteps: ['设置标题为二号、加粗、居中；正文为小四号并设置首行缩进。', '使用查找和替换将“计院”全部替换为“计算机学院”。', '将落款右对齐，日期置于落款下一行；保存为指定文件名。'],
    referenceAnswer: ['标题使用居中且加粗，正文保持段落层级清楚。', 'Ctrl+H 执行全部替换后，应提示替换 3 处。', '落款和日期在页面右下方形成两行结构。'],
    scoringRubric: score([['标题与正文格式', 4, '标题居中加粗，正文大小和缩进符合要求'], ['查找替换', 3, '“计院”3处均替换为“计算机学院”'], ['落款与保存', 3, '落款右对齐、日期位置正确且文件可打开']]),
    commonMistakes: ['只手动修改一处文字，遗漏其他“计院”。', '将正文整段居中，破坏通知版式。'],
    checks: [check('c1', '批量修改“计院”应优先使用哪个快捷键？', 'single', 'B', '“替换”快捷键是 Ctrl+H。', ['Ctrl+F', 'Ctrl+H', 'Ctrl+G', 'Ctrl+P']), check('c2', '本题材料中“计院”应替换为哪个完整名称？', 'fill', '计算机学院', '统一替换为“计算机学院”。')],
    body: ['关于开展计算机应用能力训练营的通知', '各班同学：', '为提升计院学生的 Office 实操能力，计院拟于本周五开展训练营。请计院各班学习委员统计参加人员，于周四17:00前报送名单。', '活动时间：9月12日 14:00—16:30', '活动地点：实训楼 302 机房', '联系人：李老师  联系电话：0531-88886666', '计算机学院学生工作办公室', '2026年9月8日'],
  },
  {
    software: 'word', title: '实训报告样式与目录', category: '长文档排版', difficulty: '进阶',
    knowledgePoints: ['Word 2016 样式', '多级列表', '目录', '分页与分节'],
    prompt: '将学生材料整理为《Excel 数据分析实训报告》的长文档框架，应用标题样式、设置多级编号，并在封面后插入自动目录。',
    materials: ['学生材料提供报告封面信息、三级章节标题和两段正文。', '材料中的章节标题尚未应用任何样式。'],
    taskSteps: ['封面单独成页，报告名称居中显示。', '对一级、二级、三级标题应用对应标题样式并设置编号。', '在封面后分页插入自动目录，更新后能显示章节页码。'],
    referenceAnswer: ['标题样式应使用 Word 内置“标题 1/2/3”，而不是只手动设置字体。', '自动目录插入后可通过“更新目录”刷新页码。', '封面与目录、正文之间使用分页符保持结构。'],
    scoringRubric: score([['封面与分页', 2, '封面独立成页'], ['标题样式和编号', 5, '三级标题层级清晰且编号连续'], ['自动目录', 3, '目录可更新并含页码']]),
    commonMistakes: ['只改变字号却没有套用标题样式，导致目录无法生成。', '用空行挤出新页，后续编辑时版式错乱。'],
    checks: [check('c1', '自动目录依赖哪类设置？', 'single', 'A', '目录会读取标题样式层级。', ['标题样式', '艺术字', '文本框', '批注']), check('c2', '插入新内容导致页码变化后，应使用什么操作？', 'fill', '更新目录|更新', '通过“更新目录”刷新页码。')],
    body: ['Excel 数据分析实训报告', '第一章 实训目标', '1.1 数据分析任务', '1.1.1 数据来源', '本次实训使用校园活动报名数据，练习公式、筛选和图表的综合应用。', '第二章 操作过程', '2.1 数据整理', '2.2 结果展示', '第三章 实训总结', '通过本次实训，掌握了数据处理的基本流程。'],
  },
  {
    software: 'word', title: '招生计划表制作与计算', category: '表格与数据处理', difficulty: '进阶',
    knowledgePoints: ['Word 2016 表格', '单元格合并', '表格对齐', '公式'],
    prompt: '根据材料制作“专业招生计划汇总表”，完成表头合并、表格对齐和总计划数计算，并让表格在页面中居中。',
    materials: ['学生材料含 4 个专业的招生计划数据和表格草稿。', '表格草稿没有合并表头，也没有总计行。'],
    taskSteps: ['按材料要求合并第一行表头，设置列标题。', '插入总计行，用表格公式或计算结果填入总计划数。', '表格整体居中，表头文字居中，数据列对齐一致。'],
    referenceAnswer: ['第一行作为汇总表头，第二行显示“专业名称、普通计划、建档立卡、合计”。', '总计划数为 120，需与各专业合计相符。', '表格属性中设置居中，不能只用空格移动。'],
    scoringRubric: score([['表头结构', 3, '合并和列标题正确'], ['数据与总计', 4, '数据完整，总计划为120'], ['表格版式', 3, '居中、对齐、边框清晰']]),
    commonMistakes: ['使用空格调整表格位置。', '合计行漏算建档立卡计划。'],
    checks: [check('c1', '本题各专业计划的总计应为多少？', 'fill', '120', '四个专业计划相加为120。'), check('c2', '在 Word 中让整个表格居中，应优先设置什么？', 'single', 'C', '应在表格属性中设置对齐方式。', ['段落首行缩进', '空格', '表格属性对齐方式', '字体颜色'])],
    body: ['专业招生计划汇总表', '请根据以下数据制作表格：', '计算机科学与技术：普通计划 32，建档立卡 3', '软件工程：普通计划 28，建档立卡 2', '网络工程：普通计划 25，建档立卡 2', '数字媒体技术：普通计划 24，建档立卡 4'],
  },
  {
    software: 'word', title: '校园新闻图文混排', category: '图文混排与对象编辑', difficulty: '进阶',
    knowledgePoints: ['Word 2016 图片', '文字环绕', '形状', '文本框'],
    prompt: '将校园新闻材料排版为一页简报：插入图片占位框、设置四周型文字环绕，并用文本框突出活动时间和地点。',
    materials: ['学生材料含新闻正文、图片说明和活动信息。', '图片可使用材料中的“活动现场图片占位”文字框替代，重点考查对象布局。'],
    taskSteps: ['在正文右侧插入图片或图片占位框，设置四周型环绕。', '添加图片题注“图1 训练营活动现场”。', '使用文本框突出活动时间和地点，避免遮挡正文。'],
    referenceAnswer: ['图片环绕方式为四周型或紧密型，正文可围绕对象流动。', '题注应与图片建立对应关系。', '文本框应放在正文下方或空白区域，确保可读性。'],
    scoringRubric: score([['图片与环绕', 4, '图片/占位框位置合理且文字环绕正确'], ['题注', 2, '题注内容完整'], ['文本框布局', 4, '活动信息突出且不遮挡正文']]),
    commonMistakes: ['保持“嵌入型”导致无法自由排版。', '用多个空格挤出图片位置。'],
    checks: [check('c1', '让正文围绕图片排版，应设置哪一类功能？', 'single', 'B', '应在图片布局选项中设置文字环绕。', ['页眉页脚', '文字环绕', '拼写检查', '邮件合并']), check('c2', '本题图片题注应以哪个编号开头？', 'fill', '图1|图 1', '题注为“图1 训练营活动现场”。')],
    body: ['训练营活动简报', '9月12日下午，计算机学院在实训楼302机房举办 Office 实操训练营。活动围绕文档排版、电子表格与演示文稿制作展开，参加同学完成了分组练习和成果展示。', '活动现场图片占位', '活动时间：9月12日 14:00—16:30', '活动地点：实训楼302机房'],
  },
  {
    software: 'word', title: '奖学金通知邮件合并', category: '邮件合并与批量文档', difficulty: '综合',
    knowledgePoints: ['Word 2016 邮件合并', '数据源', '合并域', '批量输出'],
    prompt: '使用学生材料中的获奖名单，创建奖学金获奖通知模板，插入姓名、班级、奖项等合并域，并完成批量合并预览。',
    materials: ['学生材料含通知正文模板和 5 名获奖学生数据。', '数据源字段包括姓名、班级、奖项、金额。'],
    taskSteps: ['将获奖名单整理为可用数据源。', '在通知模板中插入四个合并域。', '预览记录并完成合并，确保每位学生收到对应信息。'],
    referenceAnswer: ['合并域应插入在姓名、班级、奖项、金额对应位置。', '预览时应出现不同学生的数据，而不是字段名称。', '批量合并前保留原始模板文件。'],
    scoringRubric: score([['数据源', 3, '字段和记录完整'], ['合并域', 4, '四个字段位置正确'], ['预览和输出', 3, '至少完成预览并核对一条记录']]),
    commonMistakes: ['直接手动复制五份通知。', '将字段名称手打在正文中而未插入合并域。'],
    checks: [check('c1', '邮件合并时，姓名等可变内容应插入为什么？', 'fill', '合并域', '可变内容应使用合并域。'), check('c2', '预览邮件合并记录的目的是什么？', 'single', 'D', '用于核对每条记录是否正确带入。', ['修改字体', '删除数据源', '压缩图片', '核对字段带入结果'])],
    body: ['奖学金获奖通知', '尊敬的【姓名】同学：', '祝贺你荣获【奖项】。你所在班级为【班级】，奖学金金额为【金额】元。请按学院通知办理相关手续。', '计算机学院学生工作办公室'],
  },
  {
    software: 'word', title: '实验报告题注与交叉引用', category: '文档引用与审阅', difficulty: '综合',
    knowledgePoints: ['Word 2016 题注', '交叉引用', '编号', '引用更新'],
    prompt: '为实验报告中的两张图和一张表插入题注，在正文中使用交叉引用说明“见图1、表1”，并验证编号可自动更新。',
    materials: ['学生材料含实验现象描述、图形占位和数据表。', '当前文中“见下图”“见下表”为普通文本。'],
    taskSteps: ['为两个图形和一个表格分别插入自动题注。', '将正文中的普通引用改为交叉引用。', '新增一个图后更新域，观察编号变化。'],
    referenceAnswer: ['题注应使用“插入题注”，而非手动键入编号。', '交叉引用可以随题注编号变化自动更新。', '图、表编号分别从1开始。'],
    scoringRubric: score([['题注', 4, '图1、图2、表1题注完整'], ['交叉引用', 4, '正文引用可跳转且能更新'], ['编号验证', 2, '完成一次更新验证']]),
    commonMistakes: ['手动输入“图1”，后续插图后编号不能更新。', '图和表使用同一个编号序列。'],
    checks: [check('c1', '要让编号随插图自动变化，应使用什么功能？', 'single', 'A', '应使用“题注”。', ['插入题注', '文本框', '页码', '批注']), check('c2', '正文中引用“图1”且能自动更新，应使用什么？', 'fill', '交叉引用', '使用交叉引用关联题注。')],
    body: ['实验结果分析', '如图1所示，数据呈上升趋势；详见下表。', '图形占位 A', '图形占位 B', '数据表占位'],
  },
  {
    software: 'word', title: '分节页眉页码设置', category: '页面布局', difficulty: '综合',
    knowledgePoints: ['Word 2016 分节符', '页眉页脚', '页码', '页面设置'],
    prompt: '将毕业设计材料设置为封面无页码、目录使用罗马数字、正文从第1页开始阿拉伯数字，并在正文页眉显示“计算机应用实训”。',
    materials: ['学生材料含封面、目录占位和正文三部分文字。', '当前所有内容处于同一节。'],
    taskSteps: ['在封面后、目录后插入分节符。', '取消正文与前一节链接，分别设置页码格式。', '正文页眉显示指定文字，封面不显示页码。'],
    referenceAnswer: ['需至少划分封面、目录、正文三个节。', '目录页码格式可设为 i、ii，正文从1开始。', '页眉页脚“链接到前一节”应按需要取消。'],
    scoringRubric: score([['分节', 3, '分节符位置正确'], ['页码', 4, '三段页码规则符合要求'], ['页眉', 3, '仅正文显示指定页眉']]),
    commonMistakes: ['用分页符代替分节符，导致页码格式无法独立。', '未取消“链接到前一节”。'],
    checks: [check('c1', '需要让目录与正文使用不同页码格式，应插入什么？', 'fill', '分节符|分节', '不同页码规则依赖分节。'), check('c2', '取消与上一节相同的页眉页脚，应关闭哪个选项？', 'single', 'C', '关闭“链接到前一节”。', ['显示标尺', '网格线', '链接到前一节', '阅读模式'])],
    body: ['毕业设计材料', '目录', '第一章 项目概述', '本项目围绕校园预约系统进行需求分析和实现。', '第二章 系统设计', '正文内容从此处开始。'],
  },
  {
    software: 'word', title: '协同修订与批注核对', category: '文档协同编辑', difficulty: '进阶',
    knowledgePoints: ['Word 2016 修订', '批注', '比较', '接受修订'],
    prompt: '对课程安排文档开启修订，修改两处时间并添加一条批注；随后接受第一处修订、保留第二处修订以便教师复核。',
    materials: ['学生材料含两处过期时间和一处需要说明的课程安排。', '需在不丢失修改痕迹的前提下完成编辑。'],
    taskSteps: ['开启修订后修改指定时间。', '对“机房预约”段落添加说明性批注。', '接受第一处修订并保留第二处修订记录。'],
    referenceAnswer: ['修订开启后，修改会显示为插入/删除标记。', '批注不应直接写入正文。', '接受或拒绝应针对指定修订，不能一次全部接受。'],
    scoringRubric: score([['修订记录', 4, '两处修改均留下可追踪痕迹'], ['批注', 2, '批注位置和内容合理'], ['选择性接受', 4, '仅第一处修订被接受']]),
    commonMistakes: ['直接修改后再尝试恢复修订记录。', '点击“接受所有更改”导致第二处痕迹丢失。'],
    checks: [check('c1', '保留文字修改痕迹应开启哪项功能？', 'fill', '修订', '应在“审阅”中开启修订。'), check('c2', '本题要求接受几处修订？', 'fill', '1|一', '只接受第一处修订。')],
    body: ['课程安排调整说明', '原定9月15日14:00的 Word 实训调整为9月16日14:00。', '原定9月17日9:00的 Excel 实训调整为9月18日9:00。', '机房预约：请各班学习委员提前一天提交名单。'],
  },
  {
    software: 'excel', title: '社团报名数据整理', category: '工作表与数据编辑', difficulty: '基础',
    knowledgePoints: ['Excel 2016 工作簿', '单元格格式', '数据输入', '填充'],
    prompt: '整理学生材料中的社团报名原始数据，补全序号、设置日期和手机号显示格式，并冻结首行以便查看表头。',
    materials: ['学生材料含 12 条社团报名数据，字段包括姓名、班级、报名日期、手机号。', '日期和手机号列当前格式不统一。'],
    taskSteps: ['补全连续序号。', '将报名日期设置为 yyyy-mm-dd 格式。', '手机号以文本或自定义格式完整显示，冻结首行。'],
    referenceAnswer: ['序号应从1连续到12。', '日期统一为 yyyy-mm-dd。', '冻结首行后向下滚动仍可见表头。'],
    scoringRubric: score([['序号与数据完整性', 3, '连续且不漏行'], ['格式', 4, '日期、手机号格式统一'], ['视图', 3, '首行冻结有效']]),
    commonMistakes: ['手机号被显示为科学计数法。', '冻结的是第一列而非首行。'],
    checks: [check('c1', '本题报名记录共有多少条？', 'fill', '12', '原始数据为12条。'), check('c2', '向下滚动时保留表头，应使用什么功能？', 'fill', '冻结窗格|冻结首行', '使用“冻结窗格/冻结首行”。')],
  },
  {
    software: 'excel', title: '成绩统计绝对引用', category: '公式与单元格引用', difficulty: '进阶',
    knowledgePoints: ['Excel 2016 公式', '相对引用', '绝对引用', '填充柄'],
    prompt: '计算学生总评成绩：平时成绩占30%，期末成绩占70%。权重存放在固定单元格中，要求公式向下填充后权重引用不变。',
    materials: ['学生材料含10名学生的平时和期末成绩，以及权重单元格。', '总评列为空。'],
    taskSteps: ['在首行总评单元格写入计算公式。', '对权重单元格使用绝对引用。', '向下填充并保留一位小数。'],
    referenceAnswer: ['示例公式：=B2*$H$2+C2*$H$3。', 'B2/C2为相对引用，权重H2/H3为绝对引用。', '填充后每一行都对应本行成绩。'],
    scoringRubric: score([['公式正确', 4, '首行公式逻辑正确'], ['绝对引用', 3, '权重引用带$符号'], ['填充与格式', 3, '10行结果完整且一位小数']]),
    commonMistakes: ['未锁定权重，向下填充后引用区域下移。', '把30%写成30参与计算。'],
    checks: [check('c1', '固定引用 H2 的正确写法是？', 'single', 'C', '绝对引用使用 $H$2。', ['H2', 'H$2', '$H$2', '$H2']), check('c2', '总评中期末成绩权重是多少？', 'fill', '70%|0.7', '期末成绩权重为70%。')],
  },
  {
    software: 'excel', title: '课程成绩条件判定', category: '函数应用', difficulty: '进阶',
    knowledgePoints: ['Excel 2016 IF 函数', 'COUNTIF', '条件格式'],
    prompt: '根据成绩表在“结果”列显示“合格/需补考”，并统计需补考人数；对不合格成绩使用条件格式突出显示。',
    materials: ['学生材料含12名学生的计算机基础成绩。', '合格线为60分。'],
    taskSteps: ['使用 IF 函数判定每名学生。', '使用 COUNTIF 统计“需补考”人数。', '为低于60分的成绩设置醒目条件格式。'],
    referenceAnswer: ['结果列公式：=IF(C2>=60,"合格","需补考")。', '统计公式可为 =COUNTIF(D2:D13,"需补考")。', '条件格式规则基于单元格值小于60。'],
    scoringRubric: score([['IF 公式', 4, '每行判定正确'], ['人数统计', 3, '统计范围和条件正确'], ['条件格式', 3, '不合格成绩突出显示']]),
    commonMistakes: ['IF 文本参数遗漏英文双引号。', 'COUNTIF 范围包含统计结果单元格。'],
    checks: [check('c1', '成绩为60分时，本题结果应显示什么？', 'fill', '合格', '60分及以上为合格。'), check('c2', '统计“需补考”人数应使用哪个函数？', 'fill', 'COUNTIF', 'COUNTIF 用于按条件计数。')],
  },
  {
    software: 'excel', title: '活动报名排序筛选', category: '数据处理', difficulty: '进阶',
    knowledgePoints: ['Excel 2016 排序', '筛选', '自定义排序', '数据验证'],
    prompt: '对活动报名表按学院、报名日期排序，筛选出“计算机学院”且状态为“已确认”的学生，并为状态列设置下拉选项。',
    materials: ['学生材料含15条报名记录，包含学院、报名日期、状态等字段。', '状态值包含“待确认、已确认、取消”。'],
    taskSteps: ['先按学院升序，再按报名日期升序排序。', '使用自动筛选显示符合双条件的记录。', '为状态列设置数据验证下拉列表。'],
    referenceAnswer: ['多关键字排序需在排序对话框中添加层级。', '筛选条件同时为“计算机学院”和“已确认”。', '数据验证来源可输入“待确认,已确认,取消”。'],
    scoringRubric: score([['多关键字排序', 3, '学院、日期顺序正确'], ['筛选结果', 4, '双条件准确'], ['数据验证', 3, '状态列有可用下拉选项']]),
    commonMistakes: ['只使用单列排序。', '手动删除不符合条件的行。'],
    checks: [check('c1', '本题筛选需要同时满足几项条件？', 'fill', '2|二', '学院和状态为两项条件。'), check('c2', '为状态列提供固定可选值，应使用什么功能？', 'fill', '数据验证', '通过数据验证创建下拉列表。')],
  },
  {
    software: 'excel', title: '销售明细分类汇总', category: '数据汇总', difficulty: '综合',
    knowledgePoints: ['Excel 2016 分类汇总', '排序', 'SUM 函数', '分级显示'],
    prompt: '按商品类别整理销售明细，先排序再执行分类汇总，分别计算每类销售额与总销售额。',
    materials: ['学生材料含3个商品类别、18条销售记录。', '每条记录包含类别、商品、数量、单价和销售额。'],
    taskSteps: ['按“类别”列排序。', '以类别为分类字段，对销售额求和。', '检查分级显示中各类别小计和总计。'],
    referenceAnswer: ['分类汇总前必须按分类字段排序。', '汇总方式为求和，汇总项为销售额。', '可使用左侧分级按钮查看明细或小计。'],
    scoringRubric: score([['排序准备', 2, '先按类别排序'], ['分类汇总', 5, '类别小计和总计正确'], ['分级显示', 3, '可切换小计/明细视图']]),
    commonMistakes: ['未排序直接分类汇总，导致同类记录被拆分。', '对数量而非销售额求和。'],
    checks: [check('c1', '执行分类汇总前必须先做什么？', 'fill', '排序', '需按分类字段排序。'), check('c2', '本题分类汇总的汇总方式是？', 'single', 'A', '销售额使用求和。', ['求和', '计数', '平均值', '最大值'])],
  },
  {
    software: 'excel', title: '项目经费数据透视表', category: '数据透视表', difficulty: '综合',
    knowledgePoints: ['Excel 2016 数据透视表', '字段布局', '汇总方式', '筛选'],
    prompt: '根据项目经费明细创建数据透视表：行字段为项目类别，列字段为季度，值字段为金额求和，并筛选“已结项”项目。',
    materials: ['学生材料含项目类别、季度、金额、状态四个字段。', '原始数据共16条，状态包括“进行中、已结项”。'],
    taskSteps: ['选择完整数据区域创建数据透视表。', '拖放类别、季度、金额、状态字段到指定区域。', '设置状态筛选为“已结项”，核对汇总结果。'],
    referenceAnswer: ['金额字段汇总方式为“求和”，不是“计数”。', '状态字段放入筛选区域。', '数据源变化后可使用“刷新”更新透视表。'],
    scoringRubric: score([['数据透视表创建', 3, '源数据区域正确'], ['字段布局', 5, '行/列/值/筛选字段正确'], ['状态筛选', 2, '仅保留已结项项目']]),
    commonMistakes: ['把金额放入行标签而非值区域。', '数据区域遗漏标题行。'],
    checks: [check('c1', '金额字段在数据透视表中应采用哪种汇总方式？', 'fill', '求和', '金额要做求和汇总。'), check('c2', '本题“状态”字段应放在哪个区域？', 'fill', '筛选|筛选区域', '状态用于筛选已结项项目。')],
  },
  {
    software: 'excel', title: '月度成绩图表展示', category: '图表', difficulty: '进阶',
    knowledgePoints: ['Excel 2016 图表', '数据源', '图表标题', '坐标轴'],
    prompt: '根据月度成绩统计数据创建簇状柱形图，设置图表标题、数据标签和坐标轴标题，并将图表放置在“图表展示”工作表。',
    materials: ['学生材料含4个月的平均分和及格率数据。', '图表展示工作表为空。'],
    taskSteps: ['选择月份、平均分、及格率数据并创建图表。', '设置标题为“月度成绩分析”。', '添加数据标签与横、纵坐标轴标题。'],
    referenceAnswer: ['图表类型可使用簇状柱形图，数据源应含标题行。', '数据标签用于直接显示数值。', '图表应放置在指定工作表且不遮挡数据。'],
    scoringRubric: score([['图表类型与数据源', 4, '类型和数据区域正确'], ['标题与标签', 3, '标题、数据标签完整'], ['图表布局', 3, '放置在图表展示表且布局清楚']]),
    commonMistakes: ['只选数值列，遗漏月份分类标签。', '把图表做成静态截图。'],
    checks: [check('c1', '本题要求使用哪种图表类型？', 'fill', '簇状柱形图|柱形图', '使用簇状柱形图展示月度对比。'), check('c2', '图表标题应为？', 'fill', '月度成绩分析', '标题指定为“月度成绩分析”。')],
  },
  {
    software: 'excel', title: '考场座次表页面打印', category: '页面布局与打印', difficulty: '进阶',
    knowledgePoints: ['Excel 2016 页面布局', '打印区域', '分页', '页眉页脚'],
    prompt: '将考场座次表设置为横向打印、每页重复标题行，并设置打印区域和页码页脚，使每页可独立阅读。',
    materials: ['学生材料含40名考生座次数据，表格较宽。', '需要按A4横向打印。'],
    taskSteps: ['设置页面方向为横向，并调整页边距。', '设置打印区域，必要时缩放为一页宽。', '设置顶端标题行和页脚页码。'],
    referenceAnswer: ['宽表适合横向，打印区域不应含空白列。', '顶端标题行使每页重复显示字段名称。', '页脚可插入“第 &P 页，共 &N 页”。'],
    scoringRubric: score([['页面设置', 3, '横向、页边距合适'], ['打印区域与标题', 4, '区域和重复标题行正确'], ['页脚与预览', 3, '页码有效且预览可读']]),
    commonMistakes: ['只在普通视图调整列宽，未检查打印预览。', '把标题行也缩放得不可读。'],
    checks: [check('c1', '宽表打印本题应设置为哪种方向？', 'fill', '横向', '要求A4横向打印。'), check('c2', '每页重复表头应设置什么？', 'fill', '顶端标题行|打印标题', '设置顶端标题行或打印标题。')],
  },
  {
    software: 'ppt', title: '校园开放日演示文稿', category: '幻灯片创建与版式', difficulty: '基础',
    knowledgePoints: ['PowerPoint 2016 新建演示文稿', '版式', '主题', '幻灯片管理'],
    prompt: '根据材料创建4页“校园开放日”演示文稿，选择统一主题，使用合适版式，并按要求调整幻灯片顺序。',
    materials: ['学生材料提供封面、学院概况、实训环境、咨询方式四页文字。', '初始 PPT 已提供4页文本草稿。'],
    taskSteps: ['为4页应用统一主题。', '封面使用标题幻灯片版式，其余页面选用合适内容版式。', '调整顺序为封面、学院概况、实训环境、咨询方式。'],
    referenceAnswer: ['主题应全篇统一，不要求使用特定主题名称。', '封面与内容页版式不同，结构清楚。', '使用缩略图窗格可拖动调整顺序。'],
    scoringRubric: score([['主题与版式', 4, '统一且版式合适'], ['页面内容', 3, '四页内容完整'], ['顺序', 3, '顺序符合要求']]),
    commonMistakes: ['每页使用不同主题。', '用复制粘贴而非调整幻灯片顺序。'],
    checks: [check('c1', '本题演示文稿共需完成多少页？', 'fill', '4|四', '共4页。'), check('c2', '封面页通常适用哪种版式？', 'fill', '标题幻灯片|标题', '封面使用标题幻灯片版式。')],
    slides: [['校园开放日', '山东专升本计算机学习系统'], ['学院概况', '专业方向\n师资力量\n学习支持'], ['实训环境', 'Office 实训机房\n项目化训练\n学习资料'], ['咨询方式', '咨询电话\n官方邮箱\n校园地址']],
  },
  {
    software: 'ppt', title: '实训课件母版统一', category: '母版与版式', difficulty: '进阶',
    knowledgePoints: ['PowerPoint 2016 幻灯片母版', '页眉页脚', '统一字体', '占位符'],
    prompt: '为“Office 实训课件”设置统一母版：统一标题字体和颜色，添加页脚信息与页码，并使已有内容页继承该版式。',
    materials: ['学生材料含3页内容幻灯片，字体和页脚不统一。', '要求页脚显示“计算机应用实训”。'],
    taskSteps: ['进入幻灯片母版，修改标题字体和主题色。', '在母版中配置页脚与页码。', '关闭母版视图后检查三页内容是否统一。'],
    referenceAnswer: ['母版修改会影响使用该版式的页面。', '页脚文字为“计算机应用实训”。', '页码应显示在内容页而非仅手动输入。'],
    scoringRubric: score([['母版修改', 4, '标题字体/色彩统一'], ['页脚与页码', 3, '内容正确且显示'], ['继承检查', 3, '至少3页样式一致']]),
    commonMistakes: ['逐页修改而没有进入母版。', '在普通视图手打页码。'],
    checks: [check('c1', '统一多页字体和页脚最适合使用什么？', 'fill', '幻灯片母版|母版', '应使用幻灯片母版。'), check('c2', '本题页脚文字是什么？', 'fill', '计算机应用实训', '页脚指定为“计算机应用实训”。')],
    slides: [['Office 实训课件', '统一母版练习'], ['Word 模块', '文本编辑\n文档排版\n表格与图文'], ['Excel 模块', '公式函数\n数据处理\n图表展示']],
  },
  {
    software: 'ppt', title: '学习流程 SmartArt 图示', category: '对象与 SmartArt', difficulty: '进阶',
    knowledgePoints: ['PowerPoint 2016 SmartArt', '形状', '对齐', '组合'],
    prompt: '将“诊断—计划—练习—复盘”四个步骤制作为流程型 SmartArt 图形，并添加一处强调形状说明“循环改进”。',
    materials: ['学生材料含4个流程步骤及其简短说明。', '初始 PPT 中只有普通文本列表。'],
    taskSteps: ['选择流程类 SmartArt，录入4个步骤。', '统一调整文字大小和图形颜色。', '添加强调形状，说明流程可循环改进。'],
    referenceAnswer: ['SmartArt 应使用流程结构而非项目符号列表。', '4步顺序不能颠倒。', '形状应与流程图对齐且不遮挡文字。'],
    scoringRubric: score([['SmartArt 流程', 5, '4个步骤和顺序正确'], ['样式', 2, '色彩与文字统一'], ['强调形状', 3, '内容、位置清楚']]),
    commonMistakes: ['插入普通图片代替 SmartArt，后续不可编辑。', '把“复盘”放在“练习”前。'],
    checks: [check('c1', '本题流程的第4步是什么？', 'fill', '复盘', '第4步为复盘。'), check('c2', '将层级文字转为流程图，应使用哪类对象？', 'fill', 'SmartArt', '使用流程类 SmartArt。')],
    slides: [['学习闭环', '诊断\n计划\n练习\n复盘']],
  },
  {
    software: 'ppt', title: '课程目标对象动画', category: '动画效果', difficulty: '进阶',
    knowledgePoints: ['PowerPoint 2016 动画', '动画窗格', '开始方式', '顺序'],
    prompt: '为课程目标页的标题和三条目标设置进入动画：标题先出现，三条目标按顺序依次出现；使用动画窗格检查顺序。',
    materials: ['学生材料含一个标题和三条课程目标。', '要求动画不超过4个对象，避免过度装饰。'],
    taskSteps: ['给标题设置一个进入动画。', '给三条目标设置进入动画，按单击或之后依次显示。', '在动画窗格中调整顺序为标题、目标1、目标2、目标3。'],
    referenceAnswer: ['对象动画在“动画”选项卡设置。', '标题必须排在第1个动画。', '动画窗格是核对顺序的依据。'],
    scoringRubric: score([['动画对象', 3, '标题和三条目标均有动画'], ['顺序', 4, '按指定次序播放'], ['动画窗格', 3, '可见且顺序正确']]),
    commonMistakes: ['在“切换”选项卡找对象动画。', '所有对象设置同时出现。'],
    checks: [check('c1', '页内标题和文字的进入效果在哪个选项卡设置？', 'fill', '动画', '对象动画在“动画”选项卡。'), check('c2', '本题第1个播放动画的对象是？', 'fill', '标题', '标题先出现。')],
    slides: [['课程目标', '掌握 Word 文档处理\n掌握 Excel 数据分析\n掌握 PowerPoint 展示设计']],
  },
  {
    software: 'ppt', title: '资源导航超链接页面', category: '超链接与多媒体', difficulty: '进阶',
    knowledgePoints: ['PowerPoint 2016 超链接', '动作', '对象编辑', '媒体占位'],
    prompt: '制作“学习资源导航”页面，为三个资源按钮分别添加指向指定幻灯片、官方网站和本地视频占位说明的链接/动作。',
    materials: ['学生材料含“题库练习、官方考试信息、操作演示”三个按钮文字。', '可用文本框或形状作为按钮。'],
    taskSteps: ['将“题库练习”链接到第3页。', '将“官方考试信息”链接到官方公告页。', '为“操作演示”添加视频/媒体占位说明，并设置明显按钮样式。'],
    referenceAnswer: ['内部链接可使用“本文档中的位置”。', '官方网站应使用明确的 https 链接。', '媒体占位需要说明资源位置，不要求嵌入第三方版权视频。'],
    scoringRubric: score([['内部链接', 3, '题库练习跳转第3页'], ['外部链接', 3, '官方链接正确'], ['按钮与媒体说明', 4, '三个对象清楚可操作']]),
    commonMistakes: ['把网址仅作为普通文本。', '外部链接到非官方页面却标称官方。'],
    checks: [check('c1', 'PowerPoint 中跳转到本演示文稿其他页应选择哪类链接？', 'fill', '本文档中的位置|本文档', '使用“本文档中的位置”。'), check('c2', '官方考试信息应链接到哪个机构？', 'fill', '山东省教育招生考试院', '来源为山东省教育招生考试院。')],
    slides: [['学习资源导航', '题库练习\n官方考试信息\n操作演示'], ['封面', '专升本学习助手'], ['题库练习', '开始一组练习']],
  },
  {
    software: 'ppt', title: '课程结构切换与放映', category: '切换与放映设置', difficulty: '进阶',
    knowledgePoints: ['PowerPoint 2016 切换', '放映设置', '排练计时', '自定义放映'],
    prompt: '为课程结构演示文稿设置统一的“推入”切换效果，设置从头开始放映，并对第2页设置自动换片时间。',
    materials: ['学生材料含4页课程结构内容。', '要求切换效果全篇一致，第2页在5秒后自动换片。'],
    taskSteps: ['选择合适的切换效果并应用到全部幻灯片。', '仅第2页设置5秒后自动换片。', '使用 F5 从头放映验证效果。'],
    referenceAnswer: ['切换作用于幻灯片之间，不是对象动画。', '“全部应用”后可单独调整第2页时间。', 'F5 从头放映，Shift+F5 从当前页放映。'],
    scoringRubric: score([['统一切换', 3, '4页均有统一切换'], ['自动换片', 4, '仅第2页为5秒自动'], ['放映验证', 3, '从头放映可验证']]),
    commonMistakes: ['把“推入”设置在动画中。', '点击全部应用后忘记单独设置第2页。'],
    checks: [check('c1', '幻灯片与幻灯片之间的效果属于什么？', 'fill', '切换|切换效果', '页间效果是切换。'), check('c2', '从头开始放映的快捷键是？', 'fill', 'F5', 'F5 从头放映。')],
    slides: [['课程结构', '导入\nWord\nExcel\nPPT'], ['Word 模块', '5秒后自动换片'], ['Excel 模块', '数据处理与图表'], ['PPT 模块', '设计与放映']],
  },
  {
    software: 'ppt', title: '答辩讲稿与备注页', category: '演示文稿输出', difficulty: '基础',
    knowledgePoints: ['PowerPoint 2016 备注', '讲义', '打印设置', '演示者视图'],
    prompt: '为项目答辩演示文稿的三页内容添加演讲者备注，并设置打印讲义每页6张幻灯片，保留页码和页眉信息。',
    materials: ['学生材料含项目背景、实现方案、成果总结三页内容。', '每页需添加不超过60字的讲解提示。'],
    taskSteps: ['分别在三页备注窗格输入讲解提示。', '设置打印讲义为每页6张幻灯片。', '在打印预览中检查页码与页面布局。'],
    referenceAnswer: ['备注仅供演讲者使用，不应显示在普通放映页面。', '讲义打印可选每页6张幻灯片。', '打印预览用于检查页码和布局。'],
    scoringRubric: score([['备注', 4, '三页均有简洁讲解提示'], ['讲义设置', 3, '每页6张幻灯片'], ['打印预览', 3, '页码和版式可读']]),
    commonMistakes: ['把讲解提示直接写到幻灯片正文。', '选择“全页幻灯片”而非讲义。'],
    checks: [check('c1', '讲解提示应写入哪个区域？', 'fill', '备注|备注窗格', '写入备注窗格。'), check('c2', '本题讲义每页包含多少张幻灯片？', 'fill', '6|六', '要求每页6张。')],
    slides: [['项目答辩', '校园学习系统'], ['项目背景', '学习任务分散\n缺少反馈闭环'], ['实现方案', '题库\n计划\n错题复习'], ['成果总结', '可持续学习与数据反馈']],
  },
  {
    software: 'ppt', title: '图表数据与版式优化', category: '图表与对象格式', difficulty: '综合',
    knowledgePoints: ['PowerPoint 2016 图表', '数据编辑', '对象对齐', '选择窗格'],
    prompt: '根据材料插入柱形图展示三类学习完成率，调整图表数据、标题和图例，并对齐标题、图表和结论文本框。',
    materials: ['学生材料提供“视频学习、题库练习、错题复习”的完成率数据。', '初始 PPT 含空白图表区域和结论文本。'],
    taskSteps: ['插入柱形图并录入三类完成率。', '设置图表标题为“学习完成率对比”，保留图例。', '使用对齐功能使页面对象边缘整齐。'],
    referenceAnswer: ['图表数据为视频学习78%、题库练习86%、错题复习72%。', '对象对齐应使用对齐命令，而不是拖拽目测。', '图表和结论文本框不重叠。'],
    scoringRubric: score([['图表数据', 4, '三类数据正确'], ['图表元素', 3, '标题和图例完整'], ['对象对齐', 3, '布局整齐不重叠']]),
    commonMistakes: ['把数据做成图片后粘贴。', '只靠鼠标拖动导致对象不齐。'],
    checks: [check('c1', '本题完成率最高的是哪一类？', 'fill', '题库练习', '题库练习为86%。'), check('c2', '让多个对象边缘整齐，应使用什么命令？', 'fill', '对齐', '使用“对齐”命令。')],
    slides: [['学习完成率对比', '视频学习 78%\n题库练习 86%\n错题复习 72%']],
  },
]

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function titleSafe(title) {
  return title.replace(/[\\/:*?"<>|]/g, '_')
}

function softwareName(software) {
  return software === 'word' ? 'Word' : software === 'excel' ? 'Excel' : 'PPT'
}

function buildQuestion(spec, index) {
  const order = index + 1
  const prefix = `Q${String(order).padStart(2, '0')}_${softwareName(spec.software)}_${titleSafe(spec.title)}`
  const ext = spec.software === 'word' ? 'docx' : spec.software === 'excel' ? 'xlsx' : 'pptx'
  const total = spec.scoringRubric.reduce((sum, item) => sum + item.points, 0)
  assert(total === 10, `${spec.title} 评分总分必须为10`)
  return {
    id: `office-q${String(order).padStart(2, '0')}`,
    order,
    title: spec.title,
    software: spec.software,
    category: spec.category,
    difficulty: spec.difficulty,
    knowledgePoints: spec.knowledgePoints,
    prompt: spec.prompt,
    materials: spec.materials,
    taskSteps: spec.taskSteps,
    referenceAnswer: spec.referenceAnswer,
    scoringRubric: spec.scoringRubric,
    commonMistakes: spec.commonMistakes,
    sourceType: SOURCE.sourceType,
    sourceTitle: SOURCE.sourceTitle,
    sourceOrganization: SOURCE.sourceOrganization,
    sourceYear: SOURCE.sourceYear,
    sourceUrl: SOURCE.sourceUrl,
    license: SOURCE.license,
    copyrightNote: SOURCE.copyrightNote,
    source: SOURCE,
    studentFileUrl: `office-materials/v3/${prefix}_学生材料.${ext}`,
    answerFileUrl: `office-materials/v3/${prefix}_参考答案.${ext}`,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    checks: spec.checks,
    _spec: spec,
  }
}

const questions = specs.map(buildQuestion)
assert(questions.length === 24, `题目数量应为24，实际为${questions.length}`)
assert(questions.filter((q) => q.software === 'word').length === 8, 'Word 题数量错误')
assert(questions.filter((q) => q.software === 'excel').length === 8, 'Excel 题数量错误')
assert(questions.filter((q) => q.software === 'ppt').length === 8, 'PPT 题数量错误')

function publicQuestion(question) {
  const { _spec, ...result } = question
  return result
}

function commonDocChildren(question, answer) {
  const spec = question._spec
  const children = [
    new Paragraph({ text: answer ? `参考答案 · ${question.title}` : `学生材料 · ${question.title}`, heading: HeadingLevel.TITLE, alignment: AlignmentType.CENTER }),
    new Paragraph({ children: [new TextRun({ text: `题号：Q${String(question.order).padStart(2, '0')}    软件：Word 2016    难度：${question.difficulty}`, bold: true })] }),
    new Paragraph({ text: answer ? '以下文档为教师参考完成稿，学生模式下需完成客观检查后才可下载。' : '请在本文件中完成题目要求。不要删除材料中的关键信息。' }),
    new Paragraph({ text: '材料正文', heading: HeadingLevel.HEADING_1 }),
  ]
  for (const line of spec.body ?? question.materials) {
    children.push(new Paragraph({ text: line, spacing: { after: 120 } }))
  }
  if (question.order === 3) {
    const data = [['专业名称', '普通计划', '建档立卡', '合计'], ['计算机科学与技术', '32', '3', '35'], ['软件工程', '28', '2', '30'], ['网络工程', '25', '2', '27'], ['数字媒体技术', '24', '4', '28'], ['总计', '109', '11', '120']]
    children.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: data.map((row, rowIndex) => new TableRow({ children: row.map((cell) => new TableCell({ children: [new Paragraph({ text: cell, alignment: rowIndex === 0 || rowIndex === data.length - 1 ? AlignmentType.CENTER : AlignmentType.LEFT })] })) })) }))
  }
  if (answer) {
    children.push(new Paragraph({ text: '参考完成要点', heading: HeadingLevel.HEADING_1 }))
    for (const line of question.referenceAnswer) children.push(new Paragraph({ text: line, bullet: { level: 0 } }))
    children.push(new Paragraph({ text: '评分标准', heading: HeadingLevel.HEADING_1 }))
    for (const item of question.scoringRubric) children.push(new Paragraph({ text: `${item.item}（${item.points}分）：${item.criterion}` }))
  }
  return children
}

async function generateWord(question, answer) {
  const label = answer ? '参考答案' : '学生材料'
  const fileName = path.basename(answer ? question.answerFileUrl : question.studentFileUrl)
  const doc = new Document({
    creator: '山东专升本学习系统',
    title: `${question.title}${label}`,
    description: '原创 Office 实操题可编辑材料',
    sections: [{
      properties: { page: { margin: { top: 1200, bottom: 1200, left: 1400, right: 1400 } } },
      headers: { default: new Header({ children: [new Paragraph({ text: '山东专升本计算机学习系统 · Office 实操题', alignment: AlignmentType.CENTER })] }) },
      footers: { default: new Footer({ children: [new Paragraph({ text: `Q${String(question.order).padStart(2, '0')} · ${label}`, alignment: AlignmentType.CENTER })] }) },
      children: commonDocChildren(question, answer),
    }],
  })
  const filePath = path.join(materialDir, fileName)
  await fs.writeFile(filePath, await Packer.toBuffer(doc))
  await canonicalizeOoxml(filePath)
}

const registrationRecords = [
  ['张晨', '软件工程1班', '2026-09-01', '13800138001'],
  ['李然', '网络工程2班', '2026-09-02', '13800138002'],
  ['王雪', '计算机科学与技术1班', '2026-09-02', '13800138003'],
  ['赵宁', '数字媒体技术1班', '2026-09-03', '13800138004'],
  ['陈静', '软件工程2班', '2026-09-04', '13800138005'],
  ['孙浩', '网络工程1班', '2026-09-04', '13800138006'],
  ['周欣', '计算机科学与技术2班', '2026-09-05', '13800138007'],
  ['吴凡', '数字媒体技术2班', '2026-09-05', '13800138008'],
  ['郑伟', '软件工程1班', '2026-09-06', '13800138009'],
  ['冯琳', '网络工程2班', '2026-09-06', '13800138010'],
  ['马超', '计算机科学与技术1班', '2026-09-07', '13800138011'],
  ['何敏', '数字媒体技术1班', '2026-09-08', '13800138012'],
]

const scoreRecords = [
  ['张晨', 78, 86], ['李然', 65, 71], ['王雪', 92, 88], ['赵宁', 58, 62], ['陈静', 84, 91],
  ['孙浩', 73, 69], ['周欣', 61, 76], ['吴凡', 87, 80], ['郑伟', 55, 64], ['冯琳', 90, 95],
  ['马超', 76, 72], ['何敏', 68, 83],
]

const activityRegistrationRecords = [
  ['张晨', '计算机学院', '2026-09-03', '13800138001', '已确认'],
  ['李然', '管理学院', '2026-09-02', '13800138002', '待确认'],
  ['王雪', '计算机学院', '2026-09-01', '13800138003', '已确认'],
  ['赵宁', '外国语学院', '2026-09-05', '13800138004', '取消'],
  ['陈静', '计算机学院', '2026-09-04', '13800138005', '待确认'],
  ['孙浩', '管理学院', '2026-09-03', '13800138006', '已确认'],
  ['周欣', '计算机学院', '2026-09-05', '13800138007', '已确认'],
  ['吴凡', '艺术学院', '2026-09-01', '13800138008', '已确认'],
  ['郑伟', '计算机学院', '2026-09-02', '13800138009', '待确认'],
  ['冯琳', '管理学院', '2026-09-06', '13800138010', '已确认'],
  ['马超', '计算机学院', '2026-09-06', '13800138011', '取消'],
  ['何敏', '外国语学院', '2026-09-07', '13800138012', '已确认'],
  ['高悦', '计算机学院', '2026-09-07', '13800138013', '已确认'],
  ['罗奇', '管理学院', '2026-09-08', '13800138014', '待确认'],
  ['钱程', '计算机学院', '2026-09-08', '13800138015', '已确认'],
]

const salesRecords = [
  ['教材', 'Word 实训册', 24, 18, 432], ['教材', 'Excel 实训册', 30, 20, 600], ['耗材', 'U盘', 18, 35, 630],
  ['耗材', '笔记本', 36, 8, 288], ['设备', '键盘', 6, 95, 570], ['设备', '鼠标', 10, 68, 680],
  ['教材', 'PPT 实训册', 22, 19, 418], ['耗材', '打印纸', 15, 26, 390], ['设备', '耳机', 8, 120, 960],
  ['教材', '模拟题册', 20, 16, 320], ['耗材', '文件夹', 28, 6, 168], ['设备', '摄像头', 4, 260, 1040],
  ['教材', '错题本', 25, 12, 300], ['耗材', '标签纸', 20, 5, 100], ['设备', '显示器', 3, 760, 2280],
  ['教材', '考试指南', 18, 22, 396], ['耗材', '签字笔', 35, 3, 105], ['设备', '投影仪', 2, 2400, 4800],
]

const projectFundRecords = [
  ['课程建设', '第一季度', 8200, '已结项'], ['课程建设', '第二季度', 7600, '进行中'], ['设备维护', '第一季度', 4300, '已结项'],
  ['设备维护', '第三季度', 6800, '已结项'], ['竞赛培训', '第二季度', 5200, '进行中'], ['竞赛培训', '第四季度', 7400, '已结项'],
  ['课程建设', '第三季度', 9100, '已结项'], ['设备维护', '第二季度', 3500, '进行中'], ['竞赛培训', '第一季度', 4600, '已结项'],
  ['课程建设', '第四季度', 8900, '已结项'], ['设备维护', '第四季度', 7200, '已结项'], ['竞赛培训', '第三季度', 5100, '进行中'],
  ['课程建设', '第一季度', 6600, '已结项'], ['设备维护', '第二季度', 3900, '已结项'], ['竞赛培训', '第四季度', 8300, '已结项'],
  ['课程建设', '第三季度', 7300, '进行中'],
]

const monthlyScoreRecords = [['5月', 73.5, 0.78], ['6月', 76.2, 0.82], ['7月', 79.1, 0.86], ['8月', 77.8, 0.84]]

function sortedActivities() {
  return [...activityRegistrationRecords].sort((left, right) => left[1].localeCompare(right[1], 'zh-CN') || left[2].localeCompare(right[2]))
}

function excelRows(question, answer) {
  switch (question.order) {
    case 9:
      return [['序号', '姓名', '班级', '报名日期', '手机号'], ...registrationRecords.map((row, index) => [answer ? index + 1 : '', ...row])]
    case 10:
      return [
        ['姓名', '平时成绩', '期末成绩', '总评', '', '', '项目', '权重'],
        ...scoreRecords.slice(0, 10).map((row, index) => [row[0], row[1], row[2], answer ? { f: `B${index + 2}*$H$2+C${index + 2}*$H$3`, z: '0.0' } : '', '', '', index === 0 ? '平时成绩' : index === 1 ? '期末成绩' : '', index === 0 ? 0.3 : index === 1 ? 0.7 : '']),
      ]
    case 11:
      return [
        ['序号', '姓名', '计算机基础成绩', '结果', '', '', '统计项目', '人数'],
        ...scoreRecords.map((row, index) => [index + 1, row[0], row[1], answer ? { f: `IF(C${index + 2}>=60,"合格","需补考")` } : '', '', '', index === 0 ? '需补考人数' : '', answer && index === 0 ? { f: 'COUNTIF(D2:D13,"需补考")' } : '']),
      ]
    case 12:
      return [['姓名', '学院', '报名日期', '联系电话', '状态'], ...(answer ? sortedActivities() : activityRegistrationRecords)]
    case 13:
      return [['类别', '商品', '数量', '单价', '销售额'], ...(answer ? [...salesRecords].sort((left, right) => left[0].localeCompare(right[0], 'zh-CN')) : salesRecords)]
    case 14:
      return [['项目类别', '季度', '金额', '状态'], ...projectFundRecords]
    case 15:
      return [['月份', '平均分', '及格率'], ...monthlyScoreRecords]
    case 16:
      return Array.from({ length: 41 }, (_, index) => index === 0
        ? ['考场', '座位号', '准考证号', '姓名', '专业']
        : ['302', index, `2026${String(1000 + index).slice(-4)}`, `考生${String(index).padStart(2, '0')}`, index % 2 ? '计算机科学与技术' : '软件工程'])
    default:
      return [['序号', '姓名', '学院/类别', '日期', '数据1', '数据2', '状态']]
  }
}

function addSheet(workbook, name, rows) {
  const ws = XLSX.utils.aoa_to_sheet(rows)
  ws['!cols'] = rows[0].map((value) => ({ wch: Math.max(12, String(value).length * 2 + 4) }))
  XLSX.utils.book_append_sheet(workbook, ws, name)
  return ws
}

function setCellFormat(ws, column, firstRow, lastRow, format) {
  for (let row = firstRow; row <= lastRow; row += 1) {
    const cell = ws[`${column}${row}`]
    if (cell) cell.z = format
  }
}

function addExcelReferenceSheets(workbook, question) {
  if (question.order === 13) {
    addSheet(workbook, '分类汇总参考', [
      ['类别', '销售额小计'],
      ['教材', { f: 'SUMIF(原始数据!$A$2:$A$19,A2,原始数据!$E$2:$E$19)' }],
      ['耗材', { f: 'SUMIF(原始数据!$A$2:$A$19,A3,原始数据!$E$2:$E$19)' }],
      ['设备', { f: 'SUMIF(原始数据!$A$2:$A$19,A4,原始数据!$E$2:$E$19)' }],
      ['总计', { f: 'SUM(B2:B4)' }],
      [],
      ['说明：该表给出可编辑公式参考结果；原生“分类汇总/分级显示”须在 Microsoft Office 或 WPS 中按题目要求执行并人工复核。'],
    ])
  }
  if (question.order === 14) {
    const categories = ['课程建设', '设备维护', '竞赛培训']
    const quarters = ['第一季度', '第二季度', '第三季度', '第四季度']
    addSheet(workbook, '透视表参考', [
      ['状态筛选：已结项'],
      ['项目类别', ...quarters, '总计'],
      ...categories.map((category, index) => [
        category,
        ...quarters.map((quarter, quarterIndex) => ({ f: `SUMIFS(原始数据!$C$2:$C$17,原始数据!$A$2:$A$17,$A${index + 3},原始数据!$B$2:$B$17,${XLSX.utils.encode_col(quarterIndex + 1)}$2,原始数据!$D$2:$D$17,"已结项")` })),
        { f: `SUM(B${index + 3}:E${index + 3})` },
      ]),
      ['总计', ...quarters.map((_, index) => ({ f: `SUM(${XLSX.utils.encode_col(index + 1)}3:${XLSX.utils.encode_col(index + 1)}5)` })), { f: 'SUM(F3:F5)' }],
      [],
      ['说明：SheetJS 无法稳定写出可由 Office/WPS 刷新的原生数据透视表缓存。本表用可编辑 SUMIFS 公式呈现相同字段布局和“已结项”汇总结果；教师须在 Office/WPS 中按题目步骤创建并复核原生数据透视表。'],
    ])
  }
}

function generateExcelWorkbook(question, answer) {
  const wb = XLSX.utils.book_new()
  const info = [
    ['山东专升本计算机学习系统 · Office 实操题'],
    [`题号：Q${String(question.order).padStart(2, '0')}`],
    [`题目：${question.title}`],
    ['材料说明：', ...question.materials],
    ['任务目标：', ...question.taskSteps],
    ['注意：请在“原始数据”工作表中操作；不要删除表头。'],
  ]
  addSheet(wb, '题目说明', info.map((x) => [x.join(' ')]))
  const rows = excelRows(question, answer)
  const rawData = addSheet(wb, '原始数据', rows)
  if (question.order === 9) {
    setCellFormat(rawData, 'D', 2, 13, 'yyyy-mm-dd')
    setCellFormat(rawData, 'E', 2, 13, '@')
  }
  if (question.order === 10) {
    setCellFormat(rawData, 'D', 2, 11, '0.0')
    setCellFormat(rawData, 'H', 2, 3, '0%')
  }
  if (question.order === 12) {
    setCellFormat(rawData, 'C', 2, 16, 'yyyy-mm-dd')
    setCellFormat(rawData, 'D', 2, 16, '@')
    if (answer) rawData['!autofilter'] = { ref: 'A1:E16' }
  }
  if (question.order === 13 && answer) rawData['!autofilter'] = { ref: 'A1:E19' }
  if (question.order === 14 && answer) rawData['!autofilter'] = { ref: 'A1:D17' }
  if (question.order === 15) {
    if (answer) {
      rawData.D1 = { t: 's', v: '及格率（%）' }
      for (let row = 2; row <= 5; row += 1) rawData[`D${row}`] = { f: `C${row}*100`, z: '0.0' }
      rawData['!ref'] = 'A1:D5'
      rawData['!cols'] = [{ wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 16 }]
    }
    const chartSheet = addSheet(wb, '图表展示', answer
      ? [['参考图表：月度成绩分析'], ['已生成可编辑簇状柱形图；双击图表可修改数据与元素。']]
      : [['请在此工作表插入“月度成绩分析”簇状柱形图。']])
    chartSheet['!cols'] = [{ wch: 52 }]
    setCellFormat(rawData, 'C', 2, 5, '0%')
  }
  if (question.order === 16) {
    rawData['!margins'] = { left: 0.25, right: 0.25, top: 0.55, bottom: 0.55, header: 0.2, footer: 0.25 }
    wb.Workbook ??= {}
    wb.Workbook.Names ??= []
    const rawDataIndex = wb.SheetNames.indexOf('原始数据')
    wb.Workbook.Names.push(
      { Name: '_xlnm.Print_Area', Sheet: rawDataIndex, Ref: "'原始数据'!$A$1:$E$41" },
      { Name: '_xlnm.Print_Titles', Sheet: rawDataIndex, Ref: "'原始数据'!$1:$1" },
    )
  }
  if (answer) {
    const answerRows = [['参考完成要点'], ...question.referenceAnswer.map((text) => [text]), [], ['评分标准'], ...question.scoringRubric.map((item) => [`${item.item}（${item.points}分）：${item.criterion}`])]
    addSheet(wb, '参考答案', answerRows)
    addExcelReferenceSheets(wb, question)
  }
  return wb
}

async function generateExcel(question, answer) {
  const fileName = path.basename(answer ? question.answerFileUrl : question.studentFileUrl)
  const filePath = path.join(materialDir, fileName)
  XLSX.writeFile(generateExcelWorkbook(question, answer), filePath, { bookType: 'xlsx', compression: true })
  await enhanceExcelOoxml(filePath, question, answer)
  await canonicalizeOoxml(filePath)
}

function xmlEscape(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

function insertXmlBefore(xml, content, markers) {
  const marker = markers.find((candidate) => xml.includes(candidate))
  return marker
    ? xml.replace(marker, `${content}${marker}`)
    : xml.replace('</worksheet>', `${content}</worksheet>`)
}

async function readZipXml(zip, entryName) {
  const entry = zip.file(entryName)
  assert(entry, `OOXML 缺少 ${entryName}`)
  return entry.async('text')
}

async function updateZipXml(zip, entryName, updater) {
  const xml = await readZipXml(zip, entryName)
  zip.file(entryName, updater(xml), { date: OOXML_DATE })
}

async function updateXlsxSheet(zip, sheetIndex, updater) {
  await updateZipXml(zip, `xl/worksheets/sheet${sheetIndex}.xml`, updater)
}

async function addConditionalFormattingStyle(zip) {
  await updateZipXml(zip, 'xl/styles.xml', (xml) => {
    const dxf = '<dxf><font><color rgb="FF9C0006"/></font><fill><patternFill patternType="solid"><fgColor rgb="FFFFC7CE"/><bgColor indexed="64"/></patternFill></fill></dxf>'
    if (/<dxfs count="0"\/>/.test(xml)) return xml.replace('<dxfs count="0"/>', `<dxfs count="1">${dxf}</dxfs>`)
    const match = xml.match(/<dxfs count="(\d+)">([\s\S]*?)<\/dxfs>/)
    assert(match, 'styles.xml 缺少可写入的 dxfs 节点')
    const count = Number(match[1])
    return xml.replace(match[0], `<dxfs count="${count + 1}">${match[2]}${dxf}</dxfs>`)
  })
}

function chartCache(values) {
  return `<c:numCache><c:formatCode>General</c:formatCode><c:ptCount val="${values.length}"/>${values.map((value, index) => `<c:pt idx="${index}"><c:v>${value}</c:v></c:pt>`).join('')}</c:numCache>`
}

function categoryCache(labels) {
  return `<c:strCache><c:ptCount val="${labels.length}"/>${labels.map((label, index) => `<c:pt idx="${index}"><c:v>${xmlEscape(label)}</c:v></c:pt>`).join('')}</c:strCache>`
}

function excelChartXml() {
  const labels = monthlyScoreRecords.map((row) => row[0])
  const averageScores = monthlyScoreRecords.map((row) => row[1])
  const passRates = monthlyScoreRecords.map((row) => row[2] * 100)
  const series = [
    ['平均分', 'B', averageScores],
    ['及格率（%）', 'D', passRates],
  ].map(([name, column, values], index) => `
      <c:ser>
        <c:idx val="${index}"/><c:order val="${index}"/>
        <c:tx><c:strRef><c:f>原始数据!$${column}$1</c:f><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>${name}</c:v></c:pt></c:strCache></c:strRef></c:tx>
        <c:cat><c:strRef><c:f>原始数据!$A$2:$A$5</c:f>${categoryCache(labels)}</c:strRef></c:cat>
        <c:val><c:numRef><c:f>原始数据!$${column}$2:$${column}$5</c:f>${chartCache(values)}</c:numRef></c:val>
      </c:ser>`).join('')
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <c:chart>
    <c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="zh-CN" sz="1400" b="1"/><a:t>月度成绩分析</a:t></a:r><a:endParaRPr lang="zh-CN"/></a:p></c:rich></c:tx><c:layout/><c:overlay val="0"/></c:title>
    <c:plotArea><c:layout/>
      <c:barChart><c:barDir val="col"/><c:grouping val="clustered"/><c:varyColors val="0"/>${series}
        <c:dLbls><c:showLegendKey val="0"/><c:showVal val="1"/><c:showCatName val="0"/><c:showSerName val="0"/></c:dLbls>
        <c:gapWidth val="150"/><c:axId val="48650112"/><c:axId val="48672768"/>
      </c:barChart>
      <c:catAx><c:axId val="48650112"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="b"/><c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="zh-CN" sz="1000"/><a:t>月份</a:t></a:r><a:endParaRPr lang="zh-CN"/></a:p></c:rich></c:tx><c:layout/></c:title><c:tickLblPos val="nextTo"/><c:crossAx val="48672768"/><c:crosses val="autoZero"/><c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/><c:noMultiLvlLbl val="0"/></c:catAx>
      <c:valAx><c:axId val="48672768"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="l"/><c:majorGridlines/><c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="zh-CN" sz="1000"/><a:t>分值 / 百分比</a:t></a:r><a:endParaRPr lang="zh-CN"/></a:p></c:rich></c:tx><c:layout/></c:title><c:numFmt formatCode="General" sourceLinked="1"/><c:majorTickMark val="out"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/><c:crossAx val="48650112"/><c:crosses val="autoZero"/><c:crossBetween val="between"/></c:valAx>
    </c:plotArea>
    <c:legend><c:legendPos val="b"/><c:layout/><c:overlay val="0"/></c:legend><c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/>
  </c:chart>
  <c:printSettings><c:headerFooter/><c:pageMargins b="0.75" l="0.7" r="0.7" t="0.75" header="0.3" footer="0.3"/><c:pageSetup/>
  </c:printSettings>
</c:chartSpace>`
}

async function addExcelChart(zip) {
  await updateXlsxSheet(zip, 3, (xml) => {
    const withNamespace = xml.includes('xmlns:r=')
      ? xml
      : xml.replace('<worksheet ', '<worksheet xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ')
    return insertXmlBefore(withNamespace, '<drawing r:id="rId1"/>', ['</worksheet>'])
  })
  zip.file('xl/worksheets/_rels/sheet3.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/></Relationships>', { date: OOXML_DATE })
  zip.file('xl/drawings/drawing1.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><xdr:twoCellAnchor editAs="oneCell"><xdr:from><xdr:col>0</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>3</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:to><xdr:col>8</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>20</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to><xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="2" name="月度成绩分析图表"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr><xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart r:id="rId1"/></a:graphicData></a:graphic></xdr:graphicFrame><xdr:clientData/></xdr:twoCellAnchor></xdr:wsDr>', { date: OOXML_DATE })
  zip.file('xl/drawings/_rels/drawing1.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/chart1.xml"/></Relationships>', { date: OOXML_DATE })
  zip.file('xl/charts/chart1.xml', excelChartXml(), { date: OOXML_DATE })
  await updateZipXml(zip, '[Content_Types].xml', (xml) => {
    const overrides = [
      ['/xl/drawings/drawing1.xml', 'application/vnd.openxmlformats-officedocument.drawing+xml'],
      ['/xl/charts/chart1.xml', 'application/vnd.openxmlformats-officedocument.drawingml.chart+xml'],
    ].filter(([partName]) => !xml.includes(`PartName="${partName}"`))
      .map(([partName, contentType]) => `<Override PartName="${partName}" ContentType="${contentType}"/>`).join('')
    return xml.replace('</Types>', `${overrides}</Types>`)
  })
}

async function enhanceExcelOoxml(filePath, question, answer) {
  const zip = await JSZip.loadAsync(await fs.readFile(filePath))
  if (answer && question.order === 9) {
    await updateXlsxSheet(zip, 2, (xml) => xml.replace(/<sheetViews>[\s\S]*?<\/sheetViews>/, '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A2" sqref="A2"/></sheetView></sheetViews>'))
  }
  if (answer && question.order === 11) {
    await addConditionalFormattingStyle(zip)
    await updateXlsxSheet(zip, 2, (xml) => insertXmlBefore(xml, '<conditionalFormatting sqref="C2:C13"><cfRule type="cellIs" dxfId="0" priority="1" operator="lessThan"><formula>60</formula></cfRule></conditionalFormatting>', ['<pageMargins', '<pageSetup', '<ignoredErrors', '</worksheet>']))
  }
  if (answer && question.order === 12) {
    await updateXlsxSheet(zip, 2, (xml) => {
      const filtered = xml.replace('<autoFilter ref="A1:E16"/>', '<autoFilter ref="A1:E16"><filterColumn colId="1"><filters><filter val="计算机学院"/></filters></filterColumn><filterColumn colId="4"><filters><filter val="已确认"/></filters></filterColumn></autoFilter>')
      return insertXmlBefore(filtered, '<dataValidations count="1"><dataValidation type="list" allowBlank="1" showInputMessage="1" showErrorMessage="1" sqref="E2:E16"><formula1>&quot;待确认,已确认,取消&quot;</formula1></dataValidation></dataValidations>', ['<pageMargins', '<pageSetup', '<ignoredErrors', '</worksheet>'])
    })
  }
  if (answer && question.order === 15) await addExcelChart(zip)
  if (answer && question.order === 16) {
    await updateXlsxSheet(zip, 2, (xml) => insertXmlBefore(xml, '<pageSetup orientation="landscape" paperSize="9" fitToWidth="1" fitToHeight="0"/><headerFooter><oddFooter>第 &amp;P 页，共 &amp;N 页</oddFooter></headerFooter>', ['<ignoredErrors', '</worksheet>']))
  }
  if (answer && [10, 11, 13, 14, 15].includes(question.order)) {
    await updateZipXml(zip, 'xl/workbook.xml', (xml) => xml.includes('<calcPr')
      ? xml.replace(/<calcPr\b[^>]*\/?\/>/, '<calcPr calcId="191029" fullCalcOnLoad="1" forceFullCalc="1"/>')
      : xml.replace('</workbook>', '<calcPr calcId="191029" fullCalcOnLoad="1" forceFullCalc="1"/></workbook>'))
  }
  await fs.writeFile(filePath, await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 9 }, platform: 'DOS' }))
}

function addPptHeader(slide, question, answer) {
  slide.background = { color: 'F5F8FC' }
  slide.addShape('rect', { x: 0, y: 0, w: 13.333, h: 0.35, fill: { color: '2465B8' }, line: { color: '2465B8' } })
  slide.addText(`Q${String(question.order).padStart(2, '0')} · ${answer ? '参考答案' : '学生材料'}`, { x: 0.45, y: 0.1, w: 5.5, h: 0.18, fontSize: 9, color: 'FFFFFF', margin: 0 })
}

function defineOfficeTrainingMaster(pptx) {
  pptx.defineSlideMaster({
    title: 'OfficeTrainingMaster',
    background: { color: 'F5F8FC' },
    objects: [
      { rect: { x: 0, y: 0, w: 13.333, h: 0.35, fill: { color: '2465B8' }, line: { color: '2465B8' } } },
      { text: { text: '计算机应用实训', options: { x: 0.45, y: 7.0, w: 4.2, h: 0.18, fontFace: 'Microsoft YaHei', fontSize: 9, color: '54606F', margin: 0 } } },
    ],
    slideNumber: { x: 12.15, y: 7.0, w: 0.55, h: 0.18, fontFace: 'Microsoft YaHei', fontSize: 9, color: '54606F', align: 'right', margin: 0 },
  })
}

function addResourceNavigationButtons(slide) {
  const buttons = [
    { label: '题库练习', y: 4.95, hyperlink: { slide: 3, tooltip: '跳转至第 3 页题库练习' } },
    { label: '官方考试信息', y: 5.56, hyperlink: { url: OFFICIAL_URL, tooltip: '打开山东省教育招生考试院官方公告' } },
    { label: '操作演示（本地视频占位）', y: 6.17 },
  ]
  for (const button of buttons) {
    slide.addShape('roundRect', {
      x: 8.55, y: button.y, w: 3.7, h: 0.46,
      fill: { color: button.hyperlink ? '2465B8' : '8792A0' }, line: { color: button.hyperlink ? '2465B8' : '8792A0' },
      hyperlink: button.hyperlink, objectName: `${button.label}按钮`,
    })
    slide.addText(button.label, {
      x: 8.72, y: button.y + 0.12, w: 3.36, h: 0.16,
      fontFace: 'Microsoft YaHei', fontSize: 10, color: 'FFFFFF', bold: true, align: 'center', margin: 0,
      hyperlink: button.hyperlink,
    })
  }
}

function addCompletionChart(slide, pptx) {
  slide.addChart('bar', [{
    name: '完成率', labels: ['视频学习', '题库练习', '错题复习'], values: [78, 86, 72],
  }], {
    x: 1.0, y: 1.85, w: 6.65, h: 3.95,
    title: '学习完成率对比', showTitle: true, showLegend: true, showValue: true,
    chartColors: ['2465B8'], barDir: 'col', barGrouping: 'clustered',
    catAxisTitle: '学习类型', showCatAxisTitle: true, catAxisTitleFontFace: 'Microsoft YaHei', catAxisLabelFontFace: 'Microsoft YaHei',
    valAxisTitle: '完成率（%）', showValAxisTitle: true, valAxisTitleFontFace: 'Microsoft YaHei', valAxisMinVal: 0, valAxisMaxVal: 100,
    valAxisLabelFontFace: 'Microsoft YaHei', valAxisLabelFormatCode: '0', objectName: '学习完成率可编辑图表',
  })
}

function manualPptCapabilityNote(question) {
  if (question.order === 19) return '说明：PptxGenJS 4.0.1 不提供稳定的原生 SmartArt 写入接口。本参考稿保留可编辑流程对象和完成要求；须在 PowerPoint/WPS 中插入原生流程型 SmartArt 后人工复核。'
  if (question.order === 20) return '说明：PptxGenJS 4.0.1 不提供稳定的对象动画、动画窗格写入接口。本参考稿保留可编辑对象与顺序要求；须在 PowerPoint/WPS 中手动设置动画，不能视为已自动生成。'
  if (question.order === 22) return '说明：PptxGenJS 4.0.1 不提供稳定的幻灯片切换、自动换片写入接口。本参考稿保留可编辑页面与设置要求；须在 PowerPoint/WPS 中手动设置并放映复核。'
  return ''
}

function makePpt(question, answer) {
  const pptx = new PptxGenJS()
  pptx.layout = 'LAYOUT_WIDE'
  pptx.author = '山东专升本学习系统'
  pptx.subject = 'Office 实操题可编辑材料'
  pptx.title = `${question.title}${answer ? '参考答案' : '学生材料'}`
  pptx.company = '山东专升本学习系统'
  const useTrainingMaster = answer && question.order === 18
  if (useTrainingMaster) defineOfficeTrainingMaster(pptx)
  const slides = question._spec.slides ?? [[question.title, ...question.materials]]
  slides.forEach((content, index) => {
    const slide = useTrainingMaster ? pptx.addSlide({ masterName: 'OfficeTrainingMaster' }) : pptx.addSlide()
    if (!useTrainingMaster) addPptHeader(slide, question, answer)
    const [title, ...points] = content
    slide.addText(title, { x: 0.7, y: 0.8, w: 11.8, h: 0.55, fontFace: 'Microsoft YaHei', fontSize: 26, bold: true, color: '26313E', margin: 0 })
    slide.addShape('roundRect', { x: 0.8, y: 1.65, w: 7.1, h: 4.65, rectRadius: 0.08, fill: { color: 'FFFFFF' }, line: { color: 'CFE5FF', width: 1 } })
    slide.addText(points.join('\n'), { x: 1.15, y: 2.05, w: 6.4, h: 3.8, fontFace: 'Microsoft YaHei', fontSize: 20, color: '26313E', breakLine: false, margin: 0.08, bullet: { indent: 18 } })
    slide.addShape('roundRect', { x: 8.35, y: 1.65, w: 4.1, h: 3.1, rectRadius: 0.08, fill: { color: answer ? 'E6F7EE' : 'E7F2FF' }, line: { color: answer ? 'BFE6CD' : 'CFE5FF', width: 1 } })
    slide.addText(answer ? '参考完成要点' : '图片 / 图表 / 视频占位', { x: 8.75, y: 2.0, w: 3.3, h: 0.3, fontFace: 'Microsoft YaHei', fontSize: 15, bold: true, color: answer ? '1E7A4D' : '2465B8', align: 'center', margin: 0 })
    slide.addText(answer ? question.referenceAnswer.slice(0, 3).join('\n') : '请按题目要求插入或编辑可替换对象。\n此占位区域为可编辑形状。', { x: 8.75, y: 2.55, w: 3.3, h: 1.55, fontFace: 'Microsoft YaHei', fontSize: 13, color: '55616E', margin: 0.05, align: 'center', valign: 'mid' })
    slide.addText(`${index + 1} / ${slides.length}`, { x: 11.85, y: 7.05, w: 0.6, h: 0.2, fontSize: 9, color: '8792A0', align: 'right', margin: 0 })
    if (answer && question.order === 21 && index === 0) addResourceNavigationButtons(slide)
    if (answer && question.order === 23) {
      const notes = [
        '说明答辩主题和学习系统服务对象，控制在一分钟内完成开场。',
        '强调当前学习过程中的任务分散和反馈不足，过渡到解决思路。',
        '依次说明题库、计划和错题复习如何形成可执行的学习闭环。',
        '总结可持续学习与数据反馈价值，邀请教师提出建议。',
      ]
      slide.addNotes(notes[index] ?? '请根据本页内容补充讲解提示。')
    }
    if (answer && question.order === 24 && index === 0) addCompletionChart(slide, pptx)
  })
  if (answer) {
    const scoreSlide = useTrainingMaster ? pptx.addSlide({ masterName: 'OfficeTrainingMaster' }) : pptx.addSlide()
    if (!useTrainingMaster) addPptHeader(scoreSlide, question, true)
    scoreSlide.addText('评分标准与易错点', { x: 0.7, y: 0.8, w: 11.8, h: 0.5, fontFace: 'Microsoft YaHei', fontSize: 24, bold: true, color: '26313E', margin: 0 })
    scoreSlide.addText(question.scoringRubric.map((item) => `${item.item}（${item.points}分）：${item.criterion}`).join('\n'), { x: 0.9, y: 1.65, w: 11.2, h: 2.7, fontFace: 'Microsoft YaHei', fontSize: 16, color: '26313E', breakLine: false, margin: 0.08, bullet: { indent: 18 } })
    scoreSlide.addText(`易错点\n${question.commonMistakes.join('\n')}`, { x: 0.9, y: 4.65, w: 11.2, h: 1.3, fontFace: 'Microsoft YaHei', fontSize: 15, color: 'B93A2E', margin: 0.05 })
    const capabilityNote = manualPptCapabilityNote(question)
    if (capabilityNote) scoreSlide.addText(capabilityNote, { x: 0.9, y: 6.15, w: 11.2, h: 0.45, fontFace: 'Microsoft YaHei', fontSize: 10, color: '875C00', margin: 0.03, breakLine: false })
  }
  return pptx
}

async function generatePpt(question, answer) {
  const fileName = path.basename(answer ? question.answerFileUrl : question.studentFileUrl)
  const filePath = path.join(materialDir, fileName)
  await makePpt(question, answer).writeFile({ fileName: filePath })
  await canonicalizeOoxml(filePath)
}

/**
 * docx 和 PptxGenJS 会把当前时间写入 core.xml，也会使用当前 ZIP 条目时间。
 * 固定这些元数据后，内容相同的材料在任意一次重新生成时都得到相同的二进制哈希。
 */
async function canonicalizeOoxml(filePath) {
  await fs.writeFile(filePath, await canonicalizeOoxmlBuffer(await fs.readFile(filePath)))
}

async function canonicalizeOoxmlBuffer(buffer) {
  const zip = await JSZip.loadAsync(buffer)
  const core = zip.file('docProps/core.xml')
  if (core) {
    const xml = await core.async('text')
    const normalized = xml.replace(
      /(<dcterms:(?:created|modified)\b[^>]*>)[^<]*(<\/dcterms:(?:created|modified)>)/g,
      `$1${OOXML_TIMESTAMP}$2`
    )
    zip.file('docProps/core.xml', normalized, { date: OOXML_DATE })
  }
  for (const [entryName, entry] of Object.entries(zip.files)) {
    if (entry.dir || !/\.(?:docx|xlsx|pptx)$/i.test(entryName)) continue
    zip.file(entryName, await canonicalizeOoxmlBuffer(await entry.async('nodebuffer')), { date: OOXML_DATE })
  }
  for (const entry of Object.values(zip.files)) entry.date = OOXML_DATE
  return zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 9 },
    platform: 'DOS',
  })
}

async function fileHash(filePath) {
  return createHash('sha256').update(await fs.readFile(filePath)).digest('hex')
}

async function validateOfficeFile(question, filePath, answer) {
  const stat = await fs.stat(filePath)
  assert(stat.size > 1000, `${path.basename(filePath)} 文件异常过小`)
  if (question.software === 'excel') {
    const wb = XLSX.readFile(filePath, { cellFormula: true })
    assert(wb.SheetNames.includes('题目说明'), `${path.basename(filePath)} 缺少题目说明工作表`)
    assert(wb.SheetNames.includes('原始数据'), `${path.basename(filePath)} 缺少原始数据工作表`)
    if (answer) assert(wb.SheetNames.includes('参考答案'), `${path.basename(filePath)} 缺少参考答案工作表`)
  } else {
    const zip = await JSZip.loadAsync(await fs.readFile(filePath))
    const key = question.software === 'word' ? 'word/document.xml' : 'ppt/presentation.xml'
    assert(zip.file(key), `${path.basename(filePath)} 缺少 ${key}`)
  }
  return { file: path.relative(publicDir, filePath).replaceAll('\\', '/'), bytes: stat.size, sha256: await fileHash(filePath), answer }
}

async function main() {
  await fs.mkdir(materialDir, { recursive: true })
  const validation = []
  for (const question of questions) {
    if (question.software === 'word') {
      await generateWord(question, false)
      await generateWord(question, true)
    } else if (question.software === 'excel') {
      await generateExcel(question, false)
      await generateExcel(question, true)
    } else {
      await generatePpt(question, false)
      await generatePpt(question, true)
    }
    validation.push(await validateOfficeFile(question, path.join(publicDir, question.studentFileUrl), false))
    validation.push(await validateOfficeFile(question, path.join(publicDir, question.answerFileUrl), true))
  }
  const bank = {
    meta: {
      name: '山东专升本计算机 Office 实操大题（原创材料型）',
      version: 3,
      updatedAt: '2026-08-31',
      sourceBasis: '山东省2026年普通高等教育专科升本科招生考试公共基础课考试要求（计算机部分：Word 2016、Excel 2016、PowerPoint 2016）',
      sourceUrl: OFFICIAL_PDF_URL,
      sourceSha256: OFFICIAL_SHA256,
      note: '共24题：Word、Excel、PPT各8题。全部为原创同类型题；每题有学生材料和参考答案可编辑文件。',
    },
    questions: questions.map(publicQuestion),
  }
  await fs.writeFile(manifestPath, `${JSON.stringify(bank, null, 2)}\n`, 'utf8')
  await fs.writeFile(validationPath, `${JSON.stringify({ generatedAt: CREATED_AT, questionCount: questions.length, fileCount: validation.length, files: validation }, null, 2)}\n`, 'utf8')
  console.log(`Generated ${questions.length} questions and ${validation.length} editable Office files.`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
