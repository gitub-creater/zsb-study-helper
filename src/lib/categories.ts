// 考试类别体系:高教一类/二类/三类(依据山东省教育厅官方专业类别设置文件)
import type { ExamCategory, Elective } from '../types'

export interface CategoryDef {
  key: ExamCategory
  name: string
  math: string
  mathSubjectId: string
  gates: string
  desc: string
  subjects: string[]
}

export const EXAM_CATEGORIES: Record<ExamCategory, CategoryDef> = {
  gj1: {
    key: 'gj1',
    name: '高教一类',
    math: '高等数学Ⅰ',
    mathSubjectId: 's-m1',
    gates: '理学 · 工学',
    desc: '范围最广、难度最高:含微分方程、空间解析几何、多元微积分、无穷级数',
    subjects: ['大学语文', '高等数学Ⅰ', '英语或政治', '计算机'],
  },
  gj2: {
    key: 'gj2',
    name: '高教二类',
    math: '高等数学Ⅱ',
    mathSubjectId: 's-m2',
    gates: '经济学 · 农学 · 医学 · 管理学',
    desc: '不含向量代数与空间解析几何、无穷级数;含多元微积分与常微分方程',
    subjects: ['大学语文', '高等数学Ⅱ', '英语或政治', '计算机'],
  },
  gj3: {
    key: 'gj3',
    name: '高教三类',
    math: '高等数学Ⅲ',
    mathSubjectId: 's-m3',
    gates: '哲学 · 法学 · 教育学 · 文学 · 历史学 · 艺术学',
    desc: '范围最窄,重基础概念与基础计算,常微分方程仅作简单要求',
    subjects: ['大学语文', '高等数学Ⅲ', '英语或政治', '计算机'],
  },
}

export const CATEGORY_ORDER: ExamCategory[] = ['gj1', 'gj2', 'gj3']

export const ELECTIVE_TEXT: Record<Elective, string> = {
  english: '英语',
  politics: '政治',
}

/** 年度大纲信息(随年份组织;新年度发布后更新内容包即可自动合并) */
export const SYLLABUS_YEARS: { year: number; status: '现行' | '往期' | '未发布'; note: string; verified: string }[] = [
  {
    year: 2026,
    status: '现行',
    note: '专业类别设置延续 12 学科门类划分(官方文件已发布);公共基础课考试要求以省考试院当年发布为准',
    verified: '类别设置已核验 · 细目待核实',
  },
  {
    year: 2025,
    status: '往期',
    note: '考试于 3 月 29-30 日举行;高数Ⅰ/Ⅱ/Ⅲ 章节结构与 2026 一致(机构大纲转载印证)',
    verified: '待核实',
  },
  {
    year: 2027,
    status: '未发布',
    note: '预计 2026 年底发布;发布后在「检查更新」中同步最新内容包即可,历史学习记录不受影响',
    verified: '—',
  },
]

/** 资料来源(页面展示用,检索于 2026-08-28) */export const SOURCE_REFS = [
  {
    name: '山东省2026年普通高校专升本专业类别设置及考试科目',
    org: '山东省教育厅(官方文件 PDF)',
    date: '2025-11 发布',
    type: '官方规定',
    status: '已核验',
    url: 'http://edu.shandong.gov.cn/module/download/downfile.jsp?classid=0&filename=6d9a05c9d392400f969c488d288f6122.pdf',
    note: '12 个学科门类与高数Ⅰ/Ⅱ/Ⅲ、公共课科目的对应关系来源',
  },
  {
    name: '山东省2026年公共基础课考试要求(考试大纲)',
    org: '山东省教育招生考试院(官网)',
    date: '每年更新,以当年为准',
    type: '官方规定',
    status: '已核验',
    url: 'https://www.sdzk.cn/NewsInfo.aspx?NewsID=7081',
    note: '各科目考试内容与要求的权威出处',
  },
  {
    name: '高等数学Ⅰ考试要求(PDF)',
    org: '山东省教育招生考试院',
    date: '2022 年版(后续年度以官网更新为准)',
    type: '官方规定',
    status: '已核验',
    url: 'https://www.sdzk.cn/Floadup/file/20211130/6377389819661516436402626.pdf',
    note: '章节划分与能力要求的原始依据',
  },
  {
    name: '2025 山东专升本高等数学Ⅰ/Ⅱ考试大纲(转载)',
    org: '新东方(培训机构,经验整理)',
    date: '2025-01',
    type: '机构整理',
    status: '待核实(与官方原文逐条比对)',
    url: 'https://zsb.xdf.cn/202501/14058633.html',
    note: '用于交叉印证章节结构,不作为最终依据',
  },
  {
    name: '山东专升本考试高等数学科目题型分值分析',
    org: '知乎专栏(考生经验总结)',
    date: '2022',
    type: '经验总结',
    status: '待核实',
    url: 'https://zhuanlan.zhihu.com/p/562266157',
    note: '题型分值分布仅供参考',
  },
]
