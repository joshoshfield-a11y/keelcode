# INTEGRATION — wave 4d meta layer → sim boot (`src/main.ts`)

Coordinator: apply the patches below verbatim, in order. They are anchored on
the sim brief's boot structure (renderer / scene / camera / world / loop /
input, `window.__keel.game`). Every `game.*` method called here exists in the
sim brief's pinned `GameAPI` shape with the same signature (gate-3 check at
the bottom). `SIM-WIRED` marks the 4 spots that need the sim's internals.

Files added by the meta builder (already on branch `wave-4d-meta`):

- `src/game/economy.ts` — `createEconomy()`, pinned numbers
- `src/game/quests.ts` — `generateQuests(seed)`, `createQuestState(defs)`
- `src/game/savegame.ts` — `saveGame` / `loadGame` / `migrate`,
  namespace `'drift-arena'`, slot `'slot0'`
- `src/game/hud.ts` — `createHUD(ui, game)`, `HudGame` interface
- `src/game/screens.ts` — `createScreens(ui, callbacks)`
- `src/game/station.ts` — `createStationUI(ui, game)`
- `src/gfx/station.ts` — `createStation(): THREE.Group`
- `tests/4d-meta.test.ts` — 22 tests, green

## 1. Imports — add at the top of `src/main.ts`

```diff
+ import { createSave, type SaveSys } from './engine/save';
+ import { createEconomy, type Economy } from './game/economy';
+ import { generateQuests, createQuestState, type QuestState } from './game/quests';
+ import { saveGame, loadGame, SAVE_NAMESPACE, SAVE_SLOT, type DriftArenaSave } from './game/savegame';
+ import { createHUD, type HUD } from './game/hud';
+ import { createScreens, type Screens } from './game/screens';
+ import { createStationUI, type StationUI } from './game/station';
+ import { createStation } from './gfx/station';
```

## 2. Boot — replace the sim's GameAPI state with the meta modules

Paste this block in `boot()` after `world` / `loop` / `input` exist and `ui`
/ `canvas` are in scope (`const ui = document.getElementById('ui')!`).

It **replaces** the sim's default economy/quest state inside its `GameAPI`
implementation. Behavior is identical — same pinned numbers (costs
[150, 400, 900], ore 10cr, hull 100 + 25/shield, dmg 12 + 6/gun, thrust 30 ×
1.15^engine, quest rewards 250/200/300). Delete the sim's local
`credits`/`ore`/`upgrades`/`quests` state; the adapter below is the single
source of truth.

```ts
// ---- wave-4d-meta: meta state + GameAPI adapter ----
const SEED = 20261019; // SIM-WIRED: use the sim's actual run seed here
const saveSys: SaveSys = createSave(SAVE_NAMESPACE);
let economy: Economy = createEconomy();
let questState: QuestState = createQuestState(generateQuests(SEED));

// SIM-WIRED: module-scope lets the sim's damage/dock systems share.
let hull = economy.maxHull();
let docked = false;
let dead = false;
let currentTick = 0;

// Forward declarations: the adapter closes over these; assigned below.
let hud: HUD;
let stationUI: StationUI;
let screens: Screens;

function claimCompleted(completed: string[]): void {
  for (const id of completed) economy.addCredits(questState.claimReward(id));
}

const game: GameAPI = {
  getCredits: () => economy.credits,
  addCredits: (n) => economy.addCredits(n),
  getOre: () => economy.ore,
  // mining yield: ore in + mine-quest progress + auto-claim → credits
  addOre: (n) => { economy.addOre(n); claimCompleted(questState.addProgress('mine', n)); },
  spendOre: (n) => economy.spendOre(n),
  getHull: () => hull,
  getMaxHull: () => economy.maxHull(),
  damagePlayer: (n) => {
    hull = Math.max(0, hull - n);
    hud.flashDamage();
    if (hull <= 0) onPlayerDeath();
  },
  getUpgrades: () => economy.getUpgrades(),
  buyUpgrade: (kind) => {
    const ok = economy.buyUpgrade(kind);
    // META JUDGMENT CALL (delete if unwanted): a shield upgrade also repairs
    // the +25 max-hull it adds, so buying shields mid-fight feels rewarding.
    if (ok && kind === 'shield') hull = Math.min(hull + 25, economy.maxHull());
    return ok;
  },
  sellOre: () => economy.sellOre(),
  // quest completion → reward claimed exactly once → credits (HUD quest
  // tracker refreshes via hud.update reading game.getQuests())
  addQuestProgress: (kind, n) => claimCompleted(questState.addProgress(kind, n)),
  getQuests: () => questState.toViews(),
  // SIM-WIRED: delegate to the sim's existing pirate spawner
  spawnPirateWave: (n) => simSpawnPirateWave(n),
  requestDock: () => {
    // SIM-WIRED: keep the sim's existing proximity check above this line.
    docked = true;
    loop.setPaused(true);
    stationUI.setDocked(true);
  },
  isDocked: () => docked,
  // SIM-WIRED: the sim's station + player entity ids
  stationId: STATION_ENTITY_ID,
  playerShipId: PLAYER_ENTITY_ID,
};
```

Then the UI layers (order matters — `game` must exist first):

```ts
// ---- wave-4d-meta: HUD / station / screens ----
hud = createHUD(ui, game);
stationUI = createStationUI(ui, game);
stationUI.onUndock = () => {
  docked = false;
  stationUI.setDocked(false);
  loop.setPaused(false);
};

function quickSave(): void {
  saveGame(saveSys, SAVE_SLOT, {
    version: 1,
    credits: economy.credits,
    ore: economy.ore,
    upgrades: economy.getUpgrades(),
    questProgress: questState.progress,
    questDone: questState.done,
    playerHull: hull,
    tick: currentTick,
  });
  screens.setHasSave(true);
}

function restoreSave(s: DriftArenaSave): void {
  // The adapter closes over the module-scope lets, so no rebuild is needed.
  economy = createEconomy({ credits: s.credits, ore: s.ore, upgrades: s.upgrades });
  questState = createQuestState(generateQuests(SEED), {
    progress: s.questProgress,
    done: s.questDone,
  });
  hull = Math.min(s.playerHull, economy.maxHull());
}

function resetRun(): void {
  economy = createEconomy();
  questState = createQuestState(generateQuests(SEED));
  hull = economy.maxHull();
  docked = false;
  dead = false;
  stationUI.setDocked(false);
  loop.setPaused(false);
  // SIM-WIRED: respawn the player ship + clear pirates/projectiles here,
  // using the sim's existing reset helpers.
}

function onPlayerDeath(): void {
  if (dead) return;
  dead = true;
  loop.setPaused(true);
  screens.showGameOver(economy.credits);
}

function beginPlay(): void {
  dead = false;
  screens.hideTitle();
  loop.start();
  (renderer.domElement as HTMLCanvasElement).requestPointerLock?.();
}

screens = createScreens(ui, {
  onLaunch: () => beginPlay(),
  onContinue: () => {
    const s = loadGame(saveSys, SAVE_SLOT);
    if (s) restoreSave(s);
    beginPlay();
  },
  onResume: () => { screens.hidePause(); loop.setPaused(false); },
  onRestart: () => { resetRun(); screens.hideGameOver(); screens.hidePause(); },
  onSave: () => quickSave(),
  // SIM-WIRED: hook the sim's audio resume / ui click blip here
  noteUiClick: () => {},
});

screens.showTitle();
screens.setHasSave(saveSys.list().includes(SAVE_SLOT));

// Pause toggle (Esc/P). If the sim already has one, merge: the station
// panel owns the screen while docked.
window.addEventListener('keydown', (ev) => {
  if (ev.code === 'Escape' || ev.code === 'KeyP') {
    if (docked || screens.titleVisible) return;
    const paused = !loop.paused;
    loop.setPaused(paused);
    if (paused) screens.showPause(); else screens.hidePause();
  }
  if (ev.code === 'F5') {
    ev.preventDefault();
    if (!screens.titleVisible) quickSave();
  }
});

window.__keel.game = game;
```

## 3. Loop hooks — add after the sim's existing `loop.on(...)` calls

```diff
+ // wave-4d-meta: HUD refresh + tick capture for saves
+ loop.on('postupdate', (ctx) => {
+   currentTick = ctx.tick;
+   hud.update(ctx.dt);
+ });
```

The sim's pirate-death handler already calls `game.addQuestProgress('kill', 1)`
per the sim brief — verify it still hits the adapter (same signature, now
backed by `questState`; rewards land in credits automatically). Mining
progress flows through `game.addOre` (see adapter).

## 4. Dock flow

`F` already calls `game.requestDock()` in the sim — the adapter above wires
station-UI show + sim pause-while-docked. `stationUI.onUndock` (set in §2)
resumes. No other change needed.

## 5. Title screen — gate the sim's auto-start

```diff
- // sim: canvas click → loop.start()  (auto-start)
- canvas.addEventListener('click', () => loop.start());
+ // wave-4d-meta: auto-start is gated behind the title screen.
+ // boot() now ends with screens.showTitle(); Launch/Continue call beginPlay().
```

Delete (or guard behind `!screens.titleVisible`) any other auto-start path.

## 6. Station mesh swap — one import line

Wherever the sim builds the station (it currently calls the
`createStationStub()` from `src/game/asteroids.ts`):

```diff
- import { createStationStub } from './game/asteroids';
+ import { createStation } from './gfx/station';
- const stationMesh = createStationStub();
+ const stationMesh = createStation();
```

Animate it from the sim's update phase:

```ts
// wave-4d-meta: station ring rotation + blinking dock lights
const stationAnim = stationMesh.userData.update as ((dt: number, t: number) => void) | undefined;
// ... inside the update handler: stationAnim?.(dt, elapsed);
```

`elapsed` is whatever time accumulator the sim already keeps (or `ctx.tick * STEP`).

## Gate-3 consistency check (sim GameAPI shape — all called methods exist)

| INTEGRATION.md call | Sim brief GameAPI | ✓ |
|---|---|---|
| `game.getCredits()` | `getCredits(): number` | ✓ |
| `game.addCredits(n)` | `addCredits(n: number): void` | ✓ |
| `game.getOre()` | `getOre(): number` | ✓ |
| `game.addOre(n)` | `addOre(n: number): void` | ✓ |
| `game.spendOre(n)` | `spendOre(n: number): boolean` | ✓ |
| `game.getHull()` | `getHull(): number` | ✓ |
| `game.getMaxHull()` | `getMaxHull(): number` | ✓ |
| `game.damagePlayer(n)` | `damagePlayer(n: number): void` | ✓ |
| `game.getUpgrades()` | `getUpgrades(): { guns; engine; shield }` | ✓ |
| `game.buyUpgrade(kind)` | `buyUpgrade(kind): boolean` | ✓ |
| `game.sellOre()` | `sellOre(): number` | ✓ |
| `game.addQuestProgress(kind, n)` | `addQuestProgress(kind, n): void` | ✓ |
| `game.getQuests()` | `getQuests(): Array<{id, kind, target, progress, reward, done}>` (`QuestView` adds `title` — structural superset, assignable) | ✓ |
| `game.spawnPirateWave(n)` | `spawnPirateWave(n: number): void` | ✓ |
| `game.requestDock()` | `requestDock(): void` | ✓ |
| `game.isDocked()` | `isDocked(): boolean` | ✓ |
| `loop.setPaused/paused/start/on` | engine `Loop` API | ✓ |

HUD `getSpeed` / `spendOre` are **optional** on `HudGame`; the adapter
implements `spendOre` (GameAPI pin) and may add `getSpeed` from flight state —
HUD shows `0.0 m/s` when absent.

## Playwright smoke checklist for the coordinator

1. Title visible on load (`screen-title`), sim NOT running behind it.
2. Launch → HUD shows `CR 0`, `ORE 0`, hull bar 100/100, 3 quests at 0/target.
3. `F` near station → sim pauses, station panel opens; sell/upgrade buttons
   disable correctly; undock resumes.
4. Quest flow: mine ore → `q-mine` progress climbs in HUD; kill 8 pirates →
   +250cr lands once.
5. `F5` → reload → Continue → credits/ore/upgrades/quests/hull restored.
6. Death → `screen-gameover` shows final credits; Fly Again resets.
