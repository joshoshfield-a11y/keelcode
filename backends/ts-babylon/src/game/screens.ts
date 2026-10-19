/** Screens: title / pause / game-over DOM overlays in #ui.
 *  data-testids for e2e: title-screen, start-button, pause-menu,
 *  resume-button, game-over-screen.
 *
 *  Unchanged from the ts-three reference (game/screens.ts) except the
 *  title subtitle names this backend. All data-testid hooks identical. */

const CSS = `
.kscreen { position:absolute; inset:0; z-index:30; display:flex; align-items:center; justify-content:center;
  background:rgba(10,14,20,.72); backdrop-filter:blur(3px); pointer-events:auto;
  font-family:system-ui,'Segoe UI',sans-serif; color:#fff; }
.kscreen.hidden { display:none; }
.kcard { text-align:center; max-width:440px; padding:34px 44px; background:rgba(20,26,34,.9);
  border:1px solid rgba(255,255,255,.14); border-radius:14px; box-shadow:0 12px 40px rgba(0,0,0,.5); }
.kcard h1 { margin:0 0 6px; font-size:42px; letter-spacing:2px; }
.kcard .sub { margin:0 0 18px; opacity:.7; font-size:14px; }
.kcard .start { font-size:17px; font-weight:700; margin:14px 0 18px; color:#9fd0ff; }
.kcontrols { text-align:left; font-size:13.5px; line-height:1.75; opacity:.85; margin:0 auto 6px;
  display:inline-block; }
.kcontrols b { color:#fff; background:rgba(255,255,255,.12); border:1px solid rgba(255,255,255,.2);
  border-radius:5px; padding:1px 7px; margin-right:6px; font-weight:600; }
.kbtnrow { display:flex; gap:10px; justify-content:center; margin-top:16px; flex-wrap:wrap; }
.kcard button { background:#2f6db3; color:#fff; border:none; border-radius:8px; padding:11px 22px;
  font:700 15px system-ui; cursor:pointer; }
.kcard button:hover { background:#3b80cc; }
.kcard button.ghost { background:rgba(255,255,255,.1); }
.kcard .score { font-size:26px; font-weight:800; margin:8px 0 4px; }
`;

export interface ScreenCallbacks {
  onStart: () => void;
  onResume: () => void;
  onRestart: () => void;
  onSave: () => void;
  noteUiClick: () => void;
}

export class Screens {
  private title: HTMLElement;
  private pause: HTMLElement;
  private over: HTMLElement;
  private overScore: HTMLElement;

  constructor(uiRoot: HTMLElement, cb: ScreenCallbacks) {
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    const click = (fn: () => void) => () => { cb.noteUiClick(); fn(); };

    this.title = document.createElement('div');
    this.title.className = 'kscreen';
    this.title.setAttribute('data-testid', 'title-screen');
    this.title.innerHTML = `
      <div class="kcard">
        <h1>KeelCode</h1>
        <p class="sub">wave 3 &middot; babylon slice</p>
        <div class="kbtnrow">
          <button data-testid="start-button" type="button">Click to start</button>
        </div>
        <div class="kcontrols" style="margin-top:18px">
          <div><b>W A S D</b> move (camera-relative)</div>
          <div><b>Mouse</b> look &middot; <b>Click</b> shoot</div>
          <div><b>Space</b> jump &middot; <b>Shift</b> sprint</div>
          <div><b>Esc / P</b> pause</div>
          <div style="margin-top:6px;opacity:.8">Touch: left stick moves, drag right side to look</div>
        </div>
      </div>`;

    this.pause = document.createElement('div');
    this.pause.className = 'kscreen hidden';
    this.pause.setAttribute('data-testid', 'pause-menu');
    this.pause.innerHTML = `
      <div class="kcard">
        <h1 style="font-size:30px">Paused</h1>
        <div class="kbtnrow">
          <button data-testid="resume-button" type="button">Resume</button>
          <button class="save ghost" type="button">Save</button>
          <button class="restart ghost" type="button">Restart</button>
        </div>
      </div>`;

    this.over = document.createElement('div');
    this.over.className = 'kscreen hidden';
    this.over.setAttribute('data-testid', 'game-over-screen');
    this.over.innerHTML = `
      <div class="kcard">
        <h1 style="font-size:30px">Game Over</h1>
        <div class="score">0</div>
        <div class="kbtnrow">
          <button class="restart" type="button">Restart</button>
        </div>
      </div>`;
    this.overScore = this.over.querySelector('.score') as HTMLElement;

    uiRoot.appendChild(this.title);
    uiRoot.appendChild(this.pause);
    uiRoot.appendChild(this.over);

    (this.title.querySelector('[data-testid="start-button"]') as HTMLElement)
      .addEventListener('click', click(cb.onStart));
    (this.pause.querySelector('[data-testid="resume-button"]') as HTMLElement)
      .addEventListener('click', click(cb.onResume));
    (this.pause.querySelector('.save') as HTMLElement).addEventListener('click', click(cb.onSave));
    (this.pause.querySelector('.restart') as HTMLElement).addEventListener('click', click(cb.onRestart));
    (this.over.querySelector('.restart') as HTMLElement).addEventListener('click', click(cb.onRestart));
  }

  addContinueButton(onContinue: () => void): void {
    const row = this.title.querySelector('.kbtnrow') as HTMLElement;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = 'Continue';
    btn.addEventListener('click', () => onContinue());
    row.appendChild(btn);
  }

  showTitle(): void {
    this.title.classList.remove('hidden');
    this.pause.classList.add('hidden');
    this.over.classList.add('hidden');
  }

  showPause(): void {
    this.pause.classList.remove('hidden');
  }

  hidePause(): void {
    this.pause.classList.add('hidden');
  }

  hideTitle(): void {
    this.title.classList.add('hidden');
  }

  get titleVisible(): boolean {
    return !this.title.classList.contains('hidden');
  }

  showGameOver(score: number): void {
    this.overScore.textContent = 'score ' + score;
    this.over.classList.remove('hidden');
  }

  hideGameOver(): void {
    this.over.classList.add('hidden');
  }
}
