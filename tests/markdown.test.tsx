import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Markdown } from '../src/components/Markdown'

describe('AI 讲解正文朗读高亮', () => {
  it('只在原讲解中高亮当前列表句，不影响同组其他条目', () => {
    const html = renderToStaticMarkup(
      <Markdown text={'- 第一句。\n- 第二句！'} activeSpeechSentence="第二句！" />
    )

    expect(html).toContain('第一句。')
    expect(html).toContain('第二句！')
    expect((html.match(/md-speech-active/g) ?? [])).toHaveLength(1)
    expect(html).toMatch(/<li[^>]*>第一句。<\/li><li class="md-speech-active">/)
  })
})
