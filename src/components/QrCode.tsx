import qrcode from 'qrcode-generator'
import { useMemo } from 'react'

const QUIET = 4 // the blank margin scanners need, in modules

/** Medium error correction survives a scratched or dim phone screen. */
function encode(text: string) {
  const qr = qrcode(0, 'M')
  qr.addData(text)
  qr.make()
  return qr
}

/** A QR code drawn as one SVG path: crisp at any size, no canvas. */
export function QrCode({ text, size = 224, label }: { text: string; size?: number; label: string }) {
  const { count, path } = useMemo(() => {
    const qr = encode(text)
    const count = qr.getModuleCount()
    let path = ''
    for (let row = 0; row < count; row++) {
      for (let col = 0; col < count; col++) if (qr.isDark(row, col)) path += `M${col} ${row}h1v1h-1z`
    }
    return { count, path }
  }, [text])
  const side = count + QUIET * 2
  return (
    <svg role="img" aria-label={label} width={size} height={size} viewBox={`${-QUIET} ${-QUIET} ${side} ${side}`} shapeRendering="crispEdges">
      <rect x={-QUIET} y={-QUIET} width={side} height={side} fill="#fff" />
      <path d={path} fill="#000" />
    </svg>
  )
}

/** The same QR as a PNG data URL, for saving or sending as an image. */
export function qrPngDataUrl(text: string, scale = 8): string {
  const qr = encode(text)
  const count = qr.getModuleCount()
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = (count + QUIET * 2) * scale
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.fillStyle = '#000'
  for (let row = 0; row < count; row++) {
    for (let col = 0; col < count; col++) if (qr.isDark(row, col)) ctx.fillRect((col + QUIET) * scale, (row + QUIET) * scale, scale, scale)
  }
  return canvas.toDataURL('image/png')
}
