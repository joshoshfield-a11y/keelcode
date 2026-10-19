/** Neutral placeholder characters from clean primitives.
 *  Player ~1.8 units tall, subtle two-tone. Enemy: boxy torso + sphere core,
 *  distinct silhouette and color. No visor slits, no emissive, no voxel look.
 *  Shared geometries (one hidden source mesh per part, cloned per use —
 *  the Babylon analog of sharing THREE.BufferGeometry); materials come from
 *  the shared library (enemy torso material is cloned per-enemy by the enemy
 *  system for damage flash).
 *
 *  Babylon port of the ts-three reference (gfx/character.ts): identical
 *  proportions and part offsets. three.js CapsuleGeometry(radius, length)
 *  takes the cylinder mid-section length, while Babylon CreateCapsule
 *  {height} is the TOTAL height, so heights below are length + 2*radius.
 *  Part offsets are mirrored z -> -z per the render-space convention
 *  documented in game/player.ts. */

import * as BABYLON from '@babylonjs/core';
import type { Mats } from './materials';

interface GeoLib {
  body: BABYLON.Mesh;
  head: BABYLON.Mesh;
  arm: BABYLON.Mesh;
  leg: BABYLON.Mesh;
  belt: BABYLON.Mesh;
  torso: BABYLON.Mesh;
  core: BABYLON.Mesh;
  headBox: BABYLON.Mesh;
  stub: BABYLON.Mesh;
}

// One geometry library per scene (Babylon geometries are scene-bound).
const geoCache = new WeakMap<BABYLON.Scene, GeoLib>();

function getGeo(scene: BABYLON.Scene): GeoLib {
  let lib = geoCache.get(scene);
  if (lib) return lib;
  const hidden = (m: BABYLON.Mesh): BABYLON.Mesh => {
    m.isVisible = false;
    return m;
  };
  lib = {
    // three.js CapsuleGeometry(0.32, 0.7): total height = 0.7 + 2*0.32
    body: hidden(BABYLON.MeshBuilder.CreateCapsule('g_body', { radius: 0.32, height: 1.34 }, scene)),
    head: hidden(BABYLON.MeshBuilder.CreateSphere('g_head', { diameter: 0.48, segments: 18 }, scene)),
    arm: hidden(BABYLON.MeshBuilder.CreateCapsule('g_arm', { radius: 0.09, height: 0.63 }, scene)),
    leg: hidden(BABYLON.MeshBuilder.CreateCapsule('g_leg', { radius: 0.11, height: 0.72 }, scene)),
    belt: hidden(BABYLON.MeshBuilder.CreateBox('g_belt', { width: 0.62, height: 0.12, depth: 0.42 }, scene)),
    torso: hidden(BABYLON.MeshBuilder.CreateBox('g_torso', { width: 0.9, height: 0.95, depth: 0.55 }, scene)),
    core: hidden(BABYLON.MeshBuilder.CreateSphere('g_core', { diameter: 0.56, segments: 16 }, scene)),
    headBox: hidden(BABYLON.MeshBuilder.CreateBox('g_headbox', { width: 0.4, height: 0.3, depth: 0.4 }, scene)),
    stub: hidden(BABYLON.MeshBuilder.CreateBox('g_stub', { width: 0.26, height: 0.55, depth: 0.3 }, scene)),
  };
  geoCache.set(scene, lib);
  return lib;
}

/** Clone shared geometry, assign material + render-space position, parent it. */
function part(
  geo: BABYLON.Mesh,
  mat: BABYLON.Material,
  parent: BABYLON.TransformNode,
  x: number,
  y: number,
  z: number,
): BABYLON.Mesh {
  const m = geo.clone(geo.name + '_c');
  m.material = mat;
  m.position.set(x, y, -z); // sim (x,y,z) -> render (x,y,-z)
  m.parent = parent;
  m.isVisible = true;
  return m;
}

export function buildPlayerMesh(m: Mats, scene: BABYLON.Scene): BABYLON.TransformNode {
  const g = new BABYLON.TransformNode('player', scene);
  const geo = getGeo(scene);
  // capsule body centered ~waist; head above; total height ~1.86
  part(geo.body, m.playerBody, g, 0, 1.02, 0);
  part(geo.head, m.playerTrim, g, 0, 1.66, 0);
  const armL = part(geo.arm, m.playerTrim, g, -0.44, 1.05, 0);
  const armR = part(geo.arm, m.playerTrim, g, 0.44, 1.05, 0);
  armL.rotation.z = -0.12; // sim +0.12 about z -> render negated
  armR.rotation.z = 0.12;
  part(geo.leg, m.playerBody, g, -0.16, 0.42, 0);
  part(geo.leg, m.playerBody, g, 0.16, 0.42, 0);
  // belt band (two-tone accent)
  part(geo.belt, m.playerTrim, g, 0, 0.78, 0);
  return g;
}

export interface EnemyMesh {
  node: BABYLON.TransformNode;
  torsoMesh: BABYLON.Mesh;
}

export function buildEnemyMesh(m: Mats, scene: BABYLON.Scene): EnemyMesh {
  const g = new BABYLON.TransformNode('enemy', scene);
  const geo = getGeo(scene);
  // boxy torso, charcoal sphere core set into the chest, stubby legs
  const torsoMesh = part(geo.torso, m.enemyBody, g, 0, 1.05, 0);
  const core = part(geo.core, m.enemyCore, g, 0, 1.12, 0.22);
  core.scaling.set(1, 1, 0.55);
  part(geo.headBox, m.enemyBody, g, 0, 1.68, 0);
  part(geo.stub, m.enemyCore, g, -0.26, 0.3, 0);
  part(geo.stub, m.enemyCore, g, 0.26, 0.3, 0);
  return { node: g, torsoMesh };
}

/** Register every mesh under a character node as a shadow caster. */
export function addShadowCasters(shadow: BABYLON.ShadowGenerator, node: BABYLON.TransformNode): void {
  for (const mesh of node.getChildMeshes()) {
    shadow.addShadowCaster(mesh);
  }
}
