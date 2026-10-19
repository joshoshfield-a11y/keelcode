/** Neutral placeholder characters from clean primitives.
 *  Player ~1.8 units tall, subtle two-tone. Enemy: boxy torso + sphere core,
 *  distinct silhouette and color. No visor slits, no emissive, no voxel look.
 *  Shared geometries; materials come from the shared library (enemy torso
 *  material is cloned per-enemy by the enemy system for damage flash). */

import * as THREE from 'three';
import type { Mats } from './materials';

const GEO = {
  body: new THREE.CapsuleGeometry(0.32, 0.7, 6, 14),
  head: new THREE.SphereGeometry(0.24, 18, 14),
  arm: new THREE.CapsuleGeometry(0.09, 0.45, 4, 10),
  leg: new THREE.CapsuleGeometry(0.11, 0.5, 4, 10),
  torso: new THREE.BoxGeometry(0.9, 0.95, 0.55),
  core: new THREE.SphereGeometry(0.28, 16, 12),
  stub: new THREE.BoxGeometry(0.26, 0.55, 0.3),
  headBox: new THREE.BoxGeometry(0.4, 0.3, 0.4),
};

function mesh(geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
}

export function buildPlayerMesh(m: Mats): THREE.Group {
  const g = new THREE.Group();
  // capsule body centered ~waist; head above; total height ~1.86
  g.add(mesh(GEO.body, m.playerBody, 0, 1.02, 0));
  g.add(mesh(GEO.head, m.playerTrim, 0, 1.66, 0));
  const armL = mesh(GEO.arm, m.playerTrim, -0.44, 1.05, 0);
  const armR = mesh(GEO.arm, m.playerTrim, 0.44, 1.05, 0);
  armL.rotation.z = 0.12; armR.rotation.z = -0.12;
  g.add(armL, armR);
  g.add(mesh(GEO.leg, m.playerBody, -0.16, 0.42, 0));
  g.add(mesh(GEO.leg, m.playerBody, 0.16, 0.42, 0));
  // belt band (two-tone accent)
  const belt = mesh(new THREE.BoxGeometry(0.62, 0.12, 0.42), m.playerTrim, 0, 0.78, 0);
  g.add(belt);
  return g;
}

export interface EnemyMesh {
  group: THREE.Group;
  torsoMesh: THREE.Mesh;
}

export function buildEnemyMesh(m: Mats): EnemyMesh {
  const g = new THREE.Group();
  // boxy torso, charcoal sphere core set into the chest, stubby legs
  const torsoMesh = mesh(GEO.torso, m.enemyBody, 0, 1.05, 0);
  g.add(torsoMesh);
  const core = mesh(GEO.core, m.enemyCore, 0, 1.12, 0.22);
  core.scale.set(1, 1, 0.55);
  g.add(core);
  g.add(mesh(GEO.headBox, m.enemyBody, 0, 1.68, 0));
  g.add(mesh(GEO.stub, m.enemyCore, -0.26, 0.3, 0));
  g.add(mesh(GEO.stub, m.enemyCore, 0.26, 0.3, 0));
  return { group: g, torsoMesh };
}
