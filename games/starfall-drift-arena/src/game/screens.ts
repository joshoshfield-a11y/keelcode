/** Screens: title / pause / game-over DOM overlays in #ui.
 *
 *  data-testids: screen-title, btn-launch, btn-continue, screen-pause,
 *  btn-resume, btn-save, btn-restart, screen-gameover, gameover-credits.
 *
 *  The sim boots to the title screen; the sim's auto-start is gated behind
 *  onLaunch/onContinue (see INTEGRATION.md).
 */

const CSS = `
.kscreen { position:absolute; inset:0; z-index:30; display:flex; align-items:center; justify-content:center;
  background:rgba(8,12,18,.78); backdrop-filter:blur(3px); pointer-events:auto;
  font-family:system-ui,'Segoe UI',sans-serif; color:#fff; }
.kscreen.hidden { display:none; }
.kcard { text-align:center; max-width:480px; padding:34px 44px; background:rgba(16,22,30,.94);
  border:1px solid rgba(255,255,255,.14); border-radius:14px; box-shadow:0 12px 40px rgba(0,0,0,.5); }
.kcard h1 { margin:0 0 6px; font-size:40px; letter-spacing:3px;
  text-shadow:0 0 26px rgba(53,224,255,.35), 0 2px 6px rgba(0,0,0,.6); }
.kcard h1 .star { color:#ffd166; }
.kcard .sub { margin:0 0 18px; opacity:.7; font-size:14px; }
.kcontrols { text-align:left; font-size:13.5px; line-height:1.75; opacity:.85; margin:0 auto 6px;
  display:inline-block; }
.kcontrols b { color:#fff; background:rgba(255,255,255,.12); border:1px solid rgba(255,255,255,.2);
  border-radius:5px; padding:1px 7px; margin-right:6px; font-weight:600; }
.kbtnrow { display:flex; gap:10px; justify-content:center; margin-top:16px; flex-wrap:wrap; }
.kcard button { background:#2f6db3; color:#fff; border:none; border-radius:8px; padding:11px 22px;
  font:700 15px system-ui; cursor:pointer; }
.kcard button:hover { background:#3b80cc; }
.kcard button.ghost { background:rgba(255,255,255,.1); }
.kcard button.launch { background:#3fae5a; font-size:17px; padding:13px 34px; }
.kcard button.launch:hover { background:#4cc46a; }
.kcard .final { font-size:22px; font-weight:800; margin:10px 0 4px; color:#ffd166; }
`;

export interface ScreenCallbacks {
  onLaunch: () => void;
  onContinue: () => void;
  onResume: () => void;
  onRestart: () => void;
  onSave: () => void;
  noteUiClick: () => void;
}

export interface Screens {
  readonly title: HTMLElement;
  readonly pause: HTMLElement;
  readonly gameover: HTMLElement;
  /** Show/hide the Continue button depending on whether a save exists. */
  setHasSave(b: boolean): void;
  showTitle(): void;
  hideTitle(): void;
  showPause(): void;
  hidePause(): void;
  showGameOver(credits: number): void;
  hideGameOver(): void;
  readonly titleVisible: boolean;
}

export function createScreens(ui: HTMLElement, cb: ScreenCallbacks): Screens {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);

  const click = (fn: () => void) => () => {
    cb.noteUiClick();
    fn();
  };

  const title = document.createElement('div');
  title.className = 'kscreen';
  title.setAttribute('data-testid', 'screen-title');
  title.innerHTML = `
    <div class="kcard">
      <h1><span class="star">STARFALL</span>: Drift Arena</h1>
      <p class="sub">a KeelCode wave-4d vertical slice</p>
      <div class="kbtnrow">
        <button class="launch" data-testid="btn-launch" type="button">Launch</button>
        <button class="ghost" data-testid="btn-continue" type="button" style="display:none">Continue</button>
      </div>
      <div class="kcontrols" style="margin-top:18px">
        <div><b>Mouse</b> steer pitch/yaw</div>
        <div><b>W / S</b> thrust &middot; <b>A / D</b> strafe &middot; <b>Shift</b> boost</div>
        <div><b>Click</b> fire lasers &middot; <b>E</b> mining laser &middot; <b>F</b> dock at station</div>
        <div><b>Esc / P</b> pause &middot; <b>F5</b> quick save</div>
      </div>
    </div>`;

  const pause = document.createElement('div');
  pause.className = 'kscreen hidden';
  pause.setAttribute('data-testid', 'screen-pause');
  pause.innerHTML = `
    <div class="kcard">
      <h1 style="font-size:30px">Paused</h1>
      <div class="kbtnrow">
        <button data-testid="btn-resume" type="button">Resume</button>
        <button class="ghost" data-testid="btn-save" type="button">Save</button>
        <button class="ghost" data-testid="btn-restart" type="button">Restart</button>
      </div>
    </div>`;

  const gameover = document.createElement('div');
  gameover.className = 'kscreen hidden';
  gameover.setAttribute('data-testid', 'screen-gameover');
  gameover.innerHTML = `
    <div class="kcard">
      <h1 style="font-size:30px">Ship Lost</h1>
      <div class="final" data-testid="gameover-credits"></div>
      <p class="sub">The Drift claims another hull.</p>
      <div class="kbtnrow">
        <button data-testid="btn-restart" type="button">Fly Again</button>
      </div>
    </div>`;

  ui.appendChild(title);
  ui.appendChild(pause);
  ui.appendChild(gameover);

  (title.querySelector('[data-testid="btn-launch"]') as HTMLButtonElement)
    .addEventListener('click', click(cb.onLaunch));
  const continueBtn = title.querySelector('[data-testid="btn-continue"]') as HTMLButtonElement;
  continueBtn.addEventListener('click', click(cb.onContinue));
  (pause.querySelector('[data-testid="btn-resume"]') as HTMLButtonElement)
    .addEventListener('click', click(cb.onResume));
  (pause.querySelector('[data-testid="btn-save"]') as HTMLButtonElement)
    .addEventListener('click', click(cb.onSave));
  (pause.querySelector('[data-testid="btn-restart"]') as HTMLButtonElement)
    .addEventListener('click', click(cb.onRestart));
  (gameover.querySelector('[data-testid="btn-restart"]') as HTMLButtonElement)
    .addEventListener('click', click(cb.onRestart));

  const creditsEl = gameover.querySelector('[data-testid="gameover-credits"]') as HTMLElement;

  return {
    title,
    pause,
    gameover,
    setHasSave(b: boolean): void {
      continueBtn.style.display = b ? '' : 'none';
    },
    showTitle(): void {
      title.classList.remove('hidden');
      pause.classList.add('hidden');
      gameover.classList.add('hidden');
    },
    hideTitle(): void {
      title.classList.add('hidden');
    },
    showPause(): void {
      pause.classList.remove('hidden');
    },
    hidePause(): void {
      pause.classList.add('hidden');
    },
    showGameOver(credits: number): void {
      creditsEl.textContent = `Final credits: ${credits}`;
      gameover.classList.remove('hidden');
    },
    hideGameOver(): void {
      gameover.classList.add('hidden');
    },
    get titleVisible(): boolean {
      return !title.classList.contains('hidden');
    },
  };
}
