// Probe v2: sample live game state during a ?test autopilot match, including
// player yaw/velocity/keys and line-of-sight to the nearest defender, to
// diagnose autopilot stalls. Writes JSONL samples to the OUT file.
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { extname, join, resolve, normalize, sep } from 'node:path';

const CHROME = process.env.DUSTLINE_CHROME ?? '/home/hatch/.cache/ms-playwright/chromium-1148/chrome-linux/chrome';
const ROOT = resolve(process.argv[2] ?? '/home/hatch/workspace/makefun-threejs-fps/game');
const SEED = process.argv[3] ?? '11';
const OUT = resolve(process.argv[4] ?? `/tmp/probe2-s${SEED}.jsonl`);
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
const server = createServer((req, res) => {
  let p;
  try { p = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname); } catch { res.writeHead(400).end(); return; }
  if (p.endsWith('/')) p += 'index.html';
  const file = resolve(join(ROOT, normalize(p)));
  if (file !== ROOT && !file.startsWith(ROOT + sep)) { res.writeHead(403).end(); return; }
  try { const s = statSync(file); res.writeHead(200, { 'content-type': MIME[extname(file).toLowerCase()] ?? 'application/octet-stream', 'content-length': s.size, 'cache-control': 'no-store' }); res.end(readFileSync(file)); }
  catch { res.writeHead(404).end(); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
const debugPort = 9500 + (Date.now() % 400);
const profile = `/tmp/dustline-probe2-${Date.now()}`;
const chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-dev-shm-usage', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--mute-audio', `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`, '--window-size=1280,800', 'about:blank'], { stdio: 'ignore' });
process.on('exit', () => { try { chrome.kill('SIGKILL'); } catch {} });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let wsUrl = null;
for (let i = 0; i < 40 && !wsUrl; i += 1) {
  try { const t = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json(); const p = t.find((x) => x.type === 'page'); if (p) wsUrl = p.webSocketDebuggerUrl; } catch { await sleep(250); }
}
const ws = new WebSocket(wsUrl);
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
let id = 0;
const pending = new Map();
const errors = [];
ws.onmessage = (e) => {
  const d = JSON.parse(e.data);
  if (d.id && pending.has(d.id)) { pending.get(d.id)(d.result ?? d.error); pending.delete(d.id); }
  else if (d.method === 'Runtime.exceptionThrown') errors.push(JSON.stringify(d.params.exceptionDetails).slice(0, 300));
};
const send = (m, p = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
const evalJs = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(`JS: ${JSON.stringify(r.exceptionDetails).slice(0, 700)}`);
  return r.result?.value;
};
await send('Runtime.enable');
await send('Page.enable');
await send('Page.navigate', { url: `http://127.0.0.1:${port}/index.html?test=1&seed=${SEED}&speed=60` });
await sleep(1500);

const SAMPLE = `(() => {
  const g = window.__game;
  if (!g) return null;
  const st = g.game.state;
  const bs = g.bomb.state;
  const you = g.player.state;
  let near = null, nearD = Infinity;
  for (const b of g.bots.bots) {
    if (b.team !== 'defend' || !b.alive) continue;
    const d = Math.hypot(b.position.x - you.position.x, b.position.z - you.position.z);
    if (d < nearD) { nearD = d; near = b; }
  }
  let los = null;
  if (near) {
    los = g.game.los(
      { x: you.position.x, y: you.position.y + you.eye, z: you.position.z },
      { x: near.position.x, y: near.position.y + 1.2, z: near.position.z });
  }
  return {
    now: +st.now.toFixed(1), round: st.round, phase: st.phase,
    rt: +st.roundTime.toFixed(1), score: [st.attackWins, st.defendWins],
    bomb: bs.status,
    carrier: typeof st.bombCarrier === 'string' ? st.bombCarrier : (st.bombCarrier ? st.bombCarrier.name : null),
    site: st.targetSite ? st.targetSite.name : null,
    you: { a: you.alive ? 1 : 0, x: +you.position.x.toFixed(2), z: +you.position.z.toFixed(2),
      yaw: +you.yaw.toFixed(2), vx: +you.velocity.x.toFixed(2), vz: +you.velocity.z.toFixed(2),
      mag: g.weapon.state.mag, keys: [...g.input.state.keys],
      near: near ? near.name : null, nearD: near ? +nearD.toFixed(1) : null, los },
    bots: g.bots.bots.map((b) => ({
      n: b.name, t: b.team[0], a: b.alive ? 1 : 0,
      x: +b.position.x.toFixed(1), z: +b.position.z.toFixed(1),
      yaw: +b.yaw.toFixed(2), car: b.carrier ? 1 : 0, pl: b.planting ? 1 : 0, df: b.defusing ? 1 : 0,
      ri: b.routeIndex, rl: b.route.length,
      ve: b.visibleEnemy ? (b.visibleEnemy.kind === 'player' ? 'YOU' : b.visibleEnemy.bot.name) : null,
    })),
  };
})()`;

const lines = [];
const t0 = Date.now();
while (Date.now() - t0 < 420000) {
  const done = await evalJs(`window.__testDone ? true : false`).catch(() => false);
  const s = await evalJs(SAMPLE).catch(() => null);
  if (s) lines.push(JSON.stringify(s));
  if (done) break;
  await sleep(700);
}
const final = await evalJs(`window.__testDone`).catch(() => null);
writeFileSync(OUT, lines.join('\n') + '\n');
console.log(`samples: ${lines.length}, errors: ${JSON.stringify(errors)}`);
console.log('FINAL:', JSON.stringify(final && { rounds: final.rounds, attackWins: final.attackWins, defendWins: final.defendWins, plants: final.stats.plants, defuses: final.stats.defuses, kills: final.kills, deaths: final.deaths, errors: final.errors, log: final.log }));
chrome.kill('SIGKILL');
server.close();
process.exit(0);
