// The armoury: five hitscan weapons and two grenades, each with its own numbers and its
// own view model. Damage falls off with range, headshots multiply it, and spread grows
// with movement and with sustained fire, so stopping to aim pays. Prices are the economy's.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

export const WEAPONS = {
  pistol: {
    id: 'pistol', name: 'P9 Sidearm', kind: 'pistol', price: 0,
    damage: 26, headMult: 3.0, fireGap: 0.16, mag: 12, reserve: 36, reloadTime: 1.4,
    spreadStill: 0.004, spreadMove: 0.02, spreadBloom: 0.004, recoil: 0.008, range: 45,
    falloff: 0.55, moveSpeed: 1.0, auto: false, pellets: 1,
  },
  smg: {
    id: 'smg', name: 'VK-9 Ripper', kind: 'smg', price: 1400,
    damage: 19, headMult: 2.6, fireGap: 0.075, mag: 30, reserve: 90, reloadTime: 1.7,
    spreadStill: 0.007, spreadMove: 0.03, spreadBloom: 0.005, recoil: 0.007, range: 40,
    falloff: 0.5, moveSpeed: 0.98, auto: true, pellets: 1,
  },
  rifle: {
    id: 'rifle', name: 'AR-77 Kestrel', kind: 'rifle', price: 2700,
    damage: 33, headMult: 3.2, fireGap: 0.096, mag: 30, reserve: 90, reloadTime: 1.9,
    spreadStill: 0.0022, spreadMove: 0.028, spreadBloom: 0.006, recoil: 0.011, range: 70,
    falloff: 0.7, moveSpeed: 0.94, auto: true, pellets: 1,
  },
  shotgun: {
    id: 'shotgun', name: 'LM-12 Breacher', kind: 'shotgun', price: 1800,
    damage: 11, headMult: 2.0, fireGap: 0.85, mag: 6, reserve: 24, reloadTime: 2.4,
    spreadStill: 0.02, spreadMove: 0.045, spreadBloom: 0.008, recoil: 0.03, range: 22,
    falloff: 0.25, moveSpeed: 0.96, auto: false, pellets: 8,
  },
  marksman: {
    id: 'marksman', name: 'SR-50 Longshot', kind: 'marksman', price: 4200,
    damage: 92, headMult: 2.2, fireGap: 1.25, mag: 5, reserve: 15, reloadTime: 2.8,
    spreadStill: 0.0008, spreadMove: 0.06, spreadBloom: 0.002, recoil: 0.035, range: 90,
    falloff: 0.9, moveSpeed: 0.9, auto: false, pellets: 1,
  },
};

export const GRENADES = {
  frag: { id: 'frag', name: 'Frag Grenade', price: 300, radius: 7, damage: 120 },
  smoke: { id: 'smoke', name: 'Smoke Grenade', price: 250, radius: 5, duration: 14 },
  flash: { id: 'flash', name: 'Flash Grenade', price: 200, radius: 18, duration: 2.2 },
};

export const BUY_MENU = [
  { id: 'pistol', label: 'P9 Sidearm', price: 0, key: '1' },
  { id: 'smg', label: 'VK-9 Ripper SMG', price: 1400, key: '2' },
  { id: 'shotgun', label: 'LM-12 Breacher', price: 1800, key: '3' },
  { id: 'rifle', label: 'AR-77 Kestrel', price: 2700, key: '4' },
  { id: 'marksman', label: 'SR-50 Longshot', price: 4200, key: '5' },
  { id: 'frag', label: 'Frag Grenade', price: 300, key: '6' },
  { id: 'smoke', label: 'Smoke Grenade', price: 250, key: '7' },
  { id: 'flash', label: 'Flash Grenade', price: 200, key: '8' },
  { id: 'armor', label: 'Kevlar Vest (50)', price: 650, key: '9' },
];

// One view model per weapon class, built from boxes: a long rifle, a short SMG, a wide
// shotgun, a scoped marksman rifle and a compact pistol. The model bobs with movement,
// kicks on fire and dips on reload.
function buildViewModel(def) {
  const grip = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.hairline), roughness: 0.7, metalness: 0.2 });
  // Gunmetal body: dark steel, not the chalk-white ink colour — the old ink body
  // rendered as a flat white slab in front of the camera.
  const body = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.surface), roughness: 0.45, metalness: 0.5 });
  const accent = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.accent), roughness: 0.5, metalness: 0.3 });
  const model = new THREE.Group();
  const add = (w, h, d, x, y, z, mat = body) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    mesh.position.set(x, y, z);
    model.add(mesh);
    return mesh;
  };
  if (def.kind === 'pistol') {
    add(0.07, 0.09, 0.24, 0, 0, -0.12);
    add(0.06, 0.12, 0.07, 0, -0.09, 0.02, grip);
    add(0.012, 0.02, 0.012, 0, 0.055, -0.22, accent); // front sight
    add(0.072, 0.012, 0.2, 0, 0.048, -0.12, accent); // top stripe
  } else if (def.kind === 'smg') {
    add(0.08, 0.09, 0.34, 0, 0, -0.08);
    add(0.04, 0.04, 0.26, 0, 0.02, -0.32, grip);
    add(0.06, 0.14, 0.06, 0, -0.1, 0.0, grip);
  } else if (def.kind === 'shotgun') {
    add(0.1, 0.11, 0.5, 0, 0, -0.12);
    add(0.07, 0.07, 0.52, 0, 0.06, -0.14, grip);
    add(0.08, 0.06, 0.16, 0, 0.09, -0.05, accent);
  } else if (def.kind === 'marksman') {
    add(0.09, 0.1, 0.62, 0, 0, -0.2);
    add(0.05, 0.05, 0.4, 0, 0.03, -0.48, grip);
    add(0.06, 0.06, 0.2, 0, 0.09, -0.18, accent);
    add(0.08, 0.08, 0.18, 0, -0.02, 0.26, grip);
  } else {
    add(0.09, 0.1, 0.42, 0, 0, -0.1);
    add(0.045, 0.045, 0.4, 0, 0.025, -0.42, grip);
    add(0.075, 0.08, 0.22, 0, -0.02, 0.26, grip);
    add(0.05, 0.03, 0.12, 0, 0.065, -0.28, accent);
  }
  model.position.set(0.24, -0.2, -0.42);
  return model;
}

export function createWeapon(camera) {
  const models = {};
  for (const def of Object.values(WEAPONS)) {
    const model = buildViewModel(def);
    model.visible = false;
    camera.add(model);
    models[def.id] = model;
  }
  const flash = new THREE.Mesh(
    new THREE.PlaneGeometry(0.26, 0.26),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }),
  );
  flash.position.set(0.24, -0.17, -0.95);
  flash.visible = false;
  camera.add(flash);
  const flashLight = new THREE.PointLight(new THREE.Color(PALETTE.accent), 0, 6);
  flashLight.position.set(0.24, -0.16, -0.6);
  camera.add(flashLight);
  // A small steady light on the camera so the view model never renders black.
  const modelLight = new THREE.PointLight(new THREE.Color('#fff2dd'), 2.2, 1.6, 1.5);
  modelLight.position.set(0.2, 0.1, -0.3);
  camera.add(modelLight);

  let current = WEAPONS.rifle;
  let model = models.rifle;
  model.visible = true;
  const state = {
    mag: current.mag, reserve: current.reserve, cooldown: 0, reloadLeft: 0,
    flash: 0, kick: 0, bloom: 0, bobPhase: 0, switching: 0,
  };

  function equip(id) {
    const def = WEAPONS[id];
    if (!def || def === current) return false;
    model.visible = false;
    current = def;
    model = models[id];
    model.visible = true;
    state.mag = def.mag;
    state.reserve = def.reserve;
    state.cooldown = 0.25;
    state.reloadLeft = 0;
    state.flash = 0;
    state.kick = 0;
    state.bloom = 0;
    state.switching = 0.3;
    return true;
  }

  function step(dt, speed) {
    state.cooldown = Math.max(0, state.cooldown - dt);
    state.flash = Math.max(0, state.flash - dt);
    state.switching = Math.max(0, state.switching - dt);
    state.bloom = Math.max(0, state.bloom - dt * 0.09);
    state.kick += (0 - state.kick) * Math.min(1, dt * 14);
    state.bobPhase += dt * (4 + speed * 1.6);
    const bob = Math.min(1, speed / 5) * 0.012;
    model.position.set(
      0.24 + Math.sin(state.bobPhase) * bob,
      -0.2 + Math.abs(Math.cos(state.bobPhase)) * bob - state.switching * 0.12,
      -0.42 + state.kick,
    );
    model.rotation.x = state.kick * 2.2;
    if (state.reloadLeft > 0) {
      state.reloadLeft = Math.max(0, state.reloadLeft - dt);
      model.rotation.x = -0.55 * Math.sin(Math.PI * Math.min(1, (current.reloadTime - state.reloadLeft) / current.reloadTime));
      if (state.reloadLeft === 0) {
        const need = current.mag - state.mag;
        const take = Math.min(need, state.reserve);
        state.mag += take;
        state.reserve -= take;
      }
    }
    flash.visible = state.flash > 0;
    flash.rotation.z = state.flash * 30;
    flashLight.intensity = state.flash > 0 ? 18 : 0;
  }

  return {
    state,
    get current() { return current; },
    equip,
    step,
    ready() {
      return state.mag > 0 && state.cooldown === 0 && state.reloadLeft === 0 && state.switching === 0;
    },
    pullTrigger() {
      state.cooldown = current.fireGap;
      state.flash = 0.06;
      state.kick = 0.02 + current.recoil;
      state.bloom = Math.min(0.05, state.bloom + current.spreadBloom);
    },
    takeRound() {
      if (state.mag <= 0) return false;
      state.mag -= 1;
      return true;
    },
    reload() {
      if (state.reloadLeft > 0 || state.mag === current.mag || state.reserve === 0) return false;
      state.reloadLeft = current.reloadTime;
      return true;
    },
    spread(speed) {
      const move = Math.min(1, speed / 5.2);
      return current.spreadStill + move * current.spreadMove + state.bloom;
    },
    refillAmmo() {
      state.mag = current.mag;
      state.reserve = current.reserve;
      state.cooldown = 0;
      state.reloadLeft = 0;
      state.flash = 0;
      state.kick = 0;
      state.bloom = 0;
    },
  };
}
