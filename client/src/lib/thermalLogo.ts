/**
 * Restaurant logo as ESC/POS raster bytes, so it can be printed at the top of the bill.
 *
 * The logo (a normal image URL) is shrunk, put on a white background and turned into black/white dots
 * with dithering so it keeps its shape on a thermal printer. Any problem (no logo, blocked image,
 * slow network) returns null and the bill simply prints without the logo — it never blocks a bill.
 */
const GS = 0x1d
const cache = new Map<string, number[]>()

function loadImage(url: string, timeoutMs: number): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous' // needed to read pixels (Cloudinary allows it)
    const timer = setTimeout(() => reject(new Error('logo timeout')), timeoutMs)
    img.onload = () => { clearTimeout(timer); resolve(img) }
    img.onerror = () => { clearTimeout(timer); reject(new Error('logo failed to load')) }
    img.src = url
  })
}

/**
 * @param paperCols 42 (80mm paper) or 32 (58mm paper) — picks the logo size
 * @returns bytes to send (set alignment to centre first), or null if there is no usable logo
 */
export async function logoRasterBytes(url: string | null | undefined, paperCols: number): Promise<number[] | null> {
  if (!url) return null
  const maxW = paperCols <= 32 ? 160 : 224 // dots; the printer line is 384 (58mm) / 576 (80mm) dots wide
  const maxH = 112
  const key = `${url}|${maxW}`
  const hit = cache.get(key)
  if (hit) return hit

  try {
    const img = await loadImage(url, 4000)
    if (!img.naturalWidth || !img.naturalHeight) return null

    const scale = Math.min(maxW / img.naturalWidth, maxH / img.naturalHeight, 1)
    const w = Math.max(8, Math.floor((img.naturalWidth * scale) / 8) * 8) // width must be whole bytes
    const h = Math.max(1, Math.round(img.naturalHeight * scale))

    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) return null
    ctx.fillStyle = '#ffffff' // transparent areas print as white, not black
    ctx.fillRect(0, 0, w, h)
    ctx.drawImage(img, 0, 0, w, h)

    const { data } = ctx.getImageData(0, 0, w, h) // throws if the image blocks pixel access
    const gray = new Float32Array(w * h)
    for (let i = 0; i < w * h; i++) {
      gray[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2]
    }

    // Floyd–Steinberg dithering: black/white dots that still look like the logo
    const bw = new Uint8Array(w * h)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x
        const old = gray[i]
        const val = old < 128 ? 0 : 255
        bw[i] = val === 0 ? 1 : 0 // 1 = black dot
        const err = old - val
        if (x + 1 < w) gray[i + 1] += (err * 7) / 16
        if (y + 1 < h) {
          if (x > 0) gray[i + w - 1] += (err * 3) / 16
          gray[i + w] += (err * 5) / 16
          if (x + 1 < w) gray[i + w + 1] += (err * 1) / 16
        }
      }
    }

    const bytesPerRow = w / 8
    const out: number[] = [GS, 0x76, 0x30, 0, bytesPerRow & 0xff, (bytesPerRow >> 8) & 0xff, h & 0xff, (h >> 8) & 0xff]
    for (let y = 0; y < h; y++) {
      for (let bx = 0; bx < bytesPerRow; bx++) {
        let b = 0
        for (let bit = 0; bit < 8; bit++) b = (b << 1) | bw[y * w + bx * 8 + bit]
        out.push(b)
      }
    }
    out.push(0x0a) // line feed after the image
    cache.set(key, out)
    return out
  } catch (err) {
    console.warn('Logo not printed:', err)
    return null
  }
}
