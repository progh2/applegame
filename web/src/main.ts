import './style.css'
import appleUrl from './assets/apple.png'
import { createGame } from './game/createGame'

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

function loadImage(url: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error(`Failed to load image: ${url}`))
    img.src = url
  })
}

async function boot() {
  const appleImg = await loadImage(appleUrl)

  const game = createGame({
    canvas,
    appleImg,
    onHud: ({ score, timeLeftSec, isGameOver }) => {
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

  const restart = () => game.restart()
  document.querySelector<HTMLButtonElement>('#restart')!.addEventListener('click', restart)
  document.querySelector<HTMLButtonElement>('#restart2')!.addEventListener('click', restart)

  game.start()
}

boot()
