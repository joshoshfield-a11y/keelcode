/** Economy: credits, ore, and ship upgrades. Pure logic + state, no DOM.
 *
 * Pinned numbers (identical in sim + meta briefs — never change):
 * - Upgrade costs (guns/engine/shield), level 0→3: next-level cost [150, 400, 900]
 * - Ore sell price: 10 credits/unit (sellOre sells ALL ore)
 * - Player base: hull 100, laser damage 12, thrust 30
 * - Per shield level: +25 maxHull. Per gun level: +6 laser damage.
 * - Per engine level: +15% thrust
 */

export type UpgradeKind = 'guns' | 'engine' | 'shield';

export interface UpgradeLevels {
  guns: number;
  engine: number;
  shield: number;
}

export const ORE_SELL_PRICE = 10;
export const UPGRADE_COSTS: readonly [number, number, number] = [150, 400, 900];
export const MAX_UPGRADE_LEVEL = 3;
export const BASE_MAX_HULL = 100;
export const BASE_LASER_DAMAGE = 12;
export const BASE_THRUST = 30;
export const HULL_PER_SHIELD = 25;
export const DAMAGE_PER_GUN = 6;
export const THRUST_PER_ENGINE = 0.15;

export interface EconomyInit {
  credits?: number;
  ore?: number;
  upgrades?: Partial<UpgradeLevels>;
}

export interface Economy {
  readonly credits: number;
  readonly ore: number;
  readonly upgrades: UpgradeLevels;
  addCredits(n: number): void;
  addOre(n: number): void;
  /** Spend n ore; returns false (and spends nothing) when ore < n. */
  spendOre(n: number): boolean;
  /** Sells ALL ore at 10/unit. Returns credits earned. */
  sellOre(): number;
  /** Buys the next level when level < 3 and credits cover the cost. */
  buyUpgrade(kind: UpgradeKind): boolean;
  /** Next-level cost, or null when maxed. */
  upgradeCost(kind: UpgradeKind): number | null;
  maxHull(): number;
  laserDamage(): number;
  thrust(): number;
}

export function upgradeKinds(): UpgradeKind[] {
  return ['guns', 'engine', 'shield'];
}

export function createEconomy(init: EconomyInit = {}): Economy {
  let credits = init.credits ?? 0;
  let ore = init.ore ?? 0;
  const upgrades: UpgradeLevels = {
    guns: init.upgrades?.guns ?? 0,
    engine: init.upgrades?.engine ?? 0,
    shield: init.upgrades?.shield ?? 0,
  };

  const api: Economy = {
    get credits() {
      return credits;
    },
    get ore() {
      return ore;
    },
    get upgrades() {
      return { ...upgrades };
    },
    addCredits(n: number): void {
      credits += n;
    },
    addOre(n: number): void {
      ore += n;
    },
    spendOre(n: number): boolean {
      if (ore < n) return false;
      ore -= n;
      return true;
    },
    sellOre(): number {
      const earned = ore * ORE_SELL_PRICE;
      credits += earned;
      ore = 0;
      return earned;
    },
    buyUpgrade(kind: UpgradeKind): boolean {
      const level = upgrades[kind];
      if (level >= MAX_UPGRADE_LEVEL) return false;
      const cost = UPGRADE_COSTS[level];
      if (credits < cost) return false;
      credits -= cost;
      upgrades[kind] = level + 1;
      return true;
    },
    upgradeCost(kind: UpgradeKind): number | null {
      const level = upgrades[kind];
      return level >= MAX_UPGRADE_LEVEL ? null : UPGRADE_COSTS[level];
    },
    maxHull(): number {
      return BASE_MAX_HULL + HULL_PER_SHIELD * upgrades.shield;
    },
    laserDamage(): number {
      return BASE_LASER_DAMAGE + DAMAGE_PER_GUN * upgrades.guns;
    },
    thrust(): number {
      return BASE_THRUST * (1 + THRUST_PER_ENGINE * upgrades.engine);
    },
  };
  return api;
}
