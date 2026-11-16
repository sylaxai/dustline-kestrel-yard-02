// Objective test: plant -> detonation -> attack round win; defuse -> defend win;
// buy economy; grenade throw; reload. Uses window.__debugStep to fast-forward.
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { statSync, readFileSync } from 'node:fs';
import { extname, join, resolve, normalize, sep } from 'node:path';

const CHROME = '/home/hatch/.cache/ms-playwright/chromium-1148/chrome-linux/chrome';
const ROOT = '/home/hatch/workspace/makefun-threejs-fps/game';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
const server = createServer((req, res) => {
  let p;
  try { p = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname); } catch { res.writeHead(400).end(); return; }
  if (p.endsWith('/')) p += 'index.html';
  const file = resolve(join(ROOT, normalize(p)));
  if (file !== ROOT && !file.startsWith(ROOT + sep)) { res.writeHead(403).end(); return; }
  try {
    const s = statSync(file);
    res.writeHead(200, { 'content-type': MIME[extname(file).toLowerCase()] ?? 'application/octet-stream', 'content-length': s.size });
    res.end(readFileSync(file));
  } catch { res.writeHead(404).end(); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
const chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-dev-shm-usage', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--mute-audio', '--remote-debugging-port=9336', `--user-data-dir=/tmp/dustline-diag-${Date.now()}`, '--window-size=800,600', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let wsUrl = null;
for (let i = 0; i < 40 && !wsUrl; i += 1) {
  try {
    const targets = await (await fetch('http://127.0.0.1:9336/json/list')).json();
    const page = targets.find((t) => t.type === 'page');
    if (page) wsUrl = page.webSocketDebuggerUrl;
  } catch { await sleep(250); }
}
const ws = new WebSocket(wsUrl);
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
let id = 0;
const pending = new Map();
ws.onmessage = (e) => {
  const d = JSON.parse(e.data);
  if (d.id && pending.has(d.id)) { pending.get(d.id)(d.result ?? d.error); pending.delete(d.id); }
};
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const evalJs = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(`JS: ${JSON.stringify(r.exceptionDetails).slice(0, 700)}`);
  return r.result?.value;
};
await send('Runtime.enable');
await send('Page.enable');
await send('Page.navigate', { url: `http://127.0.0.1:${port}/index.html?seed=11` });
await sleep(2500);

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

const boot = await evalJs(`!!window.__game && window.__errors.length === 0`);
check('boot with no errors', boot === true);

// --- Economy ---------------------------------------------------------------
let econ = await evalJs(`(() => {
  const g = window.__game;
  g.game.startMatch();
  const before = g.economy.state.money;
  const denied = g.game.buy('rifle'); // $2700, only $800: must fail silently
  g.economy.state.money = 5000;
  g.game.buy('rifle');
  g.game.buy('frag');
  g.game.buy('armor');
  return { before, money: g.economy.state.money, ownedRifle: !!g.game.state.owned.rifle, weapon: g.weapon.current.id, grenades: g.game.state.grenades.frag, armor: g.player.state.armor };
})()`);
check('buy denied when broke, rifle+frag+armor bought', econ.ownedRifle && econ.weapon === 'rifle' && econ.grenades === 1 && econ.armor === 50, JSON.stringify(econ));

// --- Grenade ----------------------------------------------------------------
let nade = await evalJs(`(() => {
  const g = window.__game;
  g.game.debug.skipBuy();
  const before = g.game.state.grenades.frag;
  g.game.throwGrenade();
  window.__debugStep(60 * 3);
  return { before, after: g.game.state.grenades.frag, errors: window.__errors };
})()`);
check('frag thrown and detonated without errors', nade.before === 1 && nade.after === 0 && nade.errors.length === 0, JSON.stringify(nade));

// --- Reload -----------------------------------------------------------------
let reload = await evalJs(`(() => {
  const g = window.__game;
  while (g.weapon.state.mag > 0) g.game.shoot(0);
  const empty = g.weapon.state.mag;
  g.weapon.reload();
  window.__debugStep(60 * 3);
  return { empty, mag: g.weapon.state.mag, reserve: g.weapon.state.reserve };
})()`);
check('empty mag reloads from reserve', reload.empty === 0 && reload.mag === 30 && reload.reserve < 90, JSON.stringify(reload));

// --- Plant -> detonation -> attack wins --------------------------------------
let plant = await evalJs(`(() => {
  const g = window.__game;
  // fresh round, player carries the bomb
  g.game.startMatch();
  g.game.debug.skipBuy();
  const site = g.game.state.targetSite;
  const cx = (site.minX + site.maxX) / 2;
  const cz = (site.minZ + site.maxZ) / 2;
  g.player.state.position.set(cx, 0, cz);
  // keep every defender far away so the plant is not interrupted
  for (const b of g.bots.bots) if (b.team === 'defend') { b.position.set(20, 0, 15); b.parts.group.position.set(20, 0, 15); }
  g.input.state.keys.add('KeyE');
  window.__debugStep(60 * 4);
  g.input.state.keys.delete('KeyE');
  const planted = g.bomb.state.status === 'planted';
  const plants = g.game.state.stats.plants;
  window.__debugStep(60 * 36);
  return { planted, plants, phase: g.game.state.phase, attackWins: g.game.state.attackWins, bombStatus: g.bomb.state.status, errors: window.__errors };
})()`);
check('player plants bomb, it detonates, attack wins round', plant.planted && plant.plants === 1 && plant.attackWins === 1, JSON.stringify(plant));

// --- Defuse diagnostic -------------------------------------------------------
let diag = await evalJs(`(() => {
  const g = window.__game;
  const out = [];
  g.game.startMatch();
  g.game.debug.skipBuy();
  const site = g.game.state.targetSite;
  const cx = (site.minX + site.maxX) / 2;
  const cz = (site.minZ + site.maxZ) / 2;
  g.player.state.position.set(cx, 0, cz);
  for (const b of g.bots.bots) if (b.team === 'defend') { b.position.set(20, 0, 15); b.parts.group.position.set(20, 0, 15); }
  g.input.state.keys.add('KeyE');
  for (let s = 0; s < 8; s += 1) {
    window.__debugStep(30);
    out.push({ t: (s + 1) * 0.5, phase: g.game.state.phase, bomb: g.bomb.state.status, planter: typeof g.bomb.state.planter === 'string' ? g.bomb.state.planter : (g.bomb.state.planter && g.bomb.state.planter.name), hasE: g.input.state.keys.has('KeyE'), px: +g.player.state.position.x.toFixed(1), pz: +g.player.state.position.z.toFixed(1), hp: g.player.state.health, aAlive: g.game.aliveCount('attack'), dAlive: g.game.aliveCount('defend') });
  }
  g.input.state.keys.delete('KeyE');
  return out;
})()`);
console.log(JSON.stringify(diag, null, 1));

// --- Smoke grenade blocks bot vision -----------------------------------------
let smoke = await evalJs(`(() => {
  const g = window.__game;
  g.effects.smoke({ x: 0, y: 1.2, z: 0 }, 5, 14);
  const blocked = g.effects.blockedBySmoke({ x: -4, y: 1.5, z: 0 }, { x: 4, y: 1.5, z: 0 });
  const clear = g.effects.blockedBySmoke({ x: -4, y: 1.5, z: 10 }, { x: 4, y: 1.5, z: 10 });
  return { blocked, clear };
})()`);
check('smoke blocks line of sight through it, not beside it', smoke.blocked === true && smoke.clear === false, JSON.stringify(smoke));

console.log('diag done');
chrome.kill('SIGKILL');
server.close();
process.exit(0);
