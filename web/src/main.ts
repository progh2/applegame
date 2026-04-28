import './style.css'
import appleUrl from './assets/apple.png'
import { createGame } from './game/createGame'

// UI는 DOM으로, 게임은 Canvas로 렌더링한다.
// - DOM: 점수/타이머/버튼/게임오버 오버레이
// - Canvas: 사과 타일 그리드 + 드래그 선택 박스
document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
  <div class="appShell">
    <header class="topBar">
      <div class="brand">
        <div class="title">Apple Box</div>
        <div class="subtitle">드래그로 합이 10이 되게 선택하세요</div>
      </div>
      <div class="hud">
        <div class="pill"><span class="label">점수</span> <span id="score">0</span></div>
        <div class="pill"><span class="label">시간</span> <span id="time">120</span>s</div>
        <button id="restart" class="btn" type="button">재시작</button>
      </div>
    </header>

    <main class="stage">
      <div class="canvasWrap">
        <canvas id="game" class="gameCanvas"></canvas>
        <div id="gameover" class="gameOver hidden">
          <div class="card">
            <div class="goTitle">게임 오버</div>
            <div class="goScore">점수: <span id="finalScore">0</span></div>
            <button id="restart2" class="btn primary" type="button">다시 하기</button>
          </div>
        </div>
      </div>
      <div class="help">
        - 박스 안의 숫자 합이 <b>10</b>이면 놓는 순간 제거됩니다.<br/>
        - 붙어있지 않아도 박스 안에 들어오면 합산됩니다.
      </div>
    </main>
  </div>
`

const canvas = document.querySelector<HTMLCanvasElement>('#game')!
const scoreEl = document.querySelector<HTMLSpanElement>('#score')!
const timeEl = document.querySelector<HTMLSpanElement>('#time')!
const gameoverEl = document.querySelector<HTMLDivElement>('#gameover')!
const finalScoreEl = document.querySelector<HTMLSpanElement>('#finalScore')!

// Vite에서 번들된 asset URL을 실제 이미지로 로드하기 위한 헬퍼.
// (Canvas에서는 <img> 엘리먼트가 아니라 HTMLImageElement가 필요)
function loadImage(url: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error(`Failed to load image: ${url}`))
    img.src = url
  })
}

async function boot() {
  // 게임에서 사용할 사과 스프라이트를 먼저 로드한다.
  const appleImg = await loadImage(appleUrl)

  // 게임 로직 생성. HUD(점수/시간/게임오버) 갱신은 콜백으로 받는다.
  const game = createGame({
    canvas,
    appleImg,
    onHud: ({ score, timeLeftSec, isGameOver }) => {
      // 시간은 소수로 줄어들기 때문에, UI에서는 초 단위로 보기 좋게 올림 처리한다.
      scoreEl.textContent = String(score)
      timeEl.textContent = String(Math.max(0, Math.ceil(timeLeftSec)))

      if (isGameOver) {
        finalScoreEl.textContent = String(score)
        gameoverEl.classList.remove('hidden')
      } else {
        gameoverEl.classList.add('hidden')
      }
    },
  })

  // 재시작 버튼은 동일한 restart 로직을 공유한다.
  const restart = () => game.restart()
  document.querySelector<HTMLButtonElement>('#restart')!.addEventListener('click', restart)
  document.querySelector<HTMLButtonElement>('#restart2')!.addEventListener('click', restart)

  // requestAnimationFrame 루프 시작.
  game.start()
}

// 엔트리 포인트
boot()
