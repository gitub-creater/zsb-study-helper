/*
 * 发布前验证 Office 材料生成是否完全可重复。
 * 运行：node scripts/verify-office-materials.mjs
 */
import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const materialDir = path.join(root, 'public', 'office-materials', 'v3')

function runGenerator() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['scripts/generate-office-materials.mjs'], {
      cwd: root,
      stdio: 'inherit',
    })
    child.once('error', reject)
    child.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`材料生成失败，退出码：${code}`)))
  })
}

async function hashes() {
  const entries = await fs.readdir(materialDir, { withFileTypes: true })
  const files = entries
    .filter((entry) => entry.isFile() && /\.(?:docx|xlsx|pptx)$/i.test(entry.name))
    .map((entry) => entry.name)
    .sort()
  const result = new Map()
  for (const file of files) {
    const content = await fs.readFile(path.join(materialDir, file))
    result.set(file, createHash('sha256').update(content).digest('hex'))
  }
  return result
}

await runGenerator()
const first = await hashes()
await runGenerator()
const second = await hashes()

if (first.size !== 48 || second.size !== 48) throw new Error(`材料数量异常：第一次 ${first.size}，第二次 ${second.size}`)
for (const [file, hash] of first) {
  if (second.get(file) !== hash) throw new Error(`不可重复生成：${file} 的 SHA-256 不一致`)
}
console.log(`Office material reproducibility passed: ${first.size} files with matching SHA-256.`)
