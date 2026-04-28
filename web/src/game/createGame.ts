type HudState = {
  // 현재 점수(= 제거한 사과 개수 누적)
  score: number
  // 남은 시간(초). 내부적으로는 dt로 감소하는 float 값.
  timeLeftSec: number
  // 게임오버 여부(0초 도달)
  isGameOver: boolean
}

type CreateGameArgs = {
  // 렌더링 대상 캔버스
  canvas: HTMLCanvasElement
  // 타일 배경으로 쓰는 사과 스프라이트
  appleImg: HTMLImageElement
  // Canvas는 DOM을 직접 모르므로, 점수/시간 표시 같은 UI는 콜백으로 외부에 위임
  onHud: (state: HudState) => void
}

type Tile = {
  // 선택/삭제 안정성을 위한 고유 id
  id: number
  // 그리드 좌표
  col: number
  row: number
  // 사과에 표시될 숫자(1~9)
  value: number
}

type Rect = { x: number; y: number; w: number; h: number }

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n))
}

// (ax, ay) ~ (bx, by) 두 점으로부터 드래그 선택용 사각형을 만든다.
function rectFromPoints(ax: number, ay: number, bx: number, by: number): Rect {
  const x1 = Math.min(ax, bx)
  const y1 = Math.min(ay, by)
  const x2 = Math.max(ax, bx)
  const y2 = Math.max(ay, by)
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 }
}

// AABB 충돌(선택 사각형과 타일 사각형이 겹치면 선택됨)
function intersects(a: Rect, b: Rect) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
}

// 게임 리플레이성을 위해 "그럴듯한" 의사 난수 생성기(간단/빠름).
// (Math.random을 써도 되지만, 추후 시드 고정이 필요해질 때 대응이 쉬움)
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
  // 캔버스 안쪽 여백(보드가 화면에 꽉 차 보이지 않게)
  const padding = 14
  const topPad = 14
  // slightly tighter spacing so apples look bigger
  const cellGap = 6
  const bg = '#0f1220'
  const panel = '#171b2e'

  // These are in "game pixels" (will be scaled to DPR).
  // - gameW/H: 캔버스의 CSS 크기를 기준으로 한 논리 픽셀 크기
  // - 실제 canvas.width/height는 DPR을 곱해 고해상도로 잡고, ctx.setTransform으로 좌표계를 논리 픽셀로 맞춘다.
  let gameW = 760
  let gameH = 860
  let cellSize = 64
  let boardX = 0
  let boardY = 0

  // 타일은 "존재하는 것만" 배열에 담는다.
  // - 삭제 후 리필이 없으므로, 시간이 지날수록 tiles 길이가 줄어든다.
  let tiles: Tile[] = []
  let nextId = 1

  let score = 0
  const timeLimitSec = 120
  let timeLeftSec = timeLimitSec
  let isGameOver = false

  // 드래그 상태
  let dragging = false
  // 드래그 시작점/현재점(게임 좌표계)
  let dragStart: { x: number; y: number } | null = null
  let dragNow: { x: number; y: number } | null = null

  // 현재 선택된 타일과 합
  let selectedIds = new Set<number>()
  let selectedSum = 0

  // requestAnimationFrame 관리
  let raf = 0
  let lastTs = 0

  // 포인터 이벤트는 매우 자주/불규칙하게 들어올 수 있다.
  // 마지막 입력 좌표만 저장해두고, 실제 드래그 박스 업데이트는 매 프레임(tick)에서 스무딩하며 반영한다.
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
    // 이후 모든 그리기 코드는 "논리 픽셀(gameW/H)" 기준으로 작성할 수 있다.
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

    const usableW = gameW - padding * 2
    const usableH = gameH - (topPad + padding)
    const by = topPad + 56
    const bh = usableH - 72
    const bw = usableW

    const maxCellW = (bw - cellGap * (cols - 1)) / cols
    const maxCellH = (bh - cellGap * (rows - 1)) / rows
    // 셀 크기는 가로/세로 중 더 빡빡한 쪽에 맞춘다.
    cellSize = Math.floor(Math.min(maxCellW, maxCellH))

    const boardW = cellSize * cols + cellGap * (cols - 1)
    const boardH = cellSize * rows + cellGap * (rows - 1)
    boardX = Math.floor((gameW - boardW) / 2)
    boardY = Math.floor(by + (bh - boardH) / 2)
  }

  function tileRect(t: Tile): Rect {
    // 그리드 좌표를 실제 픽셀 사각형으로 변환한다.
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
    // 시작 시 전체 그리드를 타일로 채운다.
    tiles = []
    nextId = 1
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        tiles.push({ id: nextId++, col: c, row: r, value: randInt(1, 9) })
      }
    }
  }

  function computeSelection() {
    // 현재 드래그 박스(dragStart~dragNow)와 겹치는 타일을 모두 선택한다.
    // 인접 조건은 없고, 사각형에 "걸리기만" 하면 포함된다.
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
    // 합이 10일 때만 삭제(실패 시 보드 변화 없음)
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
    // 라운드 사각형 path 생성(채우기/스트로크는 호출부에서)
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
      // - cover: 타일을 꽉 채우되, 비율 유지(일부가 잘릴 수 있음)
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
      // 숫자는 이미지 위에서 가독성이 중요해서 굵은 글꼴 + 소프트 그림자를 사용한다.
      // (strokeText는 특정 글리프에서 깨진 선처럼 보이는 아티팩트가 발생할 수 있어 피한다.)
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
      // 드래그 중에는 선택 사각형을 항상 미리 보여준다.
      const sel = rectFromPoints(dragStart.x, dragStart.y, dragNow.x, dragNow.y)
      // 합이 10이면 성공(빨강), 아니면 진행 중(파랑 계열)
      const ok = selectedSum === 10 && selectedIds.size > 0
      ctx.fillStyle = ok ? 'rgba(255,65,65,0.15)' : 'rgba(106,171,255,0.12)'
      ctx.strokeStyle = ok ? 'rgba(255,90,90,0.85)' : 'rgba(106,171,255,0.85)'
      ctx.lineWidth = 3
      drawRoundedRect(sel, 14)
      ctx.fill()
      ctx.stroke()

      // sum badge
      // 선택 박스 안의 합계를 즉시 보여주면 플레이가 편해진다.
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
    // PointerEvent 좌표(clientX/Y)는 CSS 픽셀 기준.
    // 캔버스는 layout()에서 논리 픽셀(gameW/H)로 그리므로 비율 변환이 필요하다.
    const rect = canvas.getBoundingClientRect()
    const x = ((e.clientX - rect.left) / rect.width) * gameW
    const y = ((e.clientY - rect.top) / rect.height) * gameH
    return { x, y }
  }

  function onPointerDown(e: PointerEvent) {
    if (isGameOver) return
    // setPointerCapture를 해두면 드래그 중 캔버스 밖으로 나가도 pointermove/up을 놓치지 않는다.
    canvas.setPointerCapture(e.pointerId)
    const p = toCanvasPoint(e)
    dragging = true
    dragStart = p
    dragNow = p
    lastPointer = p
  }

  function onPointerMove(e: PointerEvent) {
    if (!dragging || isGameOver) return
    // 이벤트 핸들러에서는 "마지막 입력 좌표"만 갱신한다.
    // 실제 드래그 박스(dragNow) 업데이트는 tick()에서 스무딩하며 처리.
    lastPointer = toCanvasPoint(e)
  }

  function onPointerUp(e: PointerEvent) {
    if (!dragging) return
    lastPointer = toCanvasPoint(e)
    dragNow = lastPointer
    computeSelection()
    // 드래그 종료 시점에만 삭제 판정(합=10이면 삭제)
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
    // 탭 전환/렉 등으로 dt가 커지는 경우 드래그 스무딩/타이머가 급변하지 않도록 상한을 둔다.
    const dt = Math.min(0.05, (ts - lastTs) / 1000)
    lastTs = ts

    // Smooth dragging: update drag position once per frame
    if (dragging && dragStart && lastPointer) {
      // 이벤트 기반 갱신은 끊겨 보일 수 있어서, 프레임 기반 스무딩으로 "연속적인 드래그" 느낌을 만든다.
      // alpha는 프레임레이트에 덜 민감하도록 dt 기반으로 계산한다.
      const alpha = 1 - Math.pow(0.001, dt) // frame-rate independent
      const cur = dragNow ?? dragStart
      dragNow = {
        x: cur.x + (lastPointer.x - cur.x) * alpha,
        y: cur.y + (lastPointer.y - cur.y) * alpha,
      }
      computeSelection()
    }

    if (!isGameOver) {
      // 남은 시간 감소 → 0초면 게임오버
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

    // Pointer Events는 마우스/터치/펜을 통합해서 처리할 수 있어 모바일 대응이 쉽다.
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
    // 상태 초기화 후 보드를 다시 만든다.
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

