/** Spaceship gfx: neutral low-poly player + pirate ships.
 *
 * Clean low-poly geometry + MeshStandardMaterial + the baked hull textures.
 * No voxel, no PBR, no emissive accents (except plain engine discs).
 * Ship forward convention: -Z.
 */

import * as THREE from 'three';
import { loadBakedTexture } from './textures';

export type PirateVariant = 'scout' | 'raider' | 'bruiser';

function playerMats(): { hull: THREE.MeshStandardMaterial; trim: THREE.MeshStandardMaterial; glass: THREE.MeshStandardMaterial } {
  return {
    hull: new THREE.MeshStandardMaterial({ map: loadBakedTexture('ships/player/hull'), roughness: 0.7, metalness: 0.1 }),
    trim: new THREE.MeshStandardMaterial({ color: '#cfd6dd', roughness: 0.6, metalness: 0.2 }),
    glass: new THREE.MeshStandardMaterial({ color: '#1c2733', roughness: 0.25, metalness: 0.6 }),
  };
}

function pirateMats(): { hull: THREE.MeshStandardMaterial; dark: THREE.MeshStandardMaterial } {
  return {
    hull: new THREE.MeshStandardMaterial({ map: loadBakedTexture('ships/pirate/hull'), roughness: 0.8, metalness: 0.05 }),
    dark: new THREE.MeshStandardMaterial({ color: '#33373d', roughness: 0.6, metalness: 0.3 }),
  };
}

/** Player fighter: dart fuselage, swept wings, twin engines. */
export function createPlayerShip(): THREE.Group {
  const { hull, trim, glass } = playerMats();
  const ship = new THREE.Group();

  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 1.0, 4.4, 6), hull);
  body.rotation.x = Math.PI / 2; // axis -> Z, nose toward -Z
  ship.add(body);

  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.55, 1.8, 6), trim);
  nose.rotation.x = -Math.PI / 2;
  nose.position.z = -3.1;
  ship.add(nose);

  const canopy = new THREE.Mesh(new THREE.SphereGeometry(0.5, 12, 10), glass);
  canopy.scale.set(0.8, 0.55, 1.4);
  canopy.position.set(0, 0.62, -0.9);
  ship.add(canopy);

  const wingGeo = new THREE.BoxGeometry(3.4, 0.14, 1.7);
  for (const s of [-1, 1]) {
    const wing = new THREE.Mesh(wingGeo, hull);
    wing.position.set(s * 1.9, -0.1, 0.9);
    wing.rotation.y = s * -0.35; // swept back
    ship.add(wing);
    const tip = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 1.2), trim);
    tip.position.set(s * 3.4, 0.05, 1.5);
    ship.add(tip);
  }

  const fin = new THREE.Mesh(new THREE.BoxGeometry(0.14, 1.3, 1.4), hull);
  fin.position.set(0, 0.8, 1.6);
  ship.add(fin);

  // twin engine nacelles with plain bright discs
  const engGeo = new THREE.CylinderGeometry(0.34, 0.4, 1.6, 8);
  const discGeo = new THREE.CircleGeometry(0.3, 12);
  const discMat = new THREE.MeshBasicMaterial({ color: '#dfe8f2' });
  for (const s of [-1, 1]) {
    const eng = new THREE.Mesh(engGeo, trim);
    eng.rotation.x = Math.PI / 2;
    eng.position.set(s * 0.85, -0.15, 1.9);
    ship.add(eng);
    const disc = new THREE.Mesh(discGeo, discMat);
    disc.position.set(s * 0.85, -0.15, 2.72);
    ship.add(disc);
  }

  return ship;
}

/** Pirate ship: bulkier rust-hulled raider frame, scaled per variant. */
export function createPirateShip(variant: PirateVariant): THREE.Group {
  const { hull, dark } = pirateMats();
  const ship = new THREE.Group();

  const scale = variant === 'scout' ? 0.8 : variant === 'bruiser' ? 1.5 : 1.0;

  const body = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.1, 3.6), hull);
  ship.add(body);
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.8, 1.6, 4), dark);
  nose.rotation.x = -Math.PI / 2;
  nose.rotation.y = Math.PI / 4;
  nose.position.z = -2.6;
  ship.add(nose);

  // jagged forward-swept blades
  const bladeGeo = new THREE.BoxGeometry(2.6, 0.16, 1.1);
  for (const s of [-1, 1]) {
    const blade = new THREE.Mesh(bladeGeo, hull);
    blade.position.set(s * 1.7, 0, -0.6);
    blade.rotation.y = s * 0.5;
    ship.add(blade);
  }

  const spine = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.9, 3.0), dark);
  spine.position.set(0, 0.85, 0.4);
  ship.add(spine);

  if (variant === 'bruiser') {
    // extra armor plates
    for (const s of [-1, 1]) {
      const plate = new THREE.Mesh(new THREE.BoxGeometry(0.4, 1.6, 2.2), dark);
      plate.position.set(s * 1.1, 0, 0.6);
      ship.add(plate);
    }
  }

  const engGlow = new THREE.Mesh(
    new THREE.CircleGeometry(0.5, 10),
    new THREE.MeshBasicMaterial({ color: '#e8d9c0' }),
  );
  engGlow.position.set(0, 0, 1.85);
  ship.add(engGlow);

  ship.scale.setScalar(scale);
  return ship;
}
