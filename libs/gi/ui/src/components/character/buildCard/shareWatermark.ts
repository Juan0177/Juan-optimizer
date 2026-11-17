/*
 * A share picture's hidden record of how it was made (the app's version and build, when, and the
 * settings and builds it shows), for finding later what made a picture someone posted:
 * - in its pixels: one bit in each pixel's lowest blue bit, from the top left, row by row (an
 *   invisible change): "SOW1", a flags byte (1: gzip), the length (4 bytes, big-endian), then the
 *   bytes. It survives wherever the PNG's pixels do (not a JPEG re-encoding);
 * - in the PNG file: an iTXt chunk "stellar-optimizer" with the same JSON.
 * tools/site/read-share-png.mjs reads either back.
 */

const MAGIC = [0x53, 0x4f, 0x57, 0x31]
const KEYWORD = 'stellar-optimizer'

async function gzip(bytes: Uint8Array): Promise<Uint8Array | undefined> {
  if (typeof CompressionStream === 'undefined') return undefined
  const stream = new Blob([bytes as BlobPart])
    .stream()
    .pipeThrough(new CompressionStream('gzip'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

/** Writes `record` (as JSON) into the canvas's pixels, invisibly (see above); too large: not written */
export async function embedWatermark(
  canvas: HTMLCanvasElement,
  record: unknown
) {
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const json = new TextEncoder().encode(JSON.stringify(record))
  const zipped = await gzip(json)
  const body = zipped ?? json
  const bytes = new Uint8Array(9 + body.length)
  bytes.set(MAGIC, 0)
  bytes[4] = zipped ? 1 : 0
  new DataView(bytes.buffer).setUint32(5, body.length)
  bytes.set(body, 9)
  const bits = bytes.length * 8
  const w = canvas.width
  if (bits > w * canvas.height) return
  const rows = Math.ceil(bits / w)
  const img = ctx.getImageData(0, 0, w, rows)
  for (let i = 0; i < bits; i++) {
    const bit = (bytes[i >> 3] >> (7 - (i & 7))) & 1
    const p = i * 4 + 2
    img.data[p] = (img.data[p] & 0xfe) | bit
  }
  ctx.putImageData(img, 0, 0)
}

let crcTable: Uint32Array | undefined
function crc32(bytes: Uint8Array) {
  if (!crcTable) {
    crcTable = new Uint32Array(256)
    for (let n = 0; n < 256; n++) {
      let c = n
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      crcTable[n] = c >>> 0
    }
  }
  let crc = 0xffffffff
  for (const b of bytes) crc = crcTable[(crc ^ b) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

/** The PNG with `record` (as JSON) in an iTXt chunk before its end */
export async function pngWithRecord(blob: Blob, record: unknown) {
  const png = new Uint8Array(await blob.arrayBuffer())
  const enc = new TextEncoder()
  const keyword = enc.encode(KEYWORD)
  const text = enc.encode(JSON.stringify(record))
  // keyword, 0, compression flag 0, method 0, language "", 0, translated keyword "", 0, text
  const data = new Uint8Array(keyword.length + 5 + text.length)
  data.set(keyword, 0)
  data.set(text, keyword.length + 5)
  const type = enc.encode('iTXt')
  const typed = new Uint8Array(4 + data.length)
  typed.set(type, 0)
  typed.set(data, 4)
  const chunk = new Uint8Array(12 + data.length)
  const view = new DataView(chunk.buffer)
  view.setUint32(0, data.length)
  chunk.set(typed, 4)
  view.setUint32(8 + data.length, crc32(typed))
  // (before IEND: the last 12 bytes)
  const end = png.length - 12
  const out = new Uint8Array(png.length + chunk.length)
  out.set(png.subarray(0, end), 0)
  out.set(chunk, end)
  out.set(png.subarray(end), end + chunk.length)
  return new Blob([out as BlobPart], { type: 'image/png' })
}
