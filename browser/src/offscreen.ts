import { GIFEncoder, applyPalette, quantize } from "gifenc"
import { t } from "./shared/i18n/runtime"

// Mantém o service worker acordado enquanto o painel/relay está em uso.
// Offscreen documents não estão sujeitos ao limite de 30s do MV3.
setInterval(() => {
  chrome.runtime.sendMessage({ type: "SW_KEEPALIVE" }).catch(() => {
    // O service worker pode estar reiniciando; o próximo tick tenta de novo.
  })
}, 20_000)

let audioContext: AudioContext | null = null

function beep(): void {
  try {
    audioContext ??= new AudioContext()
    const now = audioContext.currentTime
    const tones = [880, 660]
    tones.forEach((frequency, index) => {
      const oscillator = audioContext!.createOscillator()
      const gain = audioContext!.createGain()
      oscillator.type = "sine"
      oscillator.frequency.value = frequency
      const start = now + index * 0.16
      gain.gain.setValueAtTime(0.0001, start)
      gain.gain.exponentialRampToValueAtTime(0.08, start + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.14)
      oscillator.connect(gain)
      gain.connect(audioContext!.destination)
      oscillator.start(start)
      oscillator.stop(start + 0.16)
    })
  } catch {
    // Autoplay bloqueado ou áudio indisponível.
  }
}

interface GifFrame {
  data: string
  label?: string
}

const MAX_WIDTH = 800

function drawLabel(context: CanvasRenderingContext2D, label: string, width: number, height: number): void {
  const text = label.slice(0, 60)
  context.save()
  context.font = "600 14px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
  const metrics = context.measureText(text)
  const padding = 8
  const boxWidth = Math.min(width - 16, metrics.width + padding * 2)
  const boxHeight = 24
  const x = 8
  const y = height - boxHeight - 8
  context.fillStyle = "rgba(20, 20, 19, 0.72)"
  context.beginPath()
  context.roundRect(x, y, boxWidth, boxHeight, 7)
  context.fill()
  context.fillStyle = "#faf9f5"
  context.textBaseline = "middle"
  context.fillText(text, x + padding, y + boxHeight / 2, boxWidth - padding * 2)
  context.restore()
}

async function encodeGif(
  frames: GifFrame[],
  delay: number,
): Promise<{ data?: string; error?: string }> {
  if (frames.length === 0) return { error: "Nenhum quadro para codificar." }
  const bitmaps: ImageBitmap[] = []
  let width = 0
  let height = 0
  try {
    for (const frame of frames) {
      const response = await fetch(`data:image/png;base64,${frame.data}`)
      const bitmap = await createImageBitmap(await response.blob())
      bitmaps.push(bitmap)
      if (width === 0) {
        const scale = Math.min(1, MAX_WIDTH / bitmap.width)
        width = Math.max(2, Math.round(bitmap.width * scale))
        height = Math.max(2, Math.round(bitmap.height * scale))
      }
    }

    const canvas = document.createElement("canvas")
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext("2d", { willReadFrequently: true })
    if (!context) return { error: t("offscreen.canvasUnavailable") }

    const encoder = GIFEncoder()
    for (const [index, bitmap] of bitmaps.entries()) {
      context.clearRect(0, 0, width, height)
      context.drawImage(bitmap, 0, 0, width, height)
      const label = frames[index]?.label
      if (label) drawLabel(context, label, width, height)
      const image = context.getImageData(0, 0, width, height)
      const palette = quantize(image.data, 256)
      const indexed = applyPalette(image.data, palette)
      encoder.writeFrame(indexed, width, height, { palette, delay })
    }
    encoder.finish()
    const bytes = encoder.bytes()
    let binary = ""
    const chunk = 0x8000
    for (let offset = 0; offset < bytes.length; offset += chunk) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + chunk))
    }
    return { data: btoa(binary) }
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Falha ao gerar o GIF." }
  } finally {
    for (const bitmap of bitmaps) bitmap.close()
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "PLAY_NOTIFICATION") {
    beep()
    return
  }
  if (message?.type === "ENCODE_GIF") {
    const frames = Array.isArray(message.frames) ? (message.frames as GifFrame[]) : []
    const delay = typeof message.delay === "number" ? message.delay : 600
    void encodeGif(frames, delay).then(sendResponse)
    return true
  }
})
