import type { Cdp } from "./cdp"

export interface RecordedFrame {
  data: string
  label: string
}

const MAX_FRAMES = 30

export class Recording {
  private sessionID: string | null = null
  private frames: RecordedFrame[] = []
  private queue: Promise<void> = Promise.resolve()

  constructor(private readonly cdp: Cdp) {}

  get active(): boolean {
    return this.sessionID !== null
  }

  get count(): number {
    return this.frames.length
  }

  start(sessionID: string): void {
    this.sessionID = sessionID
    this.frames = []
    this.queue = Promise.resolve()
  }

  async stop(): Promise<void> {
    await this.flush()
    this.sessionID = null
  }

  async take(): Promise<RecordedFrame[]> {
    await this.flush()
    return [...this.frames]
  }

  async flush(): Promise<void> {
    await this.queue.catch(() => undefined)
  }

  clear(): void {
    this.frames = []
  }

  capture(tabId: number, label: string): Promise<void> {
    if (!this.sessionID || this.frames.length >= MAX_FRAMES) return Promise.resolve()
    this.queue = this.queue.then(async () => {
      if (!this.sessionID || this.frames.length >= MAX_FRAMES) return
      try {
        const data = await this.cdp.screenshot(tabId)
        this.frames.push({ data, label })
      } catch {
        // Aba fechada ou DevTools aberto; ignora o quadro.
      }
    })
    return this.queue
  }
}
