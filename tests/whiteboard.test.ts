import { describe, expect, it } from 'vitest'
import { boardItemContainsPoint, eraseBoardItemsAt } from '../src/components/Whiteboard'
import type { BoardItem } from '../src/types'

const pen = (id: string, pts = [0.2, 0.2, 0.5, 0.5]): BoardItem => ({
  id,
  type: 'pen',
  pts,
  color: '#000',
  width: 3,
  by: 'u_test',
  at: 1,
})

describe('白板橡皮擦局部擦除', () => {
  it('擦到笔迹局部会保留对象并记录擦除点', () => {
    const result = eraseBoardItemsAt([pen('p1'), pen('p2', [0.8, 0.8, 0.9, 0.9])], { x: 0.3, y: 0.3 })
    expect(result.hitIds).toEqual(['p1'])
    expect(result.items.map((item) => item.id)).toEqual(['p1', 'p2'])
    expect(result.items[0].erasePoints).toEqual([{ x: 0.3, y: 0.3, r: 0.02, rx: 0.02, ry: 0.02 }])
  })

  it('连续擦除会追加多个局部擦除点,空白处不改变页面', () => {
    const items = [pen('p1'), pen('p2', [0.6, 0.6, 0.7, 0.7])]
    const first = eraseBoardItemsAt(items, { x: 0.3, y: 0.3 })
    const second = eraseBoardItemsAt(first.items, { x: 0.4, y: 0.4 })
    expect(second.hitIds).toEqual(['p1'])
    expect(second.items[0].erasePoints).toHaveLength(2)
    expect(eraseBoardItemsAt(items, { x: 0.05, y: 0.05 }).items).toEqual(items)
  })

  it('图片和文字都支持局部擦除,不会被整块删除', () => {
    const image: BoardItem = { id: 'img', type: 'image', pts: [0.1, 0.1, 0.6, 0.6], color: '#000', width: 0, src: 'data:image/png;base64,x', by: 'u_test', at: 1 }
    const text: BoardItem = { id: 'txt', type: 'text', pts: [0.1, 0.1], color: '#000', width: 0.03, text: '好友申请', by: 'u_test', at: 1 }
    expect(boardItemContainsPoint(image, { x: 0.2, y: 0.2 })).toBe(true)
    expect(boardItemContainsPoint(text, { x: 0.15, y: 0.12 })).toBe(true)
    expect(eraseBoardItemsAt([image], { x: 0.2, y: 0.2 }).items[0].erasePoints).toHaveLength(1)
    expect(eraseBoardItemsAt([text], { x: 0.15, y: 0.12 }).items[0].erasePoints).toHaveLength(1)
  })
})
