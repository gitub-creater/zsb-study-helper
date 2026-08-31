/*
 * 将已归档的 V2 笔试型实操题库恢复到旧路径。
 * 只在发布回滚到旧版页面时使用；不会处理用户的 localStorage 或云端学习记录。
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const backup = path.join(root, 'public', 'data', 'office-tasks.v2.backup.json')
const target = path.join(root, 'public', 'data', 'office-tasks.json')

await fs.copyFile(backup, target)
console.log('已恢复旧版实操题库：public/data/office-tasks.json')
