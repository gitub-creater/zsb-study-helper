// 极简 PDF 生成器:把多张 JPEG 页面打包成一个 PDF(白板"导出 PDF"用,不引入第三方依赖)
// 仅覆盖本项目所需:每页一张整幅图片(1920×1080),RGB/DCTDecode。

interface PdfPage {
  jpeg: Uint8Array
  width: number
  height: number
}

const encoder = new TextEncoder()

function bytes(s: string): Uint8Array {
  return encoder.encode(s)
}

function concat(chunks: Uint8Array[]): Uint8Array {
  const len = chunks.reduce((s, c) => s + c.length, 0)
  const out = new Uint8Array(len)
  let off = 0
  for (const c of chunks) {
    out.set(c, off)
    off += c.length
  }
  return out
}

export function buildPdfFromJpegs(pages: PdfPage[]): Blob {
  const chunks: Uint8Array[] = []
  const offsets: number[] = []
  let pos = 0
  const push = (c: Uint8Array) => {
    chunks.push(c)
    pos += c.length
  }
  const beginObj = (n: number) => {
    offsets[n] = pos
    push(bytes(`${n} 0 obj\n`))
  }

  push(bytes('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n'))

  const pageIds: number[] = []
  // 对象编号:1=Catalog 2=Pages,之后每页 3 个对象(Page/Contents/Image)
  pages.forEach((_, i) => pageIds.push(3 + i * 3))

  beginObj(1)
  push(bytes('<< /Type /Catalog /Pages 2 0 R >>\nendobj\n'))
  beginObj(2)
  const kids = pageIds.map((id) => `${id} 0 R`).join(' ')
  push(bytes(`<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>\nendobj\n`))

  pages.forEach((p, i) => {
    const pageId = pageIds[i]
    const contentId = pageId + 1
    const imageId = pageId + 2
    const w = p.width
    const h = p.height

    beginObj(pageId)
    push(
      bytes(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Contents ${contentId} 0 R /Resources << /XObject << /Im0 ${imageId} 0 R >> /ProcSet [/PDF /ImageC] >> >>\nendobj\n`
      )
    )

    const stream = `q\n${w} 0 0 ${h} 0 0 cm\n/Im0 Do\nQ\n`
    beginObj(contentId)
    push(bytes(`<< /Length ${stream.length} >>\nstream\n${stream}endstream\nendobj\n`))

    beginObj(imageId)
    push(
      bytes(
        `<< /Type /XObject /Subtype /Image /Width ${w} /Height ${h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.jpeg.length} >>\nstream\n`
      )
    )
    push(p.jpeg)
    push(bytes('\nendstream\nendobj\n'))
  })

  const xrefStart = pos
  const maxObj = 2 + pages.length * 3
  let xref = `xref\n0 ${maxObj + 1}\n0000000000 65535 f \n`
  for (let n = 1; n <= maxObj; n++) {
    xref += `${String(offsets[n] ?? 0).padStart(10, '0')} 00000 n \n`
  }
  push(bytes(xref))
  push(bytes(`trailer\n<< /Size ${maxObj + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`))

  return new Blob([concat(chunks) as unknown as BlobPart], { type: 'application/pdf' })
}

/** 把画布转为 JPEG Uint8Array(白板导出用) */
export function canvasToJpeg(canvas: HTMLCanvasElement, quality = 0.92): { jpeg: Uint8Array; width: number; height: number } {
  const dataUrl = canvas.toDataURL('image/jpeg', quality)
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1)
  const bin = atob(base64)
  const arr = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i)
  return { jpeg: arr, width: canvas.width, height: canvas.height }
}

/** 多页白板导出 PDF */
export function exportCanvasesToPdf(canvases: HTMLCanvasElement[], filename: string): void {
  const pages = canvases.map((c) => canvasToJpeg(c))
  const blob = buildPdfFromJpegs(pages)
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 3000)
}
