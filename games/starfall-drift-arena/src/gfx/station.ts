/** Station gfx: big neutral-industrial drift station.
 *
 * createStation(): THREE.Group — central hub cylinder + rotating ring +
 * dock arms, MeshStandardMaterial using the baked `station/dock/hull`
 * texture (/assets/station/dock/hull.png), plus blinking dock lights
 * (emissive small spheres).
 *
 * Same name/signature as the sim builder's `createStationStub()` swap target:
 * one import line replaces the stub. Animate via
 *   (group.userData.update as ((dt: number, t: number) => void) | undefined)?.(dt, t)
 * from the sim's update phase.
 */

import * as THREE from 'three';

const HULL_TEXTURE_URL = '/assets/station/dock/hull.png';

export interface StationAnimation {
  /** Rotates the ring, blinks the dock lights. t = seconds. */
  update(dt: number, t: number): void;
}

export function createStation(): THREE.Group {
  const group = new THREE.Group();

  const tex = new THREE.TextureLoader().load(HULL_TEXTURE_URL);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;

  const hull = new THREE.MeshStandardMaterial({
    map: tex,
    color: 0xb9bec6,
    roughness: 0.55,
    metalness: 0.35,
  });
  const dark = new THREE.MeshStandardMaterial({
    color: 0x4a5058,
    roughness: 0.7,
    metalness: 0.5,
  });

  // Central hub: vertical cylinder, industrial gray.
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(16, 20, 70, 24), hull);
  group.add(hub);

  // Hub caps: docking spire top + sensor dome bottom.
  const spire = new THREE.Mesh(new THREE.CylinderGeometry(4, 8, 30, 12), dark);
  spire.position.y = 50;
  group.add(spire);
  const dome = new THREE.Mesh(new THREE.SphereGeometry(10, 16, 12), dark);
  dome.position.y = -40;
  group.add(dome);

  // Rotating ring around the hub (torus laid flat).
  const ring = new THREE.Mesh(new THREE.TorusGeometry(48, 6, 12, 48), hull);
  ring.rotation.x = Math.PI / 2;
  group.add(ring);

  // Ring module blocks: cargo pods riding the ring.
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const pod = new THREE.Mesh(new THREE.BoxGeometry(14, 8, 10), i % 2 === 0 ? hull : dark);
    pod.position.set(Math.cos(a) * 48, 0, Math.sin(a) * 48);
    pod.rotation.y = -a;
    ring.add(pod);
  }

  // Dock arms: 4 struts from hub to ring with dock claws at the ends.
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const arm = new THREE.Mesh(new THREE.BoxGeometry(34, 4, 4), dark);
    arm.position.set(Math.cos(a) * 30, 12, Math.sin(a) * 30);
    arm.rotation.y = -a;
    group.add(arm);
    const claw = new THREE.Mesh(new THREE.BoxGeometry(8, 6, 12), hull);
    claw.position.set(Math.cos(a) * 47, 12, Math.sin(a) * 47);
    claw.rotation.y = -a;
    group.add(claw);
  }

  // Blinking dock lights: emissive spheres on the ring + hub.
  const lightColors = [0xffb020, 0x30ff70, 0xff4040, 0x30c0ff];
  const lightMats: THREE.MeshStandardMaterial[] = [];
  for (let i = 0; i < 12; i++) {
    const mat = new THREE.MeshStandardMaterial({
      color: 0x222222,
      emissive: lightColors[i % lightColors.length],
      emissiveIntensity: 2,
      roughness: 0.4,
      metalness: 0.1,
    });
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(1.1, 10, 8), mat);
    if (i < 8) {
      const a = (i / 8) * Math.PI * 2;
      bulb.position.set(Math.cos(a) * 48, 7, Math.sin(a) * 48);
    } else {
      const a = ((i - 8) / 4) * Math.PI * 2;
      bulb.position.set(Math.cos(a) * 20, 30, Math.sin(a) * 20);
    }
    group.add(bulb);
    lightMats.push(mat);
  }

  const anim: StationAnimation = {
    update(dt: number, t: number): void {
      // Ring was flattened with rotation.x = π/2, so spin in-plane via y.
      ring.rotation.y += dt * 0.08;
      for (let i = 0; i < lightMats.length; i++) {
        const phase = Math.sin(t * 3 + i * 1.7);
        lightMats[i].emissiveIntensity = phase > 0 ? 2.4 : 0.2;
      }
    },
  };
  group.userData.update = anim.update;

  return group;
}
