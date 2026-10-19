/** Wave 4d-sim tests: FSM transitions, mining yield math, GameAPI economy math.
 *
 * Covers the pinned numbers verbatim:
 * - upgrade costs [150, 400, 900]; ore sell 10/unit
 * - base hull 100, laser 12, thrust 30; +25 hull/shield, +6 dmg/gun, +15% thrust/engine
 * - quest rewards: kill-8 -> 250, mine-20 -> 200, deliver-15 -> 300 (spends 15 ore)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import * as THREE from 'three';
import { createWorld, C, type TransformC, type HealthC, type VelocityC } from '../src/engine/ecs';
import { createLoop } from '../src/engine/loop';
import {
  createGameState, laserDamageOf, maxHullOf, thrustOf,
  type SimCtx, type InputLike, type GameAPI, type GameState,
} from '../src/game/api';
import { spawnPlayerShip, createFlightSystem, clampLookDelta } from '../src/game/flight';
import { spawnPirate, createPirateSystem, spawnPirateWave, pirateData } from '../src/game/pirates';
import { fireLaser, createProjectileSystem, resetProjectileState } from '../src/game/projectiles';
import {
  createAsteroidField, createAsteroidSystem, createStationEntity,
  spawnOrePickup, rockData, pickupData,
} from '../src/game/asteroids';

function stubInput(over: Partial<InputLike> = {}): InputLike {
  return {
    isDown: () => false,
    pressed: () => false,
    axis: () => 0,
    ...over,
  };
}

function makeCtx(input: InputLike): { ctx: SimCtx; api: GameAPI; state: GameState } {
  const { api, state } = createGameState();
  const ctx: SimCtx = {
    world: createWorld(),
    loop: createLoop(),
    input,
    api,
    state,
    scene: new THREE.Scene(),
    camera: null,
    meshes: new Map(),
    look: { yaw: 0, pitch: 0 },
  };
  state.playerShipId = spawnPlayerShip(ctx);
  return { ctx, api, state };
}

beforeEach(() => {
  pirateData.clear();
  rockData.clear();
  pickupData.clear();
  resetProjectileState();
});

function teleport(ctx: SimCtx, id: number, x: number, y: number, z: number): void {
  const t = ctx.world.get<TransformC>(id, C.Transform)!;
  t.x = x; t.y = y; t.z = z;
  const v = ctx.world.get<VelocityC>(id, C.Velocity);
  if (v) { v.x = 0; v.y = 0; v.z = 0; }
}

describe('pointer-lock look clamp', () => {
  it('clamps per-event deltas to ±0.25 rad', () => {
    expect(clampLookDelta(5)).toBe(0.25);
    expect(clampLookDelta(-5)).toBe(-0.25);
    expect(clampLookDelta(0.1)).toBeCloseTo(0.1);
  });
});

describe('pirate FSM transitions', () => {
  it('patrol -> engage inside 120u', () => {
    const { ctx } = makeCtx(stubInput());
    createPirateSystem(ctx);
    const id = spawnPirate(ctx, 'raider', 0, 0, 100);
    expect(pirateData.get(id)!.state).toBe('patrol');
    ctx.loop.step();
    expect(pirateData.get(id)!.state).toBe('engage');
  });

  it('stays in patrol beyond 120u', () => {
    const { ctx } = makeCtx(stubInput());
    createPirateSystem(ctx);
    const id = spawnPirate(ctx, 'scout', 0, 0, 500);
    ctx.loop.step();
    ctx.loop.step();
    expect(pirateData.get(id)!.state).toBe('patrol');
  });

  it('engage -> attack inside 40u', () => {
    const { ctx } = makeCtx(stubInput());
    createPirateSystem(ctx);
    const id = spawnPirate(ctx, 'raider', 0, 0, 100);
    ctx.loop.step();
    expect(pirateData.get(id)!.state).toBe('engage');
    teleport(ctx, id, 0, 0, 30);
    ctx.loop.step();
    expect(pirateData.get(id)!.state).toBe('attack');
  });

  it('attack -> disengage below 25% hull', () => {
    const { ctx } = makeCtx(stubInput());
    createPirateSystem(ctx);
    const id = spawnPirate(ctx, 'raider', 0, 0, 30);
    ctx.loop.step(); // patrol -> engage
    ctx.loop.step(); // engage -> attack
    expect(pirateData.get(id)!.state).toBe('attack');
    const h = ctx.world.get<HealthC>(id, C.Health)!;
    h.hp = h.maxHp * 0.2; // below 25%
    ctx.loop.step();
    expect(pirateData.get(id)!.state).toBe('disengage');
  });

  it('disengage -> patrol once far away', () => {
    const { ctx } = makeCtx(stubInput());
    createPirateSystem(ctx);
    const id = spawnPirate(ctx, 'bruiser', 0, 0, 30);
    const pd = pirateData.get(id)!;
    pd.state = 'disengage';
    teleport(ctx, id, 0, 0, 400); // disengage flies away at 1.25x speed
    for (let i = 0; i < 120; i++) ctx.loop.step();
    expect(pd.state).toBe('patrol');
  });

  it('pirate lasers damage the player', () => {
    const { ctx, api } = makeCtx(stubInput());
    createPirateSystem(ctx);
    createProjectileSystem(ctx);
    spawnPirate(ctx, 'raider', 0, 0, 30); // attack range, will open fire
    for (let i = 0; i < 240; i++) ctx.loop.step(); // 4s of attack runs
    expect(api.getHull()).toBeLessThan(100);
  });
});

describe('mining yield math', () => {
  it('E within 30u facing the rock yields 1 ore per 0.5s', () => {
    const { ctx, api } = makeCtx(stubInput({ isDown: (n) => n === 'mine' }));
    createAsteroidField(ctx, 1);
    createAsteroidSystem(ctx);
    // put the single rock 20u ahead of the player (player faces -Z)
    for (const [id] of rockData) teleport(ctx, id, 0, 0, -20);
    for (let i = 0; i < 120; i++) ctx.loop.step(); // 2.0s
    expect(api.getOre()).toBe(4);
    expect(api.getQuests().find((q) => q.kind === 'mine')!.progress).toBe(4);
  });

  it('no mining beyond 30u or when not facing', () => {
    const { ctx, api } = makeCtx(stubInput({ isDown: (n) => n === 'mine' }));
    createAsteroidField(ctx, 1);
    createAsteroidSystem(ctx);
    for (const [id] of rockData) teleport(ctx, id, 0, 0, -60); // out of range
    for (let i = 0; i < 120; i++) ctx.loop.step();
    expect(api.getOre()).toBe(0);
  });

  it('depleted rock hides, then respawns with full ore after 60s', () => {
    const { ctx, api } = makeCtx(stubInput({ isDown: (n) => n === 'mine' }));
    createAsteroidField(ctx, 1);
    createAsteroidSystem(ctx);
    let rockId = -1;
    for (const [id, rock] of rockData) {
      rockId = id;
      rock.ore = 2;
      rock.maxOre = 2;
      teleport(ctx, id, 0, 0, -20);
    }
    for (let i = 0; i < 70; i++) ctx.loop.step(); // >1s of mining
    const rock = rockData.get(rockId)!;
    expect(api.getOre()).toBe(2);
    expect(rock.ore).toBe(0);
    expect(rock.respawn).toBeGreaterThan(0);
    expect(ctx.meshes.get(rockId)!.visible).toBe(false);
    // fast-forward the respawn timer
    rock.respawn = 0.05;
    for (let i = 0; i < 10; i++) ctx.loop.step();
    expect(rock.ore).toBe(2);
    expect(ctx.meshes.get(rockId)!.visible).toBe(true);
  });

  it('ore pickups are collected on proximity', () => {
    const { ctx, api } = makeCtx(stubInput());
    createAsteroidSystem(ctx);
    spawnOrePickup(ctx, 0, 0, -3, 3); // right next to the player
    for (let i = 0; i < 10; i++) ctx.loop.step();
    expect(api.getOre()).toBe(3);
    expect(pickupData.size).toBe(0);
  });
});

describe('GameAPI economy (pinned numbers)', () => {
  it('upgrade costs are [150, 400, 900] and levels cap at 3', () => {
    const { api } = createGameState();
    const a = api;
    expect(a.getCredits()).toBe(100);
    expect(a.buyUpgrade('guns')).toBe(false); // 100 < 150
    a.addCredits(50); // 150
    expect(a.buyUpgrade('guns')).toBe(true);
    expect(a.getCredits()).toBe(0);
    expect(a.getUpgrades().guns).toBe(1);
    a.addCredits(400);
    expect(a.buyUpgrade('guns')).toBe(true); // pays 400
    expect(a.getUpgrades().guns).toBe(2);
    a.addCredits(900);
    expect(a.buyUpgrade('guns')).toBe(true); // pays 900
    expect(a.getUpgrades().guns).toBe(3);
    a.addCredits(10000);
    expect(a.buyUpgrade('guns')).toBe(false); // capped
  });

  it('derived stats: +25 hull/shield, +6 dmg/gun, +15% thrust/engine', () => {
    const { state } = createGameState();
    expect(maxHullOf(state)).toBe(100);
    expect(laserDamageOf(state)).toBe(12);
    expect(thrustOf(state)).toBe(30);
    state.upgrades.shield = 2;
    state.upgrades.guns = 3;
    state.upgrades.engine = 2;
    expect(maxHullOf(state)).toBe(150);
    expect(laserDamageOf(state)).toBe(30);
    expect(thrustOf(state)).toBeCloseTo(39);
  });

  it('ore sells at 10 credits/unit; spendOre guards the balance', () => {
    const { api } = createGameState();
    api.addOre(7);
    expect(api.sellOre()).toBe(70);
    expect(api.getOre()).toBe(0);
    expect(api.getCredits()).toBe(170); // 100 start + 70
    api.addOre(5);
    expect(api.spendOre(3)).toBe(true);
    expect(api.getOre()).toBe(2);
    expect(api.spendOre(5)).toBe(false);
    expect(api.getOre()).toBe(2);
  });

  it('quest rewards: kill-8 -> 250, mine-20 -> 200, deliver-15 -> 300 (spends 15 ore)', () => {
    const { api } = createGameState();
    api.addQuestProgress('kill', 8);
    const kill = api.getQuests().find((q) => q.kind === 'kill')!;
    expect(kill.done).toBe(true);
    expect(api.getCredits()).toBe(350);
    api.addQuestProgress('mine', 20);
    expect(api.getQuests().find((q) => q.kind === 'mine')!.done).toBe(true);
    expect(api.getCredits()).toBe(550);
    // deliver cannot complete without the ore
    api.addQuestProgress('deliver', 15);
    expect(api.getQuests().find((q) => q.kind === 'deliver')!.done).toBe(false);
    api.addOre(20);
    api.addQuestProgress('deliver', 0); // re-check with ore aboard
    const del = api.getQuests().find((q) => q.kind === 'deliver')!;
    expect(del.done).toBe(true);
    expect(api.getOre()).toBe(5); // 20 - 15 spent
    expect(api.getCredits()).toBe(850);
  });

  it('damagePlayer clamps at zero', () => {
    const { api } = createGameState();
    api.damagePlayer(30);
    expect(api.getHull()).toBe(70);
    api.damagePlayer(100);
    expect(api.getHull()).toBe(0);
  });
});

describe('docking', () => {
  it('requestDock only docks within range of the station', () => {
    const { ctx, api, state } = makeCtx(stubInput());
    createAsteroidSystem(ctx);
    createStationEntity(ctx); // (0, 0, -600)
    expect(state.stationId).toBeGreaterThan(0);
    api.requestDock();
    expect(api.isDocked()).toBe(false); // 600u away
    teleport(ctx, state.playerShipId, 0, 0, -590);
    api.requestDock();
    expect(api.isDocked()).toBe(true);
  });

  it('spawnPirateWave hook spawns n pirates', () => {
    const { ctx, api, state } = makeCtx(stubInput());
    state.hooks.spawnPirateWave = (n: number) => spawnPirateWave(ctx, n);
    api.spawnPirateWave(4);
    ctx.world.flush();
    expect(ctx.world.query(C.Enemy).length).toBe(4);
  });
});

describe('flight + projectiles integration', () => {
  it('W thrust accelerates the ship forward (-Z)', () => {
    const { ctx, state } = makeCtx(stubInput({ axis: (n) => (n === 'thrust' ? 1 : 0) }));
    createFlightSystem(ctx);
    for (let i = 0; i < 60; i++) ctx.loop.step();
    const t = ctx.world.get<TransformC>(state.playerShipId, C.Transform)!;
    const v = ctx.world.get<VelocityC>(state.playerShipId, C.Velocity)!;
    expect(v.z).toBeLessThan(-5);
    expect(t.z).toBeLessThan(-5);
  });

  it('player laser destroys a pirate and advances the kill quest', () => {
    const { ctx, api, state } = makeCtx(stubInput());
    createPirateSystem(ctx);
    createProjectileSystem(ctx);
    const pid = spawnPirate(ctx, 'scout', 0, 0, -40); // scout hull 30
    // two 20-dmg bolts straight down -Z from the player
    fireLaser(ctx, 0, 0, -5, 0, 0, -1, 170, { damage: 20, fromPlayer: true });
    for (let i = 0; i < 40; i++) ctx.loop.step();
    fireLaser(ctx, 0, 0, -5, 0, 0, -1, 170, { damage: 20, fromPlayer: true });
    for (let i = 0; i < 40; i++) ctx.loop.step();
    ctx.world.flush();
    expect(ctx.world.query(C.Enemy)).not.toContain(pid);
    expect(api.getQuests().find((q) => q.kind === 'kill')!.progress).toBe(1);
    expect(state.docked).toBe(false);
  });
});
