import { createHash } from 'node:crypto'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { extname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import JSZip from 'jszip'
import * as XLSX from 'xlsx'
import { describe, expect, it } from 'vitest'
import { checkOfficeCheckAnswer, gradeOfficeSubmission } from '../src/lib/office'
import type { OfficeCheckItem, OfficeQuestion, OfficeQuestionBank, OfficeSubmission } from '../src/types'

interface OfficeMaterialValidationFile {
  file: string
  bytes: number
  sha256: string
  answer: boolean
}

interface OfficeMaterialValidation {
  generatedAt: string
  questionCount: number
  fileCount: number
  files: OfficeMaterialValidationFile[]
}

const projectRoot = fileURLToPath(new URL('../', import.meta.url))
const publicDir = resolve(projectRoot, 'public')
const bank = JSON.parse(
  readFileSync(resolve(publicDir, 'data/office-question-bank.v3.json'), 'utf8')
) as OfficeQuestionBank
const validation = JSON.parse(
  readFileSync(resolve(publicDir, 'data/office-materials.v3.validation.json'), 'utf8')
) as OfficeMaterialValidation

function materialPath(url: string): string {
  const filePath = resolve(publicDir, url)
  const rel = relative(publicDir, filePath)
  expect(rel.startsWith('..')).toBe(false)
  return filePath
}

function sha256(filePath: string): string {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex')
}

function questionByOrder(order: number): OfficeQuestion {
  const question = bank.questions.find((candidate) => candidate.order === order)
  if (!question) throw new Error(`缺少 Q${String(order).padStart(2, '0')}`)
  return question
}

function workbookRows(order: number, answer: boolean): unknown[][] {
  const question = questionByOrder(order)
  const workbook = XLSX.readFile(materialPath(answer ? question.answerFileUrl : question.studentFileUrl), { cellFormula: true })
  return XLSX.utils.sheet_to_json(workbook.Sheets['原始数据'], { header: 1, defval: '' })
}

async function zipEntry(filePath: string, entryName: string): Promise<string> {
  const zip = await JSZip.loadAsync(readFileSync(filePath))
  const entry = zip.file(entryName)
  if (!entry) throw new Error(`${filePath} 缺少 ${entryName}`)
  return entry.async('text')
}

function answerFor(check: OfficeCheckItem): string {
  return check.answer.split('|')[0]
}

function studentAnswerUnlocked(submission?: OfficeSubmission): boolean {
  return Boolean(submission?.answerUnlockedAt)
}

describe('Office material question bank', () => {
  it('contains exactly 24 questions: 8 Word, 8 Excel, and 8 PPT', () => {
    expect(bank.questions).toHaveLength(24)
    expect(bank.questions.filter((question) => question.software === 'word')).toHaveLength(8)
    expect(bank.questions.filter((question) => question.software === 'excel')).toHaveLength(8)
    expect(bank.questions.filter((question) => question.software === 'ppt')).toHaveLength(8)

    const orders = bank.questions.map((question) => question.order).sort((a, b) => a - b)
    expect(orders).toEqual(Array.from({ length: 24 }, (_, index) => index + 1))
    expect(new Set(bank.questions.map((question) => question.id)).size).toBe(24)
  })

  it('gives every question complete task, scoring, source, and copyright metadata', () => {
    expect(bank.meta.version).toBe(3)
    expect(bank.meta.sourceBasis).toContain('2026')
    expect(bank.meta.sourceUrl).toMatch(/^https:\/\//)
    expect(bank.meta.sourceSha256).toMatch(/^[A-F0-9]{64}$/)

    for (const question of bank.questions) {
      expect(question.id).toMatch(/^office-q\d{2}$/)
      expect(question.title.trim()).not.toBe('')
      expect(question.category.trim()).not.toBe('')
      expect(question.prompt.trim()).not.toBe('')
      expect(question.knowledgePoints.length).toBeGreaterThan(0)
      expect(question.materials.length).toBeGreaterThan(0)
      expect(question.taskSteps.length).toBeGreaterThan(0)
      expect(question.referenceAnswer.length).toBeGreaterThan(0)
      expect(question.commonMistakes.length).toBeGreaterThan(0)

      expect(question.scoringRubric.length).toBeGreaterThan(0)
      expect(question.scoringRubric.every((item) => item.item.trim() && item.criterion.trim() && item.points > 0)).toBe(true)
      expect(question.scoringRubric.reduce((total, item) => total + item.points, 0)).toBe(10)

      expect(question.sourceType).not.toBe('')
      expect(question.sourceTitle.trim()).not.toBe('')
      expect(question.sourceOrganization.trim()).not.toBe('')
      expect(question.sourceYear).toBeGreaterThan(0)
      expect(question.sourceUrl).toMatch(/^https:\/\//)
      expect(question.license.trim()).not.toBe('')
      expect(question.copyrightNote.trim()).not.toBe('')
      expect(question.source).toEqual({
        sourceType: question.sourceType,
        sourceTitle: question.sourceTitle,
        sourceOrganization: question.sourceOrganization,
        sourceYear: question.sourceYear,
        sourceUrl: question.sourceUrl,
        license: question.license,
        copyrightNote: question.copyrightNote,
      })

      expect(question.checks.length).toBeGreaterThan(0)
      for (const check of question.checks) {
        expect(check.id.trim()).not.toBe('')
        expect(check.prompt.trim()).not.toBe('')
        expect(check.answer.trim()).not.toBe('')
        expect(check.explanation.trim()).not.toBe('')
        if (check.type === 'single' || check.type === 'multiple') {
          expect(check.options?.length).toBeGreaterThan(1)
        }
      }
    }
  })

  it('maps every student and answer download to one distinct validated editable file', () => {
    expect(validation.questionCount).toBe(24)
    expect(validation.fileCount).toBe(48)
    expect(validation.files).toHaveLength(48)
    expect(new Set(validation.files.map((entry) => entry.file)).size).toBe(48)

    const validationByFile = new Map(validation.files.map((entry) => [entry.file, entry]))
    for (const question of bank.questions) {
      const expectedExtension = question.software === 'word' ? '.docx' : question.software === 'excel' ? '.xlsx' : '.pptx'
      expect(extname(question.studentFileUrl)).toBe(expectedExtension)
      expect(extname(question.answerFileUrl)).toBe(expectedExtension)
      expect(question.studentFileUrl).not.toBe(question.answerFileUrl)

      const student = validationByFile.get(question.studentFileUrl)
      const answer = validationByFile.get(question.answerFileUrl)
      expect(student).toBeDefined()
      expect(answer).toBeDefined()
      expect(student?.answer).toBe(false)
      expect(answer?.answer).toBe(true)
    }
  })

  it('keeps every published Office file present, integrity-checked, and readable as an editable container', async () => {
    const questionByFile = new Map<string, OfficeQuestion>()
    for (const question of bank.questions) {
      questionByFile.set(question.studentFileUrl, question)
      questionByFile.set(question.answerFileUrl, question)
    }

    for (const entry of validation.files) {
      const question = questionByFile.get(entry.file)
      expect(question).toBeDefined()
      expect(entry.bytes).toBeGreaterThan(1000)
      expect(entry.sha256).toMatch(/^[a-f0-9]{64}$/)

      const filePath = materialPath(entry.file)
      expect(existsSync(filePath)).toBe(true)
      expect(statSync(filePath).size).toBe(entry.bytes)
      expect(sha256(filePath)).toBe(entry.sha256)

      if (question?.software === 'excel') {
        const workbook = XLSX.readFile(filePath, { cellFormula: true })
        expect(workbook.SheetNames).toContain('题目说明')
        expect(workbook.SheetNames).toContain('原始数据')
        if (entry.answer) expect(workbook.SheetNames).toContain('参考答案')
        continue
      }

      const zip = await JSZip.loadAsync(readFileSync(filePath))
      const requiredEntry = question?.software === 'word' ? 'word/document.xml' : 'ppt/presentation.xml'
      expect(zip.file(requiredEntry)).not.toBeNull()
    }
  })

  it('keeps Q09-Q16 source data aligned with their matching Excel task instead of reusing a generic table', () => {
    const q09Student = workbookRows(9, false)
    const q09Answer = workbookRows(9, true)
    expect(q09Student[0]).toEqual(['序号', '姓名', '班级', '报名日期', '手机号'])
    expect(q09Student).toHaveLength(13)
    expect(q09Student.slice(1).every((row) => row[0] === '')).toBe(true)
    expect(q09Answer.slice(1).map((row) => row[0])).toEqual(Array.from({ length: 12 }, (_, index) => index + 1))

    const q10 = workbookRows(10, true)
    expect(q10[0]).toEqual(['姓名', '平时成绩', '期末成绩', '总评', '', '', '项目', '权重'])
    expect(q10).toHaveLength(11)
    expect(q10[1].slice(0, 3)).toEqual(['张晨', 78, 86])
    expect(q10[1].slice(6)).toEqual(['平时成绩', 0.3])
    expect(q10[2].slice(6)).toEqual(['期末成绩', 0.7])

    const q11 = workbookRows(11, false)
    expect(q11[0].slice(0, 4)).toEqual(['序号', '姓名', '计算机基础成绩', '结果'])
    expect(q11).toHaveLength(13)
    expect(q11.slice(1).every((row) => typeof row[2] === 'number')).toBe(true)

    const q12 = workbookRows(12, false)
    expect(q12[0]).toEqual(['姓名', '学院', '报名日期', '联系电话', '状态'])
    expect(q12).toHaveLength(16)
    expect(new Set(q12.slice(1).map((row) => row[4]))).toEqual(new Set(['已确认', '待确认', '取消']))

    const q13 = workbookRows(13, false)
    expect(q13[0]).toEqual(['类别', '商品', '数量', '单价', '销售额'])
    expect(q13).toHaveLength(19)
    expect(new Set(q13.slice(1).map((row) => row[0]))).toEqual(new Set(['教材', '耗材', '设备']))

    const q14 = workbookRows(14, false)
    expect(q14[0]).toEqual(['项目类别', '季度', '金额', '状态'])
    expect(q14).toHaveLength(17)
    expect(new Set(q14.slice(1).map((row) => row[3]))).toEqual(new Set(['已结项', '进行中']))

    const q15 = workbookRows(15, false)
    expect(q15).toEqual([['月份', '平均分', '及格率'], ['5月', 73.5, 0.78], ['6月', 76.2, 0.82], ['7月', 79.1, 0.86], ['8月', 77.8, 0.84]])

    const q16 = workbookRows(16, false)
    expect(q16[0]).toEqual(['考场', '座位号', '准考证号', '姓名', '专业'])
    expect(q16).toHaveLength(41)
    expect(q16[40].slice(0, 4)).toEqual(['302', 40, '20261040', '考生40'])
  })

  it('writes meaningful editable Excel objects and labels explicit native-feature limitations', async () => {
    const q10Xml = await zipEntry(materialPath(questionByOrder(10).answerFileUrl), 'xl/worksheets/sheet2.xml')
    expect(q10Xml).toContain('<f>B2*$H$2+C2*$H$3</f>')
    expect(q10Xml).toContain('<f>B11*$H$2+C11*$H$3</f>')

    const q11File = materialPath(questionByOrder(11).answerFileUrl)
    const q11Xml = await zipEntry(q11File, 'xl/worksheets/sheet2.xml')
    const q11Styles = await zipEntry(q11File, 'xl/styles.xml')
    expect(q11Xml).toContain('<f>IF(C2&gt;=60,&quot;合格&quot;,&quot;需补考&quot;)</f>')
    expect(q11Xml).toContain('<f>COUNTIF(D2:D13,&quot;需补考&quot;)</f>')
    expect(q11Xml).toContain('<conditionalFormatting sqref="C2:C13">')
    expect(q11Styles).toContain('<dxfs count="1">')

    const q12Xml = await zipEntry(materialPath(questionByOrder(12).answerFileUrl), 'xl/worksheets/sheet2.xml')
    expect(q12Xml).toContain('<autoFilter ref="A1:E16">')
    expect(q12Xml).toContain('<filter val="计算机学院"/>')
    expect(q12Xml).toContain('<filter val="已确认"/>')
    expect(q12Xml).toContain('<dataValidation type="list"')
    expect(q12Xml).toContain('sqref="E2:E16"')

    const q13 = XLSX.readFile(materialPath(questionByOrder(13).answerFileUrl), { cellFormula: true })
    expect(q13.SheetNames).toContain('分类汇总参考')
    expect(XLSX.utils.sheet_to_json(q13.Sheets['分类汇总参考'], { header: 1, defval: '' }).at(-1)?.[0]).toContain('原生“分类汇总/分级显示”须在 Microsoft Office 或 WPS')

    const q14 = XLSX.readFile(materialPath(questionByOrder(14).answerFileUrl), { cellFormula: true })
    expect(q14.SheetNames).toContain('透视表参考')
    const q14Reference = XLSX.utils.sheet_to_json(q14.Sheets['透视表参考'], { header: 1, defval: '' })
    expect(q14Reference.flat().join('\n')).toContain('无法稳定写出可由 Office/WPS 刷新的原生数据透视表缓存')
    expect(await zipEntry(materialPath(questionByOrder(14).answerFileUrl), 'xl/worksheets/sheet4.xml')).toContain('SUMIFS(原始数据!$C$2:$C$17')

    const q15File = materialPath(questionByOrder(15).answerFileUrl)
    const q15Zip = await JSZip.loadAsync(readFileSync(q15File))
    expect(q15Zip.file('xl/charts/chart1.xml')).not.toBeNull()
    expect(q15Zip.file('xl/drawings/drawing1.xml')).not.toBeNull()
    expect(await zipEntry(q15File, 'xl/charts/chart1.xml')).toContain('月度成绩分析')
    expect(await zipEntry(q15File, 'xl/worksheets/sheet3.xml')).toContain('<drawing r:id="rId1"/>')

    const q16File = materialPath(questionByOrder(16).answerFileUrl)
    const q16Xml = await zipEntry(q16File, 'xl/worksheets/sheet2.xml')
    const q16Workbook = await zipEntry(q16File, 'xl/workbook.xml')
    expect(q16Xml).toContain('<pageSetup orientation="landscape" paperSize="9" fitToWidth="1" fitToHeight="0"/>')
    expect(q16Xml).toContain('<oddFooter>第 &amp;P 页，共 &amp;N 页</oddFooter>')
    expect(q16Workbook).toContain('_xlnm.Print_Area')
    expect(q16Workbook).toContain('_xlnm.Print_Titles')
  })

  it('writes editable master, chart, note, and hyperlink objects into PPT reference files', async () => {
    const q18File = materialPath(questionByOrder(18).answerFileUrl)
    const q18Zip = await JSZip.loadAsync(readFileSync(q18File))
    expect(q18Zip.file('ppt/slideLayouts/slideLayout2.xml')).not.toBeNull()
    expect(await zipEntry(q18File, 'ppt/slideLayouts/slideLayout2.xml')).toContain('OfficeTrainingMaster')
    expect(await zipEntry(q18File, 'ppt/slideLayouts/slideLayout2.xml')).toContain('计算机应用实训')

    const q21File = materialPath(questionByOrder(21).answerFileUrl)
    const q21Slide = await zipEntry(q21File, 'ppt/slides/slide1.xml')
    const q21Relations = await zipEntry(q21File, 'ppt/slides/_rels/slide1.xml.rels')
    expect(q21Slide).toContain('hlinkClick')
    expect(q21Relations).toContain('Target="slide3.xml"')
    expect(q21Relations).toContain('https://www.sdzk.cn/NewsInfo.aspx?NewsID=7081')

    const q23File = materialPath(questionByOrder(23).answerFileUrl)
    expect(await zipEntry(q23File, 'ppt/notesSlides/notesSlide1.xml')).toContain('说明答辩主题和学习系统服务对象')
    expect(await zipEntry(q23File, 'ppt/notesSlides/notesSlide4.xml')).toContain('总结可持续学习与数据反馈价值')

    const q24File = materialPath(questionByOrder(24).answerFileUrl)
    const q24Zip = await JSZip.loadAsync(readFileSync(q24File))
    expect(q24Zip.file('ppt/charts/chart1.xml')).not.toBeNull()
    const q24Chart = await zipEntry(q24File, 'ppt/charts/chart1.xml')
    expect(q24Chart).toContain('学习完成率对比')
    expect(q24Chart).toContain('<c:v>86</c:v>')
  })

  it('grades objective checks before producing an answer-unlock submission', () => {
    const question = bank.questions[0]
    const drafts: Record<string, string> = Object.fromEntries(
      question.checks.map((check) => [check.id, answerFor(check)])
    )
    const submissions: Record<string, OfficeSubmission> = {}

    expect(studentAnswerUnlocked(submissions[question.id])).toBe(false)

    const allCorrect = gradeOfficeSubmission(question, drafts, '2026-08-31T01:02:03.000Z')
    expect(allCorrect.correctCount).toBe(question.checks.length)
    expect(allCorrect.totalChecks).toBe(question.checks.length)
    expect(allCorrect.status).toBe('correct')
    expect(allCorrect.score).toBe(allCorrect.totalScore)
    expect(allCorrect.answerUnlockedAt).toBe('2026-08-31T01:02:03.000Z')
    expect(studentAnswerUnlocked(allCorrect)).toBe(true)

    const wrongDrafts = { ...drafts, [question.checks[0].id]: '__wrong__' }
    const incorrect = gradeOfficeSubmission(question, wrongDrafts, '2026-08-31T01:02:04.000Z')
    expect(incorrect.correctCount).toBe(question.checks.length - 1)
    expect(incorrect.status).toBe('incorrect')
    expect(incorrect.score).toBeLessThan(incorrect.totalScore)

    const single = question.checks.find((check) => check.type === 'single')
    if (single) {
      expect(checkOfficeCheckAnswer(single, single.answer.toLowerCase())).toBe(true)
      expect(checkOfficeCheckAnswer(single, '__wrong__')).toBe(false)
    }
  })
})
