// CSV 解析与生成(支持引号包裹、逗号、换行转义)
export function parseCsv(input: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  const src = input.replace(/^\uFEFF/, '')
  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        field += c
      }
    } else if (c === '"') {
      inQuotes = true
    } else if (c === ',') {
      row.push(field)
      field = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++
      row.push(field)
      field = ''
      if (row.some((x) => x.trim() !== '')) rows.push(row)
      row = []
    } else {
      field += c
    }
  }
  row.push(field)
  if (row.some((x) => x.trim() !== '')) rows.push(row)
  return rows
}

export function toCsv(headers: string[], rows: (string | number | boolean | undefined)[][]): string {
  const esc = (v: unknown): string => {
    const s = String(v ?? '')
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
  }
  const lines = [headers.map(esc).join(','), ...rows.map((r) => r.map(esc).join(','))]
  return '\uFEFF' + lines.join('\r\n')
}
