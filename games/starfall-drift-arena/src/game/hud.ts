/** HUD: DOM overlay in #ui — credits, ore, hull bar, shield note, quest
 *  tracker, speed. Updates read game state; dirty flags avoid DOM churn.
 *  Pure presentation: all numbers come through the HudGame interface, so the
 *  coordinator's GameAPI adapter satisfies it structurally.
 *
 *  data-testids: hud-credits, hud-ore, hud-hull, hud-shield, hud-quests,
 *  hud-speed.
 */

const CSS = `
.khud { position:absolute; inset:0; pointer-events:none; z-index:10;
  font-family:system-ui,'Segoe UI',sans-serif; color:#fff; }
.khud .tl { position:absolute; top:14px; left:14px; display:flex; flex-direction:column; gap:6px; }
.khud .hpwrap { width:240px; height:18px; background:rgba(0,0,0,.45); border:1px solid rgba(255,255,255,.35);
  border-radius:9px; overflow:hidden; position:relative; }
.khud .hpbar { height:100%; width:100%; background:linear-gradient(90deg,#3fae5a,#7ce495);
  transition:width .18s ease-out; }
.khud .hpbar.low { background:linear-gradient(90deg,#c0392b,#e67e22); }
.khud .hplabel { position:absolute; inset:0; display:flex; align-items:center; justify-content:center;
  font-size:11px; font-weight:700; text-shadow:0 1px 3px #000; }
.khud .row { display:flex; gap:14px; font-size:14px; font-weight:600; text-shadow:0 1px 4px rgba(0,0,0,.8); }
.khud .shieldnote { font-size:12px; opacity:.85; text-shadow:0 1px 3px #000; }
.khud .speed { position:absolute; bottom:12px; right:14px; font-size:13px; font-weight:600;
  text-shadow:0 1px 3px #000; }
.khud .quests { position:absolute; top:14px; right:14px; display:flex; flex-direction:column; gap:4px;
  max-width:280px; }
.khud .quest { font-size:12.5px; background:rgba(0,0,0,.45); border:1px solid rgba(255,255,255,.25);
  border-radius:7px; padding:5px 9px; text-shadow:0 1px 3px #000; }
.khud .quest .qtitle { font-weight:700; }
.khud .quest.done { border-color:#7ce495; color:#bdf3c9; }
.khud .docked { position:absolute; bottom:12px; left:14px; font-size:12px; font-weight:700;
  color:#9fd0ff; text-shadow:0 1px 3px #000; }
.kvig { position:absolute; inset:0; pointer-events:none; opacity:0;
  background:radial-gradient(ellipse at center, transparent 55%, rgba(190,30,20,.55) 100%); }
`;

export interface QuestView {
  id: string;
  kind: string;
  title: string;
  target: number;
  progress: number;
  reward: number;
  done: boolean;
}

/**
 * Structural subset of the sim's GameAPI that the UI layers consume.
 * Pin these exact names/signatures. `getSpeed` is optional: the sim's
 * GameAPI doesn't define it, so the coordinator may wire it from flight
 * state (HUD shows 0.0 when absent).
 */
export interface HudGame {
  getCredits(): number;
  getOre(): number;
  getHull(): number;
  getMaxHull(): number;
  getUpgrades(): { guns: number; engine: number; shield: number };
  addQuestProgress(kind: 'kill' | 'mine' | 'deliver', n: number): void;
  getQuests(): QuestView[];
  isDocked(): boolean;
  sellOre(): number;
  buyUpgrade(kind: 'guns' | 'engine' | 'shield'): boolean;
  /** Optional: the sim's GameAPI defines it; station deliver flow uses it when present. */
  spendOre?(n: number): boolean;
  getSpeed?(): number;
}

export interface HUD {
  readonly el: HTMLElement;
  /** Postupdate hook (also decays the damage vignette). */
  update(dt: number): void;
  flashDamage(): void;
}

export function createHUD(ui: HTMLElement, game: HudGame): HUD {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);

  const root = document.createElement('div');
  root.className = 'khud';
  root.setAttribute('data-testid', 'hud');
  root.innerHTML = `
    <div class="tl">
      <div class="hpwrap"><div class="hpbar"></div><div class="hplabel"></div></div>
      <div class="row">
        <span data-testid="hud-credits">CR 0</span>
        <span data-testid="hud-ore">ORE 0</span>
      </div>
      <div class="shieldnote" data-testid="hud-shield"></div>
    </div>
    <div class="quests" data-testid="hud-quests"></div>
    <div class="speed" data-testid="hud-speed"></div>
    <div class="docked" style="display:none">DOCKED — press undock at the station</div>
    <div class="kvig"></div>`;
  ui.appendChild(root);

  const hpBar = root.querySelector('.hpbar') as HTMLElement;
  const hpLabel = root.querySelector('.hplabel') as HTMLElement;
  const hpWrap = root.querySelector('.hpwrap') as HTMLElement;
  const creditsEl = root.querySelector('[data-testid="hud-credits"]') as HTMLElement;
  const oreEl = root.querySelector('[data-testid="hud-ore"]') as HTMLElement;
  const shieldEl = root.querySelector('[data-testid="hud-shield"]') as HTMLElement;
  const questEl = root.querySelector('[data-testid="hud-quests"]') as HTMLElement;
  const speedEl = root.querySelector('[data-testid="hud-speed"]') as HTMLElement;
  const dockedEl = root.querySelector('.docked') as HTMLElement;
  const vig = root.querySelector('.kvig') as HTMLElement;
  hpWrap.setAttribute('data-testid', 'hud-hull');

  let lastHull = -1;
  let lastMaxHull = -1;
  let lastCredits = -1;
  let lastOre = -1;
  let lastShield = '';
  let lastSpeed = '';
  let lastQuestSig = '';
  let lastDocked = false;
  let vigT = 0;

  function renderQuests(quests: QuestView[]): void {
    questEl.innerHTML = '';
    for (const q of quests) {
      const d = document.createElement('div');
      d.className = 'quest' + (q.done ? ' done' : '');
      const title = document.createElement('span');
      title.className = 'qtitle';
      title.textContent = q.done ? `✓ ${q.title}` : q.title;
      d.appendChild(title);
      d.appendChild(document.createTextNode(` ${Math.min(q.progress, q.target)}/${q.target} · ${q.reward}cr`));
      questEl.appendChild(d);
    }
  }

  const hud: HUD = {
    el: root,
    flashDamage(): void {
      vigT = 0.7;
    },
    update(dt: number): void {
      if (vigT > 0) {
        vigT = Math.max(0, vigT - dt);
        vig.style.opacity = String(Math.min(1, vigT * 1.6));
      }
      const hull = game.getHull();
      const maxHull = game.getMaxHull();
      if (hull !== lastHull || maxHull !== lastMaxHull) {
        lastHull = hull;
        lastMaxHull = maxHull;
        const pct = maxHull > 0 ? Math.max(0, (hull / maxHull) * 100) : 0;
        hpBar.style.width = pct + '%';
        hpBar.classList.toggle('low', pct < 30);
        hpLabel.textContent = `HULL ${Math.ceil(hull)}/${maxHull}`;
      }
      const credits = game.getCredits();
      if (credits !== lastCredits) {
        lastCredits = credits;
        creditsEl.textContent = `CR ${credits}`;
      }
      const ore = game.getOre();
      if (ore !== lastOre) {
        lastOre = ore;
        oreEl.textContent = `ORE ${ore}`;
      }
      const up = game.getUpgrades();
      const shieldSig = `${up.guns},${up.engine},${up.shield},${maxHull}`;
      if (shieldSig !== lastShield) {
        lastShield = shieldSig;
        shieldEl.textContent =
          `GUNS LV${up.guns} · ENG LV${up.engine} · SHIELD LV${up.shield} (+${up.shield * 25} hull)`;
      }
      const speed = game.getSpeed ? game.getSpeed() : 0;
      const speedTxt = `${speed.toFixed(1)} m/s`;
      if (speedTxt !== lastSpeed) {
        lastSpeed = speedTxt;
        speedEl.textContent = speedTxt;
      }
      const quests = game.getQuests();
      const sig = quests.map((q) => `${q.id}:${q.progress}:${q.done}`).join('|');
      if (sig !== lastQuestSig) {
        lastQuestSig = sig;
        renderQuests(quests);
      }
      const docked = game.isDocked();
      if (docked !== lastDocked) {
        lastDocked = docked;
        dockedEl.style.display = docked ? '' : 'none';
      }
    },
  };
  return hud;
}
