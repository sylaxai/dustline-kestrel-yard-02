// Kestrel Yard: an original 48 x 36 m dusk industrial yard, built from boxes, cylinders
// and one canvas texture (the site letters). Three lanes run south to north — west lane,
// mid, east lane — into two bomb sites, A in the north-west yard and B in the north-east
// warehouse apron. Every solid is a collider for players and bots and a surface a bullet
// stops on. The waypoint graph (nav.js) is laid over the same open ground the player walks.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { createNav } from './nav.js';

// Bomb sites, as ground rectangles the plant logic tests against.
export const SITE_A = { minX: -22, maxX: -10, minZ: -17, maxZ: -8, name: 'A' };
export const SITE_B = { minX: 10, maxX: 22, minZ: -17, maxZ: -8, name: 'B' };

export const ATTACKER_SPAWNS = [
  [-16, 15.5], [-8, 15.5], [0, 15.5], [8, 15.5], [16, 15.5],
];
export const DEFENDER_SPAWNS = [
  [-18, -11.5], [-13, -11.5], [0, -14.5], [13, -11.5], [18, -11.5],
];

// Waypoints: open ground, one per lane bend, site corner and doorway.
const NODES = [
  [-16, 15], [0, 15], [16, 15], // 0-2 south spawn
  [-16, 9], [0, 9], [16, 9], // 3-5 south field
  [-16, 0], [0, 2], [16, 0], // 6-8 mid field
  [-6, 8], [6, 8], // 9-10 south cover
  [-16, -5], [0, -3.5], [16, -5], // 11-13 north field
  [-20, -11], [20, -11], // 14-15 lane mouths
  [-18, -11], [18, -11], // 16-17 site centres
  [-10, -11], [10, -11], // 18-19 site doors
  [-4, -5], [4, -5], // 20-21 mid connector
  [0, -11], // 22 mid connector north
  [-10, -16.5], [10, -16.5], // 23-24 site backs
  [-8, 12], [8, 12], // 25-26 spawn exits
  [-12, -5], [12, -5], // 27-28 flank bends
];
const EDGES = [
  [0, 3], [1, 4], [2, 5], [0, 25], [2, 26], [1, 25], [1, 26],
  [3, 6], [4, 9], [4, 10], [5, 8], [9, 6], [10, 8],
  [6, 11], [7, 4], [7, 12], [8, 13], [9, 7], [10, 7],
  [11, 14], [11, 27], [13, 15], [13, 28], [12, 20], [12, 21], [12, 22],
  [14, 16], [15, 17], [16, 18], [17, 19],
  [18, 27], [19, 28], [18, 22], [19, 22], [20, 27], [21, 28],
  [27, 11], [28, 13],
  [18, 23], [19, 24],
];

function siteLetterTexture(letter) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const g = canvas.getContext('2d');
  g.clearRect(0, 0, 256, 256);
  g.fillStyle = PALETTE.accent;
  g.font = 'bold 190px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(letter, 128, 138);
  const texture = new THREE.CanvasTexture(canvas);
  texture.anisotropy = 4;
  return texture;
}

export function createWorld(scene) {
  const group = new THREE.Group();
  scene.add(group);

  const materials = {};
  for (const name of Object.keys(PALETTE)) {
    materials[name] = new THREE.MeshStandardMaterial({
      color: new THREE.Color(PALETTE[name]),
      roughness: name === 'accent' || name === 'ink' ? 0.55 : 0.92,
      metalness: 0.04,
    });
  }
  const containerAmber = new THREE.MeshStandardMaterial({ color: new THREE.Color('#8a6a2f'), roughness: 0.8, metalness: 0.15 });
  const containerTeal = new THREE.MeshStandardMaterial({ color: new THREE.Color('#2f5d5a'), roughness: 0.8, metalness: 0.15 });
  const containerRust = new THREE.MeshStandardMaterial({ color: new THREE.Color('#7a3b2e'), roughness: 0.85, metalness: 0.1 });
  const glowAmber = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.accent), emissive: new THREE.Color(PALETTE.accent), emissiveIntensity: 1.4, roughness: 0.4 });

  const colliders = [];
  const shootables = [];

  function box(width, height, depth, x, y, z, material, { collider = true, shadow = true } = {}) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material);
    mesh.position.set(x, y, z);
    mesh.castShadow = shadow;
    mesh.receiveShadow = true;
    group.add(mesh);
    if (collider) colliders.push(new THREE.Box3().setFromObject(mesh));
    shootables.push(mesh);
    return mesh;
  }

  function cylinder(radius, height, x, z, material) {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, height, 14), material);
    mesh.position.set(x, height / 2, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    colliders.push(new THREE.Box3().setFromObject(mesh));
    shootables.push(mesh);
    return mesh;
  }

  // Ground: one concrete slab, sand patches laid flat on top of it.
  box(48.4, 0.4, 36.4, 0, -0.2, 0, materials.surface, { collider: true, shadow: false });
  box(20, 0.06, 10, -12, 0.03, 6, materials.sand, { collider: false, shadow: false });
  box(18, 0.06, 8, 13, 0.03, -2, materials.sand, { collider: false, shadow: false });
  box(10, 0.06, 6, 0, 0.03, -12, materials.sand, { collider: false, shadow: false });

  // Perimeter walls, 5 m high, open to the dusk sky.
  box(0.6, 5, 36.4, -24.2, 2.5, 0, materials.surface);
  box(0.6, 5, 36.4, 24.2, 2.5, 0, materials.surface);
  box(48.4, 5, 0.6, 0, 2.5, -18.2, materials.surface);
  box(48.4, 5, 0.6, 0, 2.5, 18.2, materials.surface);

  // Mid wall (z = -2): two segments leave the mid doors open at x in [-3, 3].
  box(9.4, 4, 0.6, -7.7, 2, -2, materials.hairline);
  box(9.4, 4, 0.6, 7.7, 2, -2, materials.hairline);
  box(1.2, 1.1, 0.8, -3.4, 0.55, -2, materials.accent, { collider: false, shadow: false });
  box(1.2, 1.1, 0.8, 3.4, 0.55, -2, materials.accent, { collider: false, shadow: false });

  // North connector wall (z = -8): mid reaches the sites through the gap at x in [-2, 2].
  box(6.4, 4, 0.6, -5.2, 2, -8, materials.hairline);
  box(6.4, 4, 0.6, 5.2, 2, -8, materials.hairline);
  // Site divider walls (x = -8 and x = 8, z -18..-8) with a doorway at z in [-12, -10].
  box(0.6, 4, 5.4, -8, 2, -15.3, materials.hairline);
  box(0.6, 4, 2.6, -8, 2, -8.7, materials.hairline);
  box(0.6, 4, 5.4, 8, 2, -15.3, materials.hairline);
  box(0.6, 4, 2.6, 8, 2, -8.7, materials.hairline);

  // Cover, south field: crates to crouch behind.
  box(1.6, 1.1, 1.6, -6, 0.55, 5, materials.hairline);
  box(1.6, 1.1, 1.6, 6, 0.55, 5, materials.hairline);
  box(3.2, 1.0, 1.2, -12, 0.5, 9, materials.hairline);
  box(3.2, 1.0, 1.2, 12, 0.5, 9, materials.hairline);

  // Shipping containers: long sightlines broken into corners on both lanes.
  box(6.0, 2.6, 2.6, -20.5, 1.3, -5, containerAmber);
  box(6.0, 2.6, 2.6, -20.5, 1.3, 3.5, containerTeal);
  box(2.6, 2.6, 6.0, 20.5, 1.3, -5, containerRust);
  box(2.6, 2.6, 6.0, 20.5, 1.3, 3.5, containerAmber);
  box(6.0, 2.6, 2.6, -14, 1.3, -14.5, containerTeal);
  box(6.0, 2.6, 2.6, 14, 1.3, -14.5, containerRust);
  // Stacked containers on site A, and a low platform on site B.
  box(6.0, 2.6, 2.6, -19, 1.3, -16, containerRust);
  box(6.0, 2.6, 2.6, -19, 3.9, -16, containerAmber);
  box(5.0, 0.5, 4.0, 17, 0.25, -15, materials.surface);

  // Barrels and crates inside the sites.
  cylinder(0.45, 1.1, -12.5, -9.3, containerRust);
  cylinder(0.45, 1.1, -9.5, -9.5, containerAmber);
  cylinder(0.45, 1.1, 12.5, -9.3, containerTeal);
  cylinder(0.45, 1.1, 9.5, -9.5, containerTeal);
  box(1.4, 1.4, 1.4, -21, 0.7, -9.5, materials.hairline);
  box(1.4, 1.4, 1.4, 21, 0.7, -9.5, materials.hairline);
  box(1.1, 1.1, 1.1, -13.5, 0.55, -16.5, materials.sand);
  box(1.1, 1.1, 1.1, 13.5, 0.55, -16.5, materials.sand);

  // Site frames: amber strips on the ground plus a floating letter over each site.
  function siteFrame(site) {
    const w = site.maxX - site.minX;
    const d = site.maxZ - site.minZ;
    const cx = (site.minX + site.maxX) / 2;
    const cz = (site.minZ + site.maxZ) / 2;
    box(w, 0.08, 0.3, cx, 0.06, site.minZ, glowAmber, { collider: false, shadow: false });
    box(w, 0.08, 0.3, cx, 0.06, site.maxZ, glowAmber, { collider: false, shadow: false });
    box(0.3, 0.08, d, site.minX, 0.06, cz, glowAmber, { collider: false, shadow: false });
    box(0.3, 0.08, d, site.maxX, 0.06, cz, glowAmber, { collider: false, shadow: false });
    const letter = new THREE.Mesh(
      new THREE.PlaneGeometry(3.2, 3.2),
      new THREE.MeshBasicMaterial({ map: siteLetterTexture(site.name), transparent: true, side: THREE.DoubleSide, depthWrite: false }),
    );
    letter.position.set(cx, 4.4, cz);
    group.add(letter);
    return letter;
  }
  const siteLetters = [siteFrame(SITE_A), siteFrame(SITE_B)];

  // Light poles: warm pools of light on the lanes.
  function pole(x, z) {
    box(0.18, 5.4, 0.18, x, 2.7, z, materials.hairline);
    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.22, 10, 8),
      new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.ink), emissive: new THREE.Color(PALETTE.accent), emissiveIntensity: 2.2 }),
    );
    head.position.set(x, 5.5, z);
    group.add(head);
    const light = new THREE.PointLight(new THREE.Color(PALETTE.accent), 26, 15, 1.8);
    light.position.set(x, 5.2, z);
    scene.add(light);
  }
  pole(-12, 6);
  pole(12, 6);
  pole(6, -3);

  // Distant skyline silhouettes outside the walls, so the horizon is not empty fog.
  const skyline = new THREE.Group();
  const skyMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#141821') });
  const skylineBoxes = [
    [-30, 8, -30, 8, 16], [30, 10, -28, 10, 20], [-8, 14, -34, 7, 12], [14, 6, -32, 9, 10],
    [-34, 12, 10, 8, 14], [34, 9, 14, 7, 12], [0, 20, -36, 6, 18], [-18, 7, 30, 10, 9],
  ];
  for (const [x, w, z, d, h] of skylineBoxes) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), skyMat);
    m.position.set(x, h / 2 - 1, z);
    skyline.add(m);
  }
  scene.add(skyline);
  // A low amber sun disc on the horizon, so the sky has a focal point and the
  // dusk reads as dusk instead of an empty dark void.
  const sunDisc = new THREE.Mesh(
    new THREE.CircleGeometry(3.2, 32),
    new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffb45e'), fog: false }),
  );
  sunDisc.position.set(-34, 9, 30);
  sunDisc.lookAt(0, 4, 0);
  scene.add(sunDisc);
  const sunHalo = new THREE.Mesh(
    new THREE.CircleGeometry(5.2, 32),
    new THREE.MeshBasicMaterial({ color: new THREE.Color('#f0a830'), transparent: true, opacity: 0.18, fog: false }),
  );
  sunHalo.position.set(-34.2, 9, 30.2);
  sunHalo.lookAt(0, 4, 0);
  scene.add(sunHalo);

  // Lighting: low amber sun, cool sky fill, and a faint hemisphere so shadows stay readable.
  const sky = new THREE.HemisphereLight(new THREE.Color('#5a6b84'), new THREE.Color('#2a2620'), 1.15);
  scene.add(sky);
  const sun = new THREE.DirectionalLight(new THREE.Color('#ffb45e'), 2.9);
  sun.position.set(-14, 18, 12);
  sun.target.position.set(4, 0, -6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -30;
  sun.shadow.camera.right = 30;
  sun.shadow.camera.top = 30;
  sun.shadow.camera.bottom = -30;
  sun.shadow.camera.far = 70;
  sun.shadow.bias = -0.0006;
  scene.add(sun, sun.target);
  const fill = new THREE.DirectionalLight(new THREE.Color('#7d8fb0'), 0.65);
  fill.position.set(12, 10, 14);
  scene.add(fill);
  const siteGlowA = new THREE.PointLight(new THREE.Color(PALETTE.accent), 14, 12, 1.8);
  siteGlowA.position.set(-16, 3.4, -12.5);
  scene.add(siteGlowA);
  const siteGlowB = siteGlowA.clone();
  siteGlowB.position.set(16, 3.4, -12.5);
  scene.add(siteGlowB);

  const nav = createNav(NODES, EDGES);

  return {
    colliders,
    shootables,
    group,
    nav,
    edges: EDGES,
    siteLetters,
    siteGlowA,
    siteGlowB,
    sites: [SITE_A, SITE_B],
  };
}
