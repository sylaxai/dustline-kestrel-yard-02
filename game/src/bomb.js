// The bomb: planted by an attacker standing in a site, defused by a defender, ticking
// for 35 seconds once planted. Planting takes 3.2 s, defusing 5 s, and both are broken by
// moving away or taking damage. The bomb is a small amber device with a blinking light;
// its beeps quicken as the timer runs down.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

export const PLANT_TIME = 3.2;
export const DEFUSE_TIME = 5;
export const BOMB_TIMER = 40; // CS-standard: retakes need the extra seconds

export function createBomb(scene) {
  const group = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(0.34, 0.16, 0.24),
    new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.hairline), roughness: 0.5, metalness: 0.4 }),
  );
  const light = new THREE.Mesh(
    new THREE.SphereGeometry(0.05, 8, 6),
    new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.accent), emissive: new THREE.Color(PALETTE.accent), emissiveIntensity: 2 }),
  );
  light.position.set(0.1, 0.1, 0);
  group.add(body, light);
  group.visible = false;
  scene.add(group);

  const state = {
    status: 'carried', // carried | planting | planted | defusing | exploded | defused
    site: null,
    position: new THREE.Vector3(),
    timer: BOMB_TIMER,
    progress: 0,
    planter: null,
    defuser: null,
    beepAt: 0,
  };

  function siteAt(x, z, sites) {
    for (const site of sites) {
      if (x >= site.minX && x <= site.maxX && z >= site.minZ && z <= site.maxZ) return site;
    }
    return null;
  }

  return {
    state,
    siteAt,
    startPlant(site, planter, position) {
      state.status = 'planting';
      state.site = site;
      state.planter = planter;
      state.progress = 0;
      state.position.copy(position);
    },
    startDefuse(defuser) {
      state.status = 'defusing';
      state.defuser = defuser;
      state.progress = 0;
    },
    cancel() {
      if (state.status === 'planting' || state.status === 'defusing') {
        state.status = state.status === 'planting' ? 'carried' : 'planted';
        state.progress = 0;
        state.planter = null;
        state.defuser = null;
      }
    },
    plantDone() {
      state.status = 'planted';
      state.timer = BOMB_TIMER;
      state.progress = 0;
      state.planter = null;
      group.position.copy(state.position);
      group.position.y = 0.1;
      group.visible = true;
      state.beepAt = 0;
    },
    defuseDone() {
      state.status = 'defused';
      state.progress = 0;
      state.defuser = null;
      group.visible = false;
    },
    explode() {
      state.status = 'exploded';
      group.visible = false;
    },
    reset() {
      state.status = 'carried';
      state.site = null;
      state.timer = BOMB_TIMER;
      state.progress = 0;
      state.planter = null;
      state.defuser = null;
      group.visible = false;
    },
    // Returns 'beep' when a timer beep is due, else null. Caller plays the sound.
    step(dt, nowSeconds) {
      if (state.status === 'planted') {
        state.timer -= dt;
        light.material.emissiveIntensity = 1.2 + Math.sin(nowSeconds * 9) * 1.2;
        const interval = state.timer < 10 ? 0.35 : state.timer < 20 ? 0.6 : 1.0;
        if (nowSeconds - state.beepAt >= interval) {
          state.beepAt = nowSeconds;
          return 'beep';
        }
      }
      return null;
    },
  };
}
