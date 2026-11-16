// Boot and the one loop: a fixed 60 Hz simulation feeding a render at the display's rate.
// ?shot=start|play|buy|end with &seed=N sets up a deterministic frame for a capture,
// renders it twice, then freezes it and sets window.__shotReady.
// ?test=1 with &seed=N runs an autopilot match headlessly (no rendering) and writes a
// summary to window.__testDone, so the game can be played end to end without a mouse.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { createWorld, SITE_A } from './world.js';
import { createInput } from './input.js';
import { createPlayer } from './player.js';
import { createWeapon, BUY_MENU } from './weapons.js';
import { createBots } from './bots.js';
import { createBomb } from './bomb.js';
import { createEconomy } from './economy.js';
import { createEffects } from './effects.js';
import { createAudio } from './audio.js';
import { createHud } from './hud.js';
import { createGame } from './game.js';

const FIXED_STEP = 1 / 60;
const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const testMode = params.get('test') === '1';
const seed = Number.parseInt(params.get('seed') ?? `${Date.now() % 2147483647}`, 10) || 1;
const testSpeed = Math.max(1, Number.parseInt(params.get('speed') ?? '20', 10) || 20);

function mulberry32(initial) {
  let a = initial;
  return function random() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
// Seed the run: deterministic captures, varied live matches.
Math.random = mulberry32(seed);
const random = Math.random;

window.__errors = [];
window.addEventListener('error', (event) => {
  window.__errors.push(String(event.message || event.error));
});

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(PALETTE.canvas);
scene.fog = new THREE.Fog(new THREE.Color(PALETTE.canvas), 26, 70);
const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, 160);
scene.add(camera);

const world = createWorld(scene);
const effects = createEffects(scene);
const audio = createAudio();
const hud = createHud();
const player = createPlayer(world.colliders, 0, 15.5);
const weapon = createWeapon(camera);
const bomb = createBomb(scene);
const economy = createEconomy();
// Proxy for the bots' context: createGame builds the real callbacks, which are
// assigned into this object right after; bots.js reads them at call time.
const botCtxProxy = {};
const bots = createBots(scene, world, botCtxProxy);
const input = createInput(renderer.domElement, onLockChange);
const game = createGame({
  scene, camera, world, player, weapon, bots, bomb, economy, effects, audio, hud, input,
});
// The bots' context lives on the game object; the proxy is filled in now so the bots
// module (which captured the proxy) sees the real callbacks from here on. Copy
// property DESCRIPTORS, not values: Object.assign would invoke the getters once
// and freeze them (bombCarrier would stay 'player' forever and lastNoise null),
// which silently disabled bomb retrieval and the whole hearing system.
for (const key of Object.getOwnPropertyNames(game.botCtx)) {
  Object.defineProperty(botCtxProxy, key, Object.getOwnPropertyDescriptor(game.botCtx, key));
}

const body = player.state;
let elapsed = 0;
let started = false;
let frozen = false;
let accumulator = 0;
let lastTime = performance.now();
let prevFiring = false;
let testLog = [];
window.__testLog = testLog;
let testDone = false;
let testSteps = 0;
const MAX_TEST_STEPS = 60 * 60 * 40; // 40 minutes of sim time, worst case

hud.setAmmo(weapon.state.mag, weapon.state.reserve, weapon.current.name);
hud.setHealth(100, 0);
hud.setMoney(economy.state.money);
hud.setScore(0, 0);
hud.onPlay(() => {
  audio.unlock();
  if (shot || testMode) return;
  if (game.state.phase === 'menu') {
    game.startMatch();
    started = true;
  } else if (game.state.phase === 'matchEnd') {
    game.startMatch();
    started = true;
  }
  input.requestLock();
});

function onLockChange(locked) {
  if (shot || testMode) return;
  if (locked) {
    hud.hideOverlay();
  } else if (started && game.state.phase !== 'matchEnd' && game.state.phase !== 'roundEnd') {
    hud.showOverlay('paused');
  }
}

function syncCamera() {
  if (game.state.spectating) {
    const bot = game.state.spectating;
    camera.position.set(bot.position.x, bot.position.y + 1.55, bot.position.z);
    camera.rotation.set(0, bot.yaw, 0, 'YXZ');
    return;
  }
  camera.position.set(body.position.x, body.position.y + body.eye, body.position.z);
  camera.rotation.set(body.pitch, body.yaw, 0, 'YXZ');
}

function aimAt(point) {
  const dx = point.x - body.position.x;
  const dy = point.y - (body.position.y + body.eye);
  const dz = point.z - body.position.z;
  const length = Math.hypot(dx, dy, dz) || 1;
  body.yaw = Math.atan2(-dx, -dz);
  body.pitch = Math.asin(Math.max(-1, Math.min(1, dy / length)));
  syncCamera();
}

function handleKeys(dt) {
  const keys = input.state.keys;
  if (keys.has('KeyR')) {
    if (weapon.reload()) audio.reload();
    keys.delete('KeyR');
  }
  if (keys.has('KeyB')) {
    keys.delete('KeyB');
    if (game.state.phase === 'buy') {
      if (hud.buyOpen) hud.hideBuy();
      else hud.showBuy(game.buyMenuItems(), economy.state.money, game.buy);
    }
  }
  if (keys.has('KeyQ')) {
    keys.delete('KeyQ');
    game.cycleGrenade();
  }
  if (keys.has('KeyG')) {
    keys.delete('KeyG');
    game.throwGrenade();
  }
  for (const [code, id] of [['Digit1', 'pistol'], ['Digit2', 'smg'], ['Digit3', 'shotgun'], ['Digit4', 'rifle'], ['Digit5', 'marksman']]) {
    if (keys.has(code)) {
      keys.delete(code);
      game.equipWeapon(id);
    }
  }
  // Buy-menu number keys only act while the shop is open.
  if (hud.buyOpen) {
    for (const item of game.buyMenuItems()) {
      if (keys.has(`Digit${item.key}`)) {
        keys.delete(`Digit${item.key}`);
        hud.buyKey(item.id);
      }
    }
  }
  void dt;
}

function fireIfNeeded() {
  if (!input.state.firing || !player.state.alive) return;
  if (game.state.phase !== 'round') return;
  const def = weapon.current;
  const edge = !prevFiring;
  if ((def.auto || edge) && weapon.ready()) {
    game.shoot(weapon.spread(player.groundSpeed()));
  }
}

function step(dt) {
  elapsed += dt;
  const keys = input.state.keys;
  const inRound = game.state.phase === 'round';
  if (inRound && player.state.alive) {
    const look = input.takeLook();
    player.look(look.x, look.y);
    player.step(dt, keys);
  } else {
    input.takeLook();
  }
  weapon.step(dt, player.groundSpeed());
  game.step(dt, keys, elapsed);
  effects.step(dt, elapsed);
  hud.setCrosshairSpread(weapon.spread(player.groundSpeed()));
  prevFiring = input.state.firing;
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;
  if (!frozen) {
    handleKeys(dt);
    fireIfNeeded();
    accumulator += dt;
    let steps = 0;
    while (accumulator >= FIXED_STEP && steps < 5) {
      step(FIXED_STEP);
      accumulator -= FIXED_STEP;
      steps += 1;
    }
    if (accumulator > FIXED_STEP * 5) accumulator = 0;
    syncCamera();
  }
  renderer.render(scene, camera);
}

function settle(steps) {
  for (let index = 0; index < steps; index += 1) step(FIXED_STEP);
}

function paintTwiceThenReady() {
  let painted = 0;
  function paint() {
    requestAnimationFrame(paint);
    syncCamera();
    renderer.render(scene, camera);
    painted += 1;
    if (painted === 2) {
      window.__shotReady = true;
      frozen = true;
    }
  }
  requestAnimationFrame(paint);
}

// --- Deterministic captures -------------------------------------------------
function runShot(name) {
  hud.hideOverlay();
  if (name === 'start') {
    body.position.set(0.6, 0, 8.6);
    body.yaw = 0;
    body.pitch = 0;
    settle(20);
    aimAt(new THREE.Vector3(0, 1.5, -6));
    hud.showOverlay('start');
    paintTwiceThenReady();
    return;
  }
  game.startMatch();
  if (name === 'buy') {
    body.position.set(0, 0, 15.5);
    body.yaw = 0;
    settle(30);
    paintTwiceThenReady();
    return;
  }
  // play / end: skip the buy phase and fight.
  game.debug.skipBuy();
  body.position.set(0, 0, 2);
  body.yaw = 0;
  settle(30);
  const defenders = bots.bots.filter((b) => b.team === 'defend' && b.alive);
  if (defenders.length) {
    const target = defenders[0];
    aimAt(new THREE.Vector3(target.position.x, target.position.y + 1.2, target.position.z));
    for (let i = 0; i < 6; i += 1) {
      if (weapon.ready()) game.shoot(0);
      settle(8);
    }
    settle(20);
  }
  if (name === 'end') {
    game.state.attackWins = 6;
    game.state.defendWins = 2;
    game.debug.killAllDefenders();
    settle(60 * 5); // through the round-end banner into the match-end overlay
  }
  hud.setScore(game.state.attackWins, game.state.defendWins);
  hud.setAmmo(weapon.state.mag, weapon.state.reserve, weapon.current.name);
  paintTwiceThenReady();
}

// --- Headless autopilot match ----------------------------------------------
// The autopilot walks the same waypoint graph the bots use, so it tests the real
// routes instead of walking into walls, and fights the nearest defender it can see.
let autoRoute = [];
let autoRouteIndex = 0;
let autoGoalKey = '';

function autopilotStep() {
  const keys = input.state.keys;
  keys.clear();
  if (game.state.phase === 'menu') {
    game.startMatch();
    testLog.push('match start');
    return;
  }
  if (game.state.phase === 'buy') {
    // Spend: buy the best affordable rifle-class weapon on round 1, armour later.
    if (economy.state.money >= 2700 && !game.state.owned.rifle) game.buy('rifle');
    else if (economy.state.money >= 1400 && !game.state.owned.smg) game.buy('smg');
    else if (economy.state.money >= 650 && player.state.armor === 0) game.buy('armor');
    if (game.state.phaseTime > 2) game.debug.skipBuy();
    return;
  }
  if (game.state.phase === 'roundEnd') return;
  if (game.state.phase === 'matchEnd') return;
  if (!player.state.alive) return; // spectate; bots finish the round
  // Find the nearest living defender.
  let nearest = null;
  let nearestDist = Infinity;
  for (const bot of bots.bots) {
    if (bot.team !== 'defend' || !bot.alive) continue;
    const d = Math.hypot(bot.position.x - body.position.x, bot.position.z - body.position.z);
    if (d < nearestDist) {
      nearestDist = d;
      nearest = bot;
    }
  }
  const site = game.state.targetSite ?? SITE_A;
  // Carrying the bomb: the site is the goal; fight only defenders close enough
  // to stop the plant. Otherwise the nearest defender is the goal.
  const carrying = game.state.bombCarrier === 'player';
  const goal = carrying && (!nearest || nearestDist > 18)
    ? { x: (site.minX + site.maxX) / 2, z: (site.minZ + site.maxZ) / 2 }
    : nearest
      ? { x: nearest.position.x, z: nearest.position.z }
      : { x: (site.minX + site.maxX) / 2, z: (site.minZ + site.maxZ) / 2 };
  const goalKey = `${game.state.round}:${Math.round(goal.x / 4)},${Math.round(goal.z / 4)}`;
  if (goalKey !== autoGoalKey || autoRouteIndex >= autoRoute.length) {
    autoGoalKey = goalKey;
    const from = world.nav.nearest(body.position.x, body.position.z);
    const to = world.nav.nearest(goal.x, goal.z);
    autoRoute = world.nav.route(from, to, []).slice();
    autoRouteIndex = 0;
  }
  // Combat: snap the aim onto the nearest defender and fire when aligned — but
  // only when there is a real line of sight, never through a wall.
  let aimDiff = Infinity;
  if (nearest) {
    const ty = nearest.position.y + 1.2;
    const tdx = nearest.position.x - body.position.x;
    const tdy = ty - (body.position.y + body.eye);
    const tdz = nearest.position.z - body.position.z;
    const tlen = Math.hypot(tdx, tdy, tdz) || 1;
    const aimYaw = Math.atan2(-tdx, -tdz);
    aimDiff = aimYaw - body.yaw;
    while (aimDiff > Math.PI) aimDiff -= Math.PI * 2;
    while (aimDiff < -Math.PI) aimDiff += Math.PI * 2;
    const eye = new THREE.Vector3(body.position.x, body.position.y + body.eye, body.position.z);
    const target = new THREE.Vector3(nearest.position.x, ty, nearest.position.z);
    const sees = nearestDist < 60 && game.los(eye, target);
    if (sees) {
      const aligned = Math.abs(aimDiff) < 0.03;
      if (Math.abs(aimDiff) < 0.5) {
        body.yaw = aimYaw;
      } else {
        // Turn toward a visible enemy instead of idling: without this the
        // player froze for whole rounds in the gap between "close enough to
        // snap" (0.5) and "far enough to walk" (0.9) — aimDiff stayed put,
        // no branch pressed a key, and the carrier never planted.
        body.yaw += Math.max(-0.12, Math.min(0.12, aimDiff));
      }
      body.pitch = Math.asin(Math.max(-1, Math.min(1, tdy / tlen)));
      // The residual after turning, not the stale pre-turn value: the movement
      // branch below must see where the player faces now.
      aimDiff = aimYaw - body.yaw;
      while (aimDiff > Math.PI) aimDiff -= Math.PI * 2;
      while (aimDiff < -Math.PI) aimDiff += Math.PI * 2;
      if (aligned && weapon.ready()) {
        syncCamera(); // aim first, then sync: the shot must use the new aim, not last step's
        game.shoot(weapon.spread(player.groundSpeed()));
      }
    }
    if (!sees) aimDiff = Infinity;
  }
  // Movement: follow the route unless busy fighting something in front. While
  // fighting, strafe so the player is not a stationary target.
  if (Math.abs(aimDiff) > 0.9 && autoRouteIndex < autoRoute.length) {
    const node = world.nav.nodes[autoRoute[autoRouteIndex]];
    const dx = node[0] - body.position.x;
    const dz = node[1] - body.position.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.6) {
      autoRouteIndex += 1;
    } else {
      const wantYaw = Math.atan2(-dx, -dz);
      let dyaw = wantYaw - body.yaw;
      while (dyaw > Math.PI) dyaw -= Math.PI * 2;
      while (dyaw < -Math.PI) dyaw += Math.PI * 2;
      body.yaw += Math.max(-0.12, Math.min(0.12, dyaw));
      if (Math.abs(dyaw) < 0.6) keys.add('KeyW');
      else if (dyaw > 0) keys.add('KeyD');
      else keys.add('KeyA');
    }
  } else if (nearest && nearestDist < 28 && Math.abs(aimDiff) <= 0.5) {
    // In a fight (aimDiff is Infinity without line of sight): strafe,
    // switching direction about every 0.7s, and keep a little distance from
    // a target that gets too close.
    const strafeRight = Math.floor(game.state.now * 1.4) % 2 === 0;
    keys.add(strafeRight ? 'KeyD' : 'KeyA');
    if (nearestDist < 7) keys.add('KeyS');
  }
  // Plant when standing on a site with the bomb.
  if (game.state.bombCarrier === 'player' && game.debug.siteAtPlayer()) keys.add('KeyE');
  if (weapon.state.mag === 0 && weapon.reload()) audio.reload();
}

function runTestFrame() {
  if (testDone) return;
  requestAnimationFrame(runTestFrame);
  for (let i = 0; i < testSpeed; i += 1) {
    if (testDone) break;
    syncCamera(); // the render loop never runs in test mode, so sync here
    try {
      autopilotStep();
    } catch (err) {
      // A test-driver bug must never freeze the game: record it and keep stepping.
      window.__errors.push(String(err && err.message ? err.message : err));
    }
    step(FIXED_STEP);
    testSteps += 1;
    if (game.state.phase === 'matchEnd' || testSteps >= MAX_TEST_STEPS) {
      testDone = true;
      window.__testDone = {
        seed,
        steps: testSteps,
        simSeconds: testSteps / 60,
        rounds: game.state.round,
        attackWins: game.state.attackWins,
        defendWins: game.state.defendWins,
        matchWinner: game.state.matchWinner,
        kills: game.state.kills,
        deaths: game.state.deaths,
        money: economy.state.money,
        stats: game.state.stats,
        errors: window.__errors,
        log: testLog,
      };
    }
  }
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

syncCamera();
window.__game = {
  game, player, weapon, bots, bomb, economy, effects, audio, hud, world, scene, camera, input,
};
// Test hook: advance the fixed-step simulation without rendering (fast-forward).
window.__debugStep = (steps) => {
  for (let i = 0; i < steps; i += 1) step(FIXED_STEP);
  syncCamera();
};
// Debug and test hooks: used by the ?shot captures and the ?test autopilot only.
game.debug = {
  skipBuy() {
    if (game.state.phase === 'buy') {
      game.state.phase = 'round';
      game.state.roundTime = 100;
      hud.hideBuy();
      hud.hint('');
    }
  },
  killAllDefenders() {
    game.eliminateTeam('defend');
  },
  siteAtPlayer() {
    return bomb.siteAt(player.state.position.x, player.state.position.z, world.sites);
  },
};
// Expose the buy menu items to the input handler.
game.buyMenuItems = () => BUY_MENU;

if (shot) runShot(shot);
else if (testMode) requestAnimationFrame(runTestFrame);
else requestAnimationFrame(frame);
