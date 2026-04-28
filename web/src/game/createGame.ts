type HudState = {
  score: number
  timeLeftSec: number
  isGameOver: boolean
}

type CreateGameArgs = {
  canvas: HTMLCanvasElement
  appleImg: HTMLImageElement
  onHud: (state: HudState) => void
}

type Tile = {
  id: number
  col: number
  row: number
  value: number
}

type Rect = { x: number; y: number; w: number; h: number }

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n))
}

function rectFromPoints(ax: number, ay: number, bx: number, by: number): Rect {
  const x1 = Math.min(ax, bx)
  const y1 = Math.min(ay, by)
  const x2 = Math.max(ax, bx)
  const y2 = Math.max(ay, by)
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 }
}

function intersects(a: Rect, b: Rect) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
}

function mulberry32(seed: number) {
  let t = seed >>> 0
  return () => {
    t += 0x6d2b79f5
    let x = t
    x = Math.imul(x ^ (x >>> 15), x | 1)
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61)
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296
  }
}

export function createGame({ canvas, appleImg, onHud }: CreateGameArgs) {
  const ctx = canvas.getContext('2d')!

  // 20 * 10 fixed grid (as requested)
  const cols = 20
  const rows = 10
  const padding = 14
  const topPad = 14
  // slightly tighter spacing so apples look bigger
  const cellGap = 6
  const bg = '#0f1220'
  const panel = '#171b2e'

  // These are in "game pixels" (will be scaled to DPR).
  let gameW = 760
  let gameH = 860
  let cellSize = 64
  let boardX = 0
  let boardY = 0

  let tiles: Tile[] = []
  let nextId = 1

  let score = 0
  const timeLimitSec = 120
  let timeLeftSec = timeLimitSec
  let isGameOver = false

  let dragging = false
  let dragStart: { x: number; y: number } | null = null
  let dragNow: { x: number; y: number } | null = null

  let selectedIds = new Set<number>()
  let selectedSum = 0

  let raf = 0
  let lastTs = 0

  let lastPointer: { x: number; y: number } | null = null

  const rand = mulberry32(Date.now())
  const randInt = (min: number, max: number) => Math.floor(rand() * (max - min + 1)) + min

  function layout() {
    const dpr = window.devicePixelRatio || 1
    const rect = canvas.getBoundingClientRect()
    const cssW = Math.max(320, rect.width)
    const cssH = Math.max(480, rect.height)

    // Size game resolution based on available CSS size.
    // Keep a stable board aspect, but allow vertical room for small help area.
    gameW = Math.round(cssW)
    gameH = Math.round(cssH)

    canvas.width = Math.round(gameW * dpr)
    canvas.height = Math.round(gameH * dpr)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

    const usableW = gameW - padding * 2
    const usableH = gameH - (topPad + padding)
    const by = topPad + 56
    const bh = usableH - 72
    const bw = usableW

    const maxCellW = (bw - cellGap * (cols - 1)) / cols
    const maxCellH = (bh - cellGap * (rows - 1)) / rows
    cellSize = Math.floor(Math.min(maxCellW, maxCellH))

    const boardW = cellSize * cols + cellGap * (cols - 1)
    const boardH = cellSize * rows + cellGap * (rows - 1)
    boardX = Math.floor((gameW - boardW) / 2)
    boardY = Math.floor(by + (bh - boardH) / 2)
  }

  function tileRect(t: Tile): Rect {
    return {
      x: boardX + t.col * (cellSize + cellGap),
      y: boardY + t.row * (cellSize + cellGap),
      w: cellSize,
      h: cellSize,
    }
  }

  // Note: we intentionally allow drags starting anywhere on the board canvas,
  // so we don't need a "tile pick" helper here.

  function buildInitialBoard() {
    tiles = []
    nextId = 1
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        tiles.push({ id: nextId++, col: c, row: r, value: randInt(1, 9) })
      }
    }
  }

  function computeSelection() {
    selectedIds = new Set()
    selectedSum = 0
    if (!dragging || !dragStart || !dragNow) return
    const sel = rectFromPoints(dragStart.x, dragStart.y, dragNow.x, dragNow.y)
    for (const t of tiles) {
      if (intersects(sel, tileRect(t))) {
        selectedIds.add(t.id)
        selectedSum += t.value
      }
    }
  }

  function removeSelected() {
    if (selectedSum !== 10 || selectedIds.size === 0) return false
    const removedCount = selectedIds.size
    tiles = tiles.filter((t) => !selectedIds.has(t.id))
    score += removedCount
    selectedIds.clear()
    selectedSum = 0
    return true
  }

  function clear() {
    ctx.clearRect(0, 0, gameW, gameH)
  }

  function drawRoundedRect(r: Rect, radius: number) {
    const rr = clamp(radius, 0, Math.min(r.w, r.h) / 2)
    const x = r.x
    const y = r.y
    const w = r.w
    const h = r.h
    ctx.beginPath()
    ctx.moveTo(x + rr, y)
    ctx.arcTo(x + w, y, x + w, y + h, rr)
    ctx.arcTo(x + w, y + h, x, y + h, rr)
    ctx.arcTo(x, y + h, x, y, rr)
    ctx.arcTo(x, y, x + w, y, rr)
    ctx.closePath()
  }

  function draw() {
    clear()

    // Background
    ctx.fillStyle = bg
    ctx.fillRect(0, 0, gameW, gameH)

    // Board panel
    const panelRect: Rect = {
      x: padding,
      y: topPad + 44,
      w: gameW - padding * 2,
      h: gameH - (topPad + 44) - padding,
    }
    ctx.fillStyle = panel
    drawRoundedRect(panelRect, 18)
    ctx.fill()

    // Tiles
    for (const t of tiles) {
      const r = tileRect(t)
      const selected = selectedIds.has(t.id)

      // soft shadow
      ctx.fillStyle = selected ? 'rgba(255,80,80,0.18)' : 'rgba(0,0,0,0.18)'
      drawRoundedRect({ x: r.x + 2, y: r.y + 4, w: r.w, h: r.h }, 18)
      ctx.fill()

      // tile body: draw apple image "cover" style
      ctx.save()
      drawRoundedRect(r, 18)
      ctx.clip()
      ctx.fillStyle = selected ? 'rgba(255,255,255,0.10)' : 'rgba(255,255,255,0.06)'
      ctx.fillRect(r.x, r.y, r.w, r.h)

      const iw = appleImg.naturalWidth
      const ih = appleImg.naturalHeight
      const scale = Math.max(r.w / iw, r.h / ih)
      const dw = iw * scale
      const dh = ih * scale
      const dx = r.x + (r.w - dw) / 2
      const dy = r.y + (r.h - dh) / 2
      ctx.globalAlpha = 0.95
      ctx.drawImage(appleImg, dx, dy, dw, dh)
      ctx.restore()

      // border
      ctx.strokeStyle = selected ? 'rgba(255,100,100,0.75)' : 'rgba(255,255,255,0.12)'
      ctx.lineWidth = selected ? 3 : 2
      drawRoundedRect(r, 18)
      ctx.stroke()

      // number text
      const tx = r.x + r.w / 2
      const ty = r.y + r.h / 2 + 2

      ctx.font = `900 ${Math.floor(cellSize * 0.42)}px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'

      // Avoid strokeText artifacts (can look like cracks/marks on some glyphs, e.g. "2").
      // Use a soft shadow instead for readability.
      ctx.save()
      ctx.shadowColor = 'rgba(0,0,0,0.55)'
      ctx.shadowBlur = 10
      ctx.shadowOffsetX = 0
      ctx.shadowOffsetY = 2
      ctx.fillStyle = 'rgba(255,255,255,0.97)'
      ctx.fillText(String(t.value), tx, ty)
      ctx.restore()
    }

    // Selection rectangle
    if (dragging && dragStart && dragNow) {
      const sel = rectFromPoints(dragStart.x, dragStart.y, dragNow.x, dragNow.y)
      const ok = selectedSum === 10 && selectedIds.size > 0
      ctx.fillStyle = ok ? 'rgba(255,65,65,0.15)' : 'rgba(106,171,255,0.12)'
      ctx.strokeStyle = ok ? 'rgba(255,90,90,0.85)' : 'rgba(106,171,255,0.85)'
      ctx.lineWidth = 3
      drawRoundedRect(sel, 14)
      ctx.fill()
      ctx.stroke()

      // sum badge
      const badge = `${selectedSum}${selectedIds.size ? '' : ''}`
      ctx.font = `700 18px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif`
      ctx.textAlign = 'left'
      ctx.textBaseline = 'top'
      const pad = 8
      const bw = ctx.measureText(badge).width + pad * 2
      const bh = 28
      const bx = clamp(sel.x + 8, padding, gameW - padding - bw)
      const by = clamp(sel.y + 8, padding, gameH - padding - bh)
      ctx.fillStyle = ok ? 'rgba(255,80,80,0.90)' : 'rgba(18,22,38,0.85)'
      ctx.strokeStyle = ok ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.12)'
      ctx.lineWidth = 2
      drawRoundedRect({ x: bx, y: by, w: bw, h: bh }, 10)
      ctx.fill()
      ctx.stroke()
      ctx.fillStyle = 'rgba(255,255,255,0.95)'
      ctx.fillText(badge, bx + pad, by + 6)
    }

    // Top meta line inside canvas
    ctx.fillStyle = 'rgba(255,255,255,0.88)'
    ctx.font = '700 18px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif'
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    ctx.fillText(`Score: ${score}`, padding + 2, topPad + 22)
    ctx.textAlign = 'right'
    ctx.fillText(`Time: ${Math.max(0, Math.ceil(timeLeftSec))}s`, gameW - padding - 2, topPad + 22)

    if (isGameOver) {
      ctx.fillStyle = 'rgba(0,0,0,0.45)'
      ctx.fillRect(0, 0, gameW, gameH)
      ctx.fillStyle = 'rgba(255,255,255,0.95)'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.font = '800 44px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif'
      ctx.fillText('Game Over', gameW / 2, gameH / 2 - 18)
      ctx.font = '700 22px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif'
      ctx.fillText(`Score: ${score}`, gameW / 2, gameH / 2 + 26)
    }
  }

  function toCanvasPoint(e: PointerEvent) {
    const rect = canvas.getBoundingClientRect()
    const x = ((e.clientX - rect.left) / rect.width) * gameW
    const y = ((e.clientY - rect.top) / rect.height) * gameH
    return { x, y }
  }

  function onPointerDown(e: PointerEvent) {
    if (isGameOver) return
    canvas.setPointerCapture(e.pointerId)
    const p = toCanvasPoint(e)
    dragging = true
    dragStart = p
    dragNow = p
    lastPointer = p
  }

  function onPointerMove(e: PointerEvent) {
    if (!dragging || isGameOver) return
    lastPointer = toCanvasPoint(e)
  }

  function onPointerUp(e: PointerEvent) {
    if (!dragging) return
    lastPointer = toCanvasPoint(e)
    dragNow = lastPointer
    computeSelection()
    removeSelected()
    dragging = false
    dragStart = null
    dragNow = null
    selectedIds.clear()
    selectedSum = 0
    lastPointer = null
  }

  function onResize() {
    layout()
    draw()
  }

  function tick(ts: number) {
    if (!lastTs) lastTs = ts
    const dt = Math.min(0.05, (ts - lastTs) / 1000)
    lastTs = ts

    // Smooth dragging: update drag position once per frame
    if (dragging && dragStart && lastPointer) {
      // simple smoothing (critically damped-ish) so it feels like a continuous box drag
      const alpha = 1 - Math.pow(0.001, dt) // frame-rate independent
      const cur = dragNow ?? dragStart
      dragNow = {
        x: cur.x + (lastPointer.x - cur.x) * alpha,
        y: cur.y + (lastPointer.y - cur.y) * alpha,
      }
      computeSelection()
    }

    if (!isGameOver) {
      timeLeftSec -= dt
      if (timeLeftSec <= 0) {
        timeLeftSec = 0
        isGameOver = true
        dragging = false
        dragStart = null
        dragNow = null
        selectedIds.clear()
        selectedSum = 0
      }
    }

    onHud({ score, timeLeftSec, isGameOver })
    draw()
    raf = requestAnimationFrame(tick)
  }

  function start() {
    // Set up a nice default CSS size; layout() will compute gameW/H from it.
    // Wider board needs a bit more horizontal room.
    if (!canvas.style.width) canvas.style.width = 'min(96vw, 1120px)'
    // Slightly taller to keep apples comfortably large.
    if (!canvas.style.height) canvas.style.height = 'min(82vh, 920px)'

    layout()
    buildInitialBoard()
    onHud({ score, timeLeftSec, isGameOver })

    canvas.addEventListener('pointerdown', onPointerDown)
    canvas.addEventListener('pointermove', onPointerMove)
    canvas.addEventListener('pointerup', onPointerUp)
    canvas.addEventListener('pointercancel', onPointerUp)
    window.addEventListener('resize', onResize)

    cancelAnimationFrame(raf)
    lastTs = 0
    raf = requestAnimationFrame(tick)
  }

  function restart() {
    score = 0
    timeLeftSec = timeLimitSec
    isGameOver = false
    dragging = false
    dragStart = null
    dragNow = null
    selectedIds.clear()
    selectedSum = 0
    layout()
    buildInitialBoard()
    onHud({ score, timeLeftSec, isGameOver })
  }

  return { start, restart }
}

