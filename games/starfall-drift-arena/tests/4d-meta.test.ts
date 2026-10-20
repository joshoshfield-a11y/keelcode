/** Wave 4d meta-layer tests: quest generation/determinism/completion/
 * single-claim, economy buy/sell math with the pinned numbers, save
 * round-trip + bad-version → null.
 *
 * Node environment (no DOM): covers the pure-logic modules only
 * (economy, quests, savegame). DOM layers (hud, station UI, screens,
 * gfx/station) are exercised by the coordinator in Playwright.
 */

import { describe, expect, it } from 'vitest';
import { createEconomy, ORE_SELL_PRICE, UPGRADE_COSTS } from '../src/game/economy';
import { generateQuests, createQuestState } from '../src/game/quests';
import { createSave } from '../src/engine/save';
import {
  saveGame,
  loadGame,
  migrate,
  SAVE_SLOT,
  type DriftArenaSave,
} from '../src/game/savegame';

describe('quests: generation', () => {
  it('produces exactly 3 quests with the pinned ids/kinds/targets/rewards', () => {
    const defs = generateQuests(1234);
    expect(defs).toHaveLength(3);
    expect(defs.map((d) => [d.id, d.kind, d.target, d.reward])).toEqual([
      ['q-kill', 'kill', 8, 250],
      ['q-mine', 'mine', 20, 200],
      ['q-deliver', 'deliver', 15, 300],
    ]);
  });

  it('is deterministic given the same seed', () => {
    expect(generateQuests(777)).toEqual(generateQuests(777));
  });

  it('keeps pinned numbers identical across seeds', () => {
    const a = generateQuests(1).map((d) => [d.id, d.kind, d.target, d.reward]);
    const b = generateQuests(99999).map((d) => [d.id, d.kind, d.target, d.reward]);
    expect(a).toEqual(b);
  });
});

describe('quests: progress/completion/claim', () => {
  it('completes kill-8 on exact target and pays 250 once', () => {
    const qs = createQuestState(generateQuests(42));
    expect(qs.addProgress('kill', 5)).toEqual([]);
    expect(qs.claimReward('q-kill')).toBe(0); // not done yet
    expect(qs.addProgress('kill', 3)).toEqual(['q-kill']);
    expect(qs.done['q-kill']).toBe(true);
    expect(qs.claimReward('q-kill')).toBe(250);
    expect(qs.claimReward('q-kill')).toBe(0); // single claim
  });

  it('completes mine-20 across several calls and pays 200', () => {
    const qs = createQuestState(generateQuests(42));
    expect(qs.addProgress('mine', 7)).toEqual([]);
    expect(qs.addProgress('mine', 13)).toEqual(['q-mine']);
    expect(qs.claimReward('q-mine')).toBe(200);
  });

  it('completes deliver-15 in one call and pays 300', () => {
    const qs = createQuestState(generateQuests(42));
    expect(qs.addProgress('deliver', 15)).toEqual(['q-deliver']);
    expect(qs.claimReward('q-deliver')).toBe(300);
  });

  it('never completes the same quest twice', () => {
    const qs = createQuestState(generateQuests(42));
    expect(qs.addProgress('kill', 8)).toEqual(['q-kill']);
    expect(qs.addProgress('kill', 100)).toEqual([]);
    expect(qs.claimReward('q-kill')).toBe(250);
  });

  it('toViews matches the GameAPI getQuests shape', () => {
    const qs = createQuestState(generateQuests(42));
    qs.addProgress('kill', 3);
    const views = qs.toViews();
    expect(views).toHaveLength(3);
    expect(views[0]).toMatchObject({ id: 'q-kill', kind: 'kill', target: 8, progress: 3, reward: 250, done: false });
  });

  it('restores progress/done from init', () => {
    const qs = createQuestState(generateQuests(42), {
      progress: { 'q-kill': 8 },
      done: { 'q-kill': true },
    });
    expect(qs.done['q-kill']).toBe(true);
    expect(qs.claimReward('q-kill')).toBe(250);
  });
});

describe('economy: pinned math', () => {
  it('sells ALL ore at 10/unit', () => {
    const e = createEconomy();
    e.addOre(17);
    expect(e.sellOre()).toBe(17 * ORE_SELL_PRICE);
    expect(e.ore).toBe(0);
    expect(e.credits).toBe(170);
    expect(e.sellOre()).toBe(0); // nothing left
  });

  it('buys upgrades at [150, 400, 900] and stops at level 3', () => {
    const e = createEconomy();
    e.addCredits(5000);
    for (const expected of [150, 400, 900]) {
      expect(UPGRADE_COSTS).toContain(expected);
      const before = e.credits;
      expect(e.buyUpgrade('guns')).toBe(true);
      expect(e.credits).toBe(before - expected);
    }
    expect(e.upgrades.guns).toBe(3);
    expect(e.buyUpgrade('guns')).toBe(false); // maxed
  });

  it('refuses purchases it cannot afford', () => {
    const e = createEconomy();
    e.addCredits(149);
    expect(e.buyUpgrade('shield')).toBe(false);
    expect(e.upgrades.shield).toBe(0);
    expect(e.credits).toBe(149);
  });

  it('derives hull/damage/thrust from upgrade levels', () => {
    const e = createEconomy();
    e.addCredits(100000);
    expect(e.maxHull()).toBe(100);
    expect(e.laserDamage()).toBe(12);
    expect(e.thrust()).toBe(30);
    e.buyUpgrade('shield');
    e.buyUpgrade('shield'); // level 2
    e.buyUpgrade('guns'); // level 1
    e.buyUpgrade('engine'); // level 1
    e.buyUpgrade('engine'); // level 2
    expect(e.maxHull()).toBe(100 + 25 * 2);
    expect(e.laserDamage()).toBe(12 + 6 * 1);
    expect(e.thrust()).toBeCloseTo(30 * (1 + 0.15 * 2), 9);
  });

  it('spendOre only spends when affordable', () => {
    const e = createEconomy();
    e.addOre(10);
    expect(e.spendOre(15)).toBe(false);
    expect(e.ore).toBe(10);
    expect(e.spendOre(10)).toBe(true);
    expect(e.ore).toBe(0);
  });
});

function makeSave(): DriftArenaSave {
  return {
    version: 1,
    credits: 1234,
    ore: 56,
    upgrades: { guns: 2, engine: 1, shield: 3 },
    questProgress: { 'q-kill': 5, 'q-mine': 20 },
    questDone: { 'q-kill': false, 'q-mine': true },
    playerHull: 87,
    tick: 4242,
  };
}

describe('savegame: round-trip', () => {
  it('saves and loads with identical state', () => {
    const sys = createSave('drift-arena');
    const state = makeSave();
    saveGame(sys, SAVE_SLOT, state);
    expect(loadGame(sys, SAVE_SLOT)).toEqual(state);
  });

  it('returns null when no save exists', () => {
    const sys = createSave('drift-arena');
    expect(loadGame(sys, SAVE_SLOT)).toBeNull();
  });
});

describe('savegame: migrate', () => {
  it('accepts a valid version-1 payload', () => {
    expect(migrate(makeSave())).toEqual(makeSave());
  });

  it('returns null for a future version', () => {
    expect(migrate({ ...makeSave(), version: 2 })).toBeNull();
    expect(migrate({ ...makeSave(), version: 99 })).toBeNull();
  });

  it('returns null for non-object or versionless payloads', () => {
    expect(migrate(null)).toBeNull();
    expect(migrate('garbage')).toBeNull();
    expect(migrate({ credits: 5 })).toBeNull();
  });

  it('loadGame returns null for a tampered future-version payload', () => {
    const sys = createSave('drift-arena');
    sys.save(SAVE_SLOT, {
      engine: 'keelcode',
      format_version: 1,
      seed: 0,
      tick: 0,
      components: { [-1]: { ...makeSave(), version: 7 } as unknown as Record<string, unknown> },
    });
    expect(loadGame(sys, SAVE_SLOT)).toBeNull();
  });

  it('loadGame returns null when the component key is missing', () => {
    const sys = createSave('drift-arena');
    sys.save(SAVE_SLOT, {
      engine: 'keelcode',
      format_version: 1,
      seed: 0,
      tick: 0,
      components: {},
    });
    expect(loadGame(sys, SAVE_SLOT)).toBeNull();
  });

  it('normalizes hostile-but-version-1 payloads without throwing', () => {
    const out = migrate({ version: 1, credits: -50, upgrades: { guns: 99 } });
    expect(out).not.toBeNull();
    expect(out!.credits).toBe(0);
    expect(out!.upgrades.guns).toBe(3);
    expect(out!.questProgress).toEqual({});
    expect(out!.questDone).toEqual({});
  });
});
