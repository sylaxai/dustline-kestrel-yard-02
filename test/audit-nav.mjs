// One-off audit: for every nav node, test whether a bot-sized box at that node
// overlaps any world collider, and whether adjacent nodes have line of sight.
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
const chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-dev-shm-usage', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--mute-audio', '--remote-debugging-port=9334', `--user-data-dir=/tmp/dustline-audit-${Date.now()}`, '--window-size=800,600', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let wsUrl = null;
for (let i = 0; i < 40 && !wsUrl; i += 1) {
  try {
    const targets = await (await fetch('http://127.0.0.1:9334/json/list')).json();
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
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 600));
  return r.result?.value;
};
await send('Runtime.enable');
await send('Page.enable');
await send('Page.navigate', { url: `http://127.0.0.1:${port}/index.html?seed=7` });
await sleep(3000);
const report = await evalJs(`(() => {
  const g = window.__game;
  const THREE = g.scene ? null : null;
  const out = { nodes: [], blockedEdges: [] };
  const nav = g.world.nav;
  const colliders = g.world.colliders;
  function blockedAt(x, z) {
    for (let c = 0; c < colliders.length; c += 1) {
      const b = colliders[c];
      if (x - 0.34 < b.max.x && x + 0.34 > b.min.x && 0.04 < b.max.y && 1.72 > b.min.y && z - 0.34 < b.max.z && z + 0.34 > b.min.z) return true;
    }
    return false;
  }
  // Probe each node with a bot-sized box.
  for (let i = 0; i < nav.nodes.length; i += 1) {
    const [x, z] = nav.nodes[i];
    out.nodes.push({ i, x, z, blocked: blockedAt(x, z) });
  }
  // Sample each edge every 0.5 m: a route must be walkable, not just its endpoints.
  for (const [a, b] of g.world.edges) {
    const [ax, az] = nav.nodes[a];
    const [bx, bz] = nav.nodes[b];
    const dist = Math.hypot(bx - ax, bz - az);
    const steps = Math.max(1, Math.ceil(dist / 0.5));
    for (let s = 1; s < steps; s += 1) {
      const x = ax + ((bx - ax) * s) / steps;
      const z = az + ((bz - az) * s) / steps;
      if (blockedAt(x, z)) {
        out.blockedEdges.push([a, b, Number(x.toFixed(1)), Number(z.toFixed(1))]);
        break;
      }
    }
  }
  return out;
})()`);
console.log(JSON.stringify(report, null, 1));
chrome.kill('SIGKILL');
server.close();
process.exit(0);
