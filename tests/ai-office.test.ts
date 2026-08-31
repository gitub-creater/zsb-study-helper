import { describe, expect, it } from 'vitest'
import JSZip from 'jszip'
import { createOfficeBlob, parseAiOfficeDraft, safeOfficeFilename, splitMaterial } from '../src/lib/aiOffice'

const draftText = JSON.stringify({
  title: '学习安排',
  summary: '本周完成计算机基础复习。',
  sections: [{ heading: '安排', body: '周一复习 Word，周二复习 Excel。' }],
  table: { headers: ['日期', '内容'], rows: [['周一', 'Word'], ['周二', 'Excel']] },
  slides: [{ title: '本周安排', bullets: ['复习 Word', '复习 Excel'] }],
})

describe('AI 办公材料生成', () => {
  it('长文本按顺序分段且文件名安全', () => {
    expect(splitMaterial('a'.repeat(10), 4)).toEqual(['aaaa', 'aaaa', 'aa'])
    expect(safeOfficeFilename('通知:/2026*', 'docx')).toBe('通知2026.docx')
  })

  it('生成可打开的 DOCX/XLSX/PPTX 容器', async () => {
    const draft = parseAiOfficeDraft(draftText, 'docx')
    const docx = await createOfficeBlob(draft, 'docx')
    const xlsx = await createOfficeBlob(draft, 'xlsx')
    const pptx = await createOfficeBlob(draft, 'pptx')
    expect(docx.size).toBeGreaterThan(500)
    expect(xlsx.size).toBeGreaterThan(500)
    expect(pptx.size).toBeGreaterThan(500)
    expect((await JSZip.loadAsync(await docx.arrayBuffer())).file('word/document.xml')).not.toBeNull()
    expect((await JSZip.loadAsync(await xlsx.arrayBuffer())).file('[Content_Types].xml')).not.toBeNull()
    expect((await JSZip.loadAsync(await pptx.arrayBuffer())).file('ppt/presentation.xml')).not.toBeNull()
  })
})
