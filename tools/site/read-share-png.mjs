#!/usr/bin/env node
// Reads the hidden record of how a share picture was made (version, build, date, the team's KQM
// settings, written rotation and result: libs/gi/ui/.../buildCard/shareWatermark.ts).
//   node tools/site/read-share-png.mjs picture.png [--pixels]
// The PNG file's "stellar-optimizer" text first; else (a re-saved or pasted copy: the file's text
// gone, its pixels kept) the pixels' lowest blue bits. --pixels: the pixels only.
import { readFileSync } from 'node:fs'
import { gunzipSync, inflateSync } from 'node:zlib'

const [file, flag] = process.argv.slice(2)
if (!file) {
  console.error('usage: read-share-png.mjs <picture.png> [--pixels]')
  process.exit(2)
}
const png = readFileSync(file)
if (png.readUInt32BE(0) !== 0x89504e47) {
  console.error('Not a PNG (a JPEG keeps no record)')
  process.exit(1)
}

const chunks = []
for (let at = 8; at < png.length; ) {
  const length = png.readUInt32BE(at)
  const type = png.toString('latin1', at + 4, at + 8)
  chunks.push({ type, data: png.subarray(at + 8, at + 8 + length) })
  at += 12 + length
}

function fromText() {
  for (const { type, data } of chunks) {
    if (type !== 'iTXt') continue
    const end = data.indexOf(0)
    if (data.toString('latin1', 0, end) !== 'stellar-optimizer') continue
    // keyword 0, compressed, method, language 0, translated keyword 0, text
    const compressed = data[end + 1]
    let at = data.indexOf(0, end + 3) + 1
    at = data.indexOf(0, at) + 1
    const text = data.subarray(at)
    return (compressed ? inflateSync(text) : text).toString('utf8')
  }
  return undefined
}

function fromPixels() {
  const ihdr = chunks.find((c) => c.type === 'IHDR').data
  const width = ihdr.readUInt32BE(0)
  const height = ihdr.readUInt32BE(4)
  const depth = ihdr[8]
  const colorType = ihdr[9]
  const channels = { 2: 3, 6: 4 }[colorType]
  if (depth !== 8 || !channels || ihdr[12])
    throw new Error(
      `unsupported PNG (depth ${depth}, color type ${colorType}, interlaced ${ihdr[12]})`
    )
  const raw = inflateSync(
    Buffer.concat(chunks.filter((c) => c.type === 'IDAT').map((c) => c.data))
  )
  const stride = width * channels
  const blue = new Uint8Array(width * height)
  let prev = new Uint8Array(stride)
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1))
    const out = new Uint8Array(stride)
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? out[i - channels] : 0
      const b = prev[i]
      const c = i >= channels ? prev[i - channels] : 0
      let v = line[i]
      if (filter === 1) v += a
      else if (filter === 2) v += b
      else if (filter === 3) v += (a + b) >> 1
      else if (filter === 4) {
        const p = a + b - c
        const pa = Math.abs(p - a)
        const pb = Math.abs(p - b)
        const pc = Math.abs(p - c)
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c
      }
      out[i] = v & 0xff
    }
    for (let x = 0; x < width; x++) blue[y * width + x] = out[x * channels + 2]
    prev = out
  }
  const byte = (n) => {
    let v = 0
    for (let k = 0; k < 8; k++) v = (v << 1) | (blue[n * 8 + k] & 1)
    return v
  }
  const head = Buffer.from([0, 1, 2, 3].map(byte))
  if (head.toString('latin1') !== 'SOW1')
    throw new Error('no record in its pixels')
  const zipped = byte(4) & 1
  const length =
    ((byte(5) << 24) | (byte(6) << 16) | (byte(7) << 8) | byte(8)) >>> 0
  if ((9 + length) * 8 > blue.length)
    throw new Error('no record in its pixels (bad length)')
  const body = Buffer.alloc(length)
  for (let i = 0; i < length; i++) body[i] = byte(9 + i)
  return (zipped ? gunzipSync(body) : body).toString('utf8')
}

let json = flag === '--pixels' ? undefined : fromText()
let source = 'PNG text'
if (!json) {
  try {
    json = fromPixels()
    source = 'pixels'
  } catch (e) {
    console.error(`No record found: ${e.message}`)
    process.exit(1)
  }
}
console.error(`(from the ${source})`)
console.log(JSON.stringify(JSON.parse(json), null, 2))
