/** Station UI: DOM trade panel shown while docked. No three.js here.
 *
 *  - Sell-ore button (ore count × 10cr)
 *  - Three upgrade buttons (level pips + next cost; disabled when maxed or unaffordable)
 *  - Quest board: the 3 generated quests with progress, plus a "Complete
 *    delivery" button for the deliver quest (spends 15 ore → 300cr)
 *  - Undock button (hands back to the coordinator via onUndock)
 *
 *  All buttons call the pinned HudGame methods only.
 */

import type { HudGame } from './hud';
import { UPGRADE_COSTS, MAX_UPGRADE_LEVEL, ORE_SELL_PRICE, type UpgradeKind } from './economy';

const CSS = `
.kstation { position:absolute; inset:0; z-index:20; display:flex; align-items:center; justify-content:center;
  pointer-events:auto; font-family:system-ui,'Segoe UI',sans-serif; color:#fff; }
.kstation.hidden { display:none; }
.kstation .panel { width:400px; max-height:86vh; overflow-y:auto; background:rgba(14,20,28,.96);
  border:1px solid rgba(255,209,102,.35); border-radius:12px; padding:20px 22px;
  box-shadow:0 12px 40px rgba(0,0,0,.6); }
.kstation h2 { margin:0 0 4px; font-size:20px; letter-spacing:1px; color:#ffd166; }
.kstation .credits { font-size:14px; font-weight:700; margin-bottom:12px; }
.kstation .sect { font-size:12px; letter-spacing:1.5px; opacity:.65; margin:14px 0 6px; }
.kstation button.row { display:flex; justify-content:space-between; align-items:center; width:100%;
  background:rgba(255,255,255,.06); color:#fff; border:1px solid rgba(255,255,255,.2); border-radius:8px;
  padding:10px 12px; font:600 14px system-ui; cursor:pointer; margin-bottom:6px; }
.kstation button.row:hover:not(:disabled) { background:rgba(255,255,255,.14); }
.kstation button.row:disabled { opacity:.38; cursor:default; }
.kstation .pips { color:#ffd166; letter-spacing:2px; }
.kstation .cost { opacity:.8; font-weight:400; font-size:13px; }
.kstation .quest { font-size:13px; background:rgba(255,255,255,.04); border:1px solid rgba(255,255,255,.14);
  border-radius:8px; padding:8px 10px; margin-bottom:6px; }
.kstation .quest .qt { font-weight:700; }
.kstation .quest.done { border-color:#7ce495; }
.kstation .quest .qd { opacity:.75; font-size:12.5px; margin:3px 0; }
.kstation .undock { width:100%; margin-top:14px; background:#2f6db3; color:#fff; border:none;
  border-radius:8px; padding:12px; font:700 15px system-ui; cursor:pointer; }
.kstation .undock:hover { background:#3b80cc; }
`;

const UPGRADE_LABEL: Record<UpgradeKind, string> = {
  guns: 'GUNS',
  engine: 'ENGINE',
  shield: 'SHIELD',
};

function pips(level: number): string {
  return '●'.repeat(level) + '○'.repeat(MAX_UPGRADE_LEVEL - level);
}

export interface StationUI {
  readonly el: HTMLElement;
  /** Wired by the coordinator: un-docks the sim (resume loop, hide panel). */
  onUndock: (() => void) | null;
  setDocked(docked: boolean): void;
  refresh(): void;
}

export function createStationUI(ui: HTMLElement, game: HudGame): StationUI {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);

  const root = document.createElement('div');
  root.className = 'kstation hidden';
  root.setAttribute('data-testid', 'station-panel');
  root.innerHTML = `
    <div class="panel">
      <h2>DRIFT STATION</h2>
      <div class="credits" data-testid="station-credits"></div>
      <div class="sect">TRADE</div>
      <button class="row" data-testid="station-sell" type="button"></button>
      <div class="sect">UPGRADES</div>
      <button class="row" data-testid="station-up-guns" type="button"></button>
      <button class="row" data-testid="station-up-engine" type="button"></button>
      <button class="row" data-testid="station-up-shield" type="button"></button>
      <div class="sect">QUEST BOARD</div>
      <div class="quests" data-testid="station-quests"></div>
      <button class="undock" data-testid="station-undock" type="button">UNDOCK</button>
    </div>`;
  ui.appendChild(root);

  const creditsEl = root.querySelector('[data-testid="station-credits"]') as HTMLElement;
  const sellBtn = root.querySelector('[data-testid="station-sell"]') as HTMLButtonElement;
  const upBtns: Record<UpgradeKind, HTMLButtonElement> = {
    guns: root.querySelector('[data-testid="station-up-guns"]') as HTMLButtonElement,
    engine: root.querySelector('[data-testid="station-up-engine"]') as HTMLButtonElement,
    shield: root.querySelector('[data-testid="station-up-shield"]') as HTMLButtonElement,
  };
  const questList = root.querySelector('[data-testid="station-quests"]') as HTMLElement;
  const undockBtn = root.querySelector('[data-testid="station-undock"]') as HTMLButtonElement;

  const station: StationUI = {
    el: root,
    onUndock: null,
    setDocked(docked: boolean): void {
      root.classList.toggle('hidden', !docked);
      if (docked) station.refresh();
    },
    refresh(): void {
      const credits = game.getCredits();
      const ore = game.getOre();
      const upgrades = game.getUpgrades();
      creditsEl.textContent = `Credits: ${credits}`;

      const earned = ore * ORE_SELL_PRICE;
      sellBtn.innerHTML = '';
      sellBtn.appendChild(document.createTextNode(`Sell ore: ${ore} × ${ORE_SELL_PRICE}cr`));
      const earn = document.createElement('span');
      earn.className = 'cost';
      earn.textContent = `+${earned}cr`;
      sellBtn.appendChild(earn);
      sellBtn.disabled = ore <= 0;

      for (const kind of ['guns', 'engine', 'shield'] as UpgradeKind[]) {
        const btn = upBtns[kind];
        const level = upgrades[kind];
        const cost = level >= MAX_UPGRADE_LEVEL ? null : UPGRADE_COSTS[level];
        btn.innerHTML = '';
        const label = document.createElement('span');
        label.textContent = UPGRADE_LABEL[kind] + ' ';
        const p = document.createElement('span');
        p.className = 'pips';
        p.textContent = pips(level);
        label.appendChild(p);
        const c = document.createElement('span');
        c.className = 'cost';
        c.textContent = cost === null ? 'MAX' : `${cost}cr`;
        btn.appendChild(label);
        btn.appendChild(c);
        btn.disabled = cost === null || credits < cost;
      }

      questList.innerHTML = '';
      for (const q of game.getQuests()) {
        const d = document.createElement('div');
        d.className = 'quest' + (q.done ? ' done' : '');
        const t = document.createElement('div');
        t.className = 'qt';
        t.textContent = `${q.title} — ${Math.min(q.progress, q.target)}/${q.target} · ${q.reward}cr` +
          (q.done ? ' ✓' : '');
        d.appendChild(t);
        const desc = document.createElement('div');
        desc.className = 'qd';
        desc.textContent = q.done ? 'Complete. Reward paid.' : 'Track progress on the HUD.';
        d.appendChild(desc);
        if (q.kind === 'deliver' && !q.done && ore >= q.target && game.spendOre) {
          const deliver = document.createElement('button');
          deliver.className = 'row';
          deliver.type = 'button';
          deliver.textContent = `Complete delivery — spend ${q.target} ore`;
          deliver.addEventListener('click', () => {
            if (game.spendOre && game.spendOre(q.target)) {
              game.addQuestProgress('deliver', q.target);
              station.refresh();
            }
          });
          d.appendChild(deliver);
        }
        questList.appendChild(d);
      }
    },
  };

  sellBtn.addEventListener('click', () => {
    game.sellOre();
    station.refresh();
  });
  for (const kind of ['guns', 'engine', 'shield'] as UpgradeKind[]) {
    upBtns[kind].addEventListener('click', () => {
      game.buyUpgrade(kind);
      station.refresh();
    });
  }
  undockBtn.addEventListener('click', () => {
    station.onUndock?.();
  });

  return station;
}
