/** STARFALL: Drift Arena — GameAPI + shared sim context.
 *
 * Defines the exact GameAPI shape consumed by the meta builder
 * (`window.__keel.game`), with a default implementation holding real working
 * state (credits/ore/upgrades/quests with the pinned numbers) so the sim is
 * fully playable standalone. The meta patch later swaps the economy/quest
 * interiors without changing behavior.
 *
 * Pinned numbers (do not "improve"):
 * - upgrade costs (guns/engine/shield), level 0->3: [150, 400, 900]
 * - ore sell price: 10 credits/unit
 * - player base: hull 100, laser damage 12, thrust 30
 * - per shield level: +25 maxHull; per gun level: +6 laser damage;
 *   per engine level: +15% thrust
 * - quest rewards: kill-8 -> 250cr; mine-20 -> 200cr; deliver-15 (spends 15 ore) -> 300cr
 */

import * as THREE from 'three';
import type { World } from '../engine/ecs';
import type { Loop } from '../engine/loop';

export interface InputLike {
  isDown(name: string): boolean;
  pressed(name: string): boolean;
  axis(name: string): number;
}

export interface GameAPI {
  getCredits(): number; addCredits(n: number): void;
  getOre(): number; addOre(n: number): void; spendOre(n: number): boolean;
  getHull(): number; getMaxHull(): number; damagePlayer(n: number): void;
  getUpgrades(): { guns: number; engine: number; shield: number };
  buyUpgrade(kind: 'guns' | 'engine' | 'shield'): boolean;
  sellOre(): number;
  addQuestProgress(kind: 'kill' | 'mine' | 'deliver', n: number): void;
  getQuests(): Array<{ id: string; kind: string; title: string; target: number; progress: number; reward: number; done: boolean }>;
  spawnPirateWave(n: number): void;
  requestDock(): void; isDocked(): boolean;
  stationId: number; playerShipId: number;
}

export interface QuestRec {
  id: string;
  kind: 'kill' | 'mine' | 'deliver';
  title: string;
  target: number;
  progress: number;
  reward: number;
  done: boolean;
}

export interface GameState {
  credits: number;
  ore: number;
  hull: number;
  upgrades: { guns: number; engine: number; shield: number };
  quests: QuestRec[];
  docked: boolean;
  playerShipId: number;
  stationId: number;
  hooks: {
    spawnPirateWave?: (n: number) => void;
    requestDock?: () => void;
    /** Fired when an enemy ship is destroyed (x,y,z of the kill). */
    onEnemyKilled?: (x: number, y: number, z: number) => void;
  };
}

/** Shared per-run context passed to every sim system. */
export interface SimCtx {
  world: World;
  loop: Loop;
  input: InputLike;
  api: GameAPI;
  state: GameState;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera | null;
  /** Entity id -> scene object; synced from Transform each postupdate. */
  meshes: Map<number, THREE.Object3D>;
  /** Accumulated pointer-lock look deltas (radians), consumed by flight. */
  look: { yaw: number; pitch: number };
}

export const UPGRADE_COSTS = [150, 400, 900];
export const ORE_SELL_PRICE = 10;
export const BASE_HULL = 100;
export const BASE_LASER_DAMAGE = 12;
export const BASE_THRUST = 30;
export const DELIVER_ORE_COST = 15;

export function maxHullOf(state: GameState): number {
  return BASE_HULL + 25 * state.upgrades.shield;
}
export function laserDamageOf(state: GameState): number {
  return BASE_LASER_DAMAGE + 6 * state.upgrades.guns;
}
export function thrustOf(state: GameState): number {
  return BASE_THRUST * (1 + 0.15 * state.upgrades.engine);
}

function freshQuests(): QuestRec[] {
  return [
    { id: 'q-kill-8', kind: 'kill', title: 'Pirate Hunt', target: 8, progress: 0, reward: 250, done: false },
    { id: 'q-mine-20', kind: 'mine', title: 'Ore Run', target: 20, progress: 0, reward: 200, done: false },
    { id: 'q-deliver-15', kind: 'deliver', title: 'Supply Delivery', target: 15, progress: 0, reward: 300, done: false },
  ];
}

export function createGameState(): { api: GameAPI; state: GameState } {
  const state: GameState = {
    credits: 100,
    ore: 0,
    hull: BASE_HULL,
    upgrades: { guns: 0, engine: 0, shield: 0 },
    quests: freshQuests(),
    docked: false,
    playerShipId: -1,
    stationId: -1,
    hooks: {},
  };

  const api: GameAPI = {
    getCredits: () => state.credits,
    addCredits: (n: number) => { state.credits += n; },
    getOre: () => state.ore,
    addOre: (n: number) => { state.ore += n; },
    spendOre: (n: number) => {
      if (state.ore < n) return false;
      state.ore -= n;
      return true;
    },
    getHull: () => state.hull,
    getMaxHull: () => maxHullOf(state),
    damagePlayer: (n: number) => { state.hull = Math.max(0, state.hull - n); },
    getUpgrades: () => ({ ...state.upgrades }),
    buyUpgrade: (kind: 'guns' | 'engine' | 'shield') => {
      const level = state.upgrades[kind];
      if (level >= 3) return false;
      const cost = UPGRADE_COSTS[level];
      if (state.credits < cost) return false;
      state.credits -= cost;
      state.upgrades[kind] = level + 1;
      return true;
    },
    sellOre: () => {
      const earned = state.ore * ORE_SELL_PRICE;
      state.credits += earned;
      state.ore = 0;
      return earned;
    },
    addQuestProgress: (kind: 'kill' | 'mine' | 'deliver', n: number) => {
      const q = state.quests.find((qq) => qq.kind === kind);
      if (!q || q.done) return;
      q.progress += n;
      if (q.progress >= q.target) {
        if (kind === 'deliver') {
          // Deliver quest spends the ore on completion.
          if (state.ore < DELIVER_ORE_COST) return;
          state.ore -= DELIVER_ORE_COST;
        }
        q.done = true;
        state.credits += q.reward;
      }
    },
    getQuests: () =>
      state.quests.map((q) => ({
        id: q.id, kind: q.kind, title: q.title, target: q.target,
        progress: q.progress, reward: q.reward, done: q.done,
      })),
    spawnPirateWave: (n: number) => { state.hooks.spawnPirateWave?.(n); },
    requestDock: () => { state.hooks.requestDock?.(); },
    isDocked: () => state.docked,
    get stationId(): number { return state.stationId; },
    get playerShipId(): number { return state.playerShipId; },
  };

  return { api, state };
}

/** Attach a scene object to an entity (synced from Transform in postupdate). */
export function attachMesh(ctx: SimCtx, id: number, obj: THREE.Object3D): void {
  obj.rotation.order = 'YXZ';
  ctx.meshes.set(id, obj);
  ctx.scene.add(obj);
}

/** Despawn an entity and clean up its scene object. */
export function despawnEntity(ctx: SimCtx, id: number): void {
  const m = ctx.meshes.get(id);
  if (m) {
    ctx.scene.remove(m);
    ctx.meshes.delete(id);
  }
  ctx.world.despawn(id);
}
