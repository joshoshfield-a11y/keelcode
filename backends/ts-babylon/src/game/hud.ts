/** HUD: DOM overlay in #ui — health bar, score, enemy count, seed,
 *  mute + save buttons, damage vignette. data-testid="hud" for e2e.
 *  Updates apply on change only (dirty flags); zero per-frame allocation.
 *
 *  Unchanged from the ts-three reference (game/hud.ts): the HUD stays
 *  DOM-based, no @babylonjs/gui. */

import type { AudioSys } from '../engine/audio';

const CSS = `
.khud { position:absolute; inset:0; pointer-events:none; z-index:10;
  font-family:system-ui,'Segoe UI',sans-serif; color:#fff; }
.khud .tl { position:absolute; top:14px; left:14px; display:flex; flex-direction:column; gap:8px; }
.khud .hpwrap { width:220px; height:18px; background:rgba(0,0,0,.45); border:1px solid rgba(255,255,255,.35);
  border-radius:9px; overflow:hidden; }
.khud .hpbar { height:100%; width:100%; background:linear-gradient(90deg,#3fae5a,#7ce495);
  transition:width .18s ease-out; }
.khud .hpbar.low { background:linear-gradient(90deg,#c0392b,#e67e22); }
.khud .row { display:flex; gap:14px; font-size:14px; font-weight:600; text-shadow:0 1px 4px rgba(0,0,0,.8); }
.khud .tr { position:absolute; top:14px; right:14px; display:flex; gap:8px; }
.khud .tr button { pointer-events:auto; background:rgba(0,0,0,.5); color:#fff;
  border:1px solid rgba(255,255,255,.35); border-radius:8px; padding:8px 12px;
  font:600 13px system-ui; cursor:pointer; }
.khud .tr button:hover { background:rgba(255,255,255,.18); }
.khud .seed { position:absolute; bottom:12px; left:14px; font-size:12px; opacity:.75; text-shadow:0 1px 3px #000; }
.kvig { position:absolute; inset:0; pointer-events:none; opacity:0;
  background:radial-gradient(ellipse at center, transparent 55%, rgba(190,30,20,.55) 100%); }
`;

export class HUD {
  private hpBar: HTMLElement;
  private scoreEl: HTMLElement;
  private enemyEl: HTMLElement;
  private muteBtn: HTMLButtonElement;
  private vig: HTMLElement;
  private vigT = 0;
  private lastHp = -1;
  private lastScore = -1;
  private lastEnemies = -1;
  private muted = false;

  constructor(
    uiRoot: HTMLElement,
    private audio: AudioSys,
    private onSave: () => void,
    private noteUiClick: () => void,
    seed: number,
  ) {
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    const root = document.createElement('div');
    root.className = 'khud';
    root.setAttribute('data-testid', 'hud');
    root.innerHTML = `
      <div class="tl">
        <div class="hpwrap"><div class="hpbar"></div></div>
        <div class="row"><span class="score">SCORE 0</span><span class="enemies">ENEMIES 0</span></div>
      </div>
      <div class="tr">
        <button class="mute" type="button">SOUND ON</button>
        <button class="save" type="button">SAVE</button>
      </div>
      <div class="seed">seed ${seed}</div>
      <div class="kvig"></div>`;
    uiRoot.appendChild(root);

    this.hpBar = root.querySelector('.hpbar') as HTMLElement;
    this.scoreEl = root.querySelector('.score') as HTMLElement;
    this.enemyEl = root.querySelector('.enemies') as HTMLElement;
    this.vig = root.querySelector('.kvig') as HTMLElement;
    this.muteBtn = root.querySelector('.mute') as HTMLButtonElement;
    const saveBtn = root.querySelector('.save') as HTMLButtonElement;

    this.muteBtn.addEventListener('click', () => {
      this.noteUiClick();
      this.muted = !this.muted;
      this.audio.setMuted(this.muted);
      this.muteBtn.textContent = this.muted ? 'SOUND OFF' : 'SOUND ON';
      this.audio.play('ui');
    });
    saveBtn.addEventListener('click', () => {
      this.noteUiClick();
      this.onSave();
      this.audio.play('ui');
    });
  }

  setHealth(hp: number, max: number): void {
    if (hp === this.lastHp) return;
    this.lastHp = hp;
    const pct = Math.max(0, (hp / max) * 100);
    this.hpBar.style.width = pct + '%';
    this.hpBar.classList.toggle('low', pct < 30);
  }

  setScore(s: number): void {
    if (s === this.lastScore) return;
    this.lastScore = s;
    this.scoreEl.textContent = 'SCORE ' + s;
  }

  setEnemies(n: number): void {
    if (n === this.lastEnemies) return;
    this.lastEnemies = n;
    this.enemyEl.textContent = 'ENEMIES ' + n;
  }

  flashDamage(): void {
    this.vigT = 0.7;
  }

  /** Postupdate: decay vignette. */
  update(dt: number): void {
    if (this.vigT > 0) {
      this.vigT = Math.max(0, this.vigT - dt);
      this.vig.style.opacity = String(Math.min(1, this.vigT * 1.6));
    }
  }
}
