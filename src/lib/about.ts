// 关于信息与版本工具:文案集中在这里,方便后续修改
export const ABOUT = {
  appName: '专升本学习助手 · 知识校园',
  version: '0.3.0',
  developer: '大学在读生 丁辉',
  copyright: '版权所有 © 2026 丁辉。保留所有权利。',
  notice: '本软件的代码、界面设计、名称及相关内容未经许可不得复制、修改、传播或用于商业用途。',
}

/** 比较语义化版本号:返回 1 / 0 / -1 */
export function compareVersions(a: string, b: string): number {
  const pa = a.replace(/^v/i, '').split('.').map((x) => parseInt(x, 10) || 0)
  const pb = b.replace(/^v/i, '').split('.').map((x) => parseInt(x, 10) || 0)
  const len = Math.max(pa.length, pb.length)
  for (let i = 0; i < len; i++) {
    const x = pa[i] ?? 0
    const y = pb[i] ?? 0
    if (x !== y) return x > y ? 1 : -1
  }
  return 0
}
