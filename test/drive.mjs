// Headless Chrome driver for DUSTLINE: serves game/, drives Chrome over CDP with
// Node's built-in WebSocket, collects console errors, takes screenshots and runs the
// ?test autopilot match. No dependencies.
import { spawn, execSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { extname, join, resolve, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const CHROME = process.env.DUSTLINE_CHROME ?? '/home/hatch/.cache/ms-playwright/chromium-1148/chrome-linux/chrome';
const ROOT = resolve(process.argv[2] ?? '/home/hatch/workspace/makefun-threejs-fps/game');
const SEED = process.env.DUSTLINE_SEED ?? '7';
const OUT = resolve(process.argv[3] ?? '/home/hatch/workspace/makefun-threejs-fps/test/out');
mkdirSync(OUT, { recursive: true });

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
};

const server = createServer((req, res) => {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname);
  } catch {
    res.writeHead(400).end('bad request');
    return;
  }
  if (pathname.endsWith('/')) pathname += 'index.html';
  const file = resolve(join(ROOT, normalize(pathname)));
  if (file !== ROOT && !file.startsWith(ROOT + sep)) {
    res.writeHead(403).end('forbidden');
    return;
  }
  try {
    const stats = statSync(file);
    if (!stats.isFile()) throw new Error('not a file');
    res.writeHead(200, { 'content-type': MIME[extname(file).toLowerCase()] ?? 'application/octet-stream', 'content-length': stats.size, 'cache-control': 'no-store' });
    readFileSync(file);
    res.end(readFileSync(file));
  } catch {
    res.writeHead(404).end('not found');
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

const debugPort = 9400 + (Date.now() % 500); // unique per run: a stale Chrome from a
// failed run must never answer on the same port and serve old code
const profile = `/tmp/dustline-chrome-${Date.now()}`;
const chrome = spawn(CHROME, [
  '--headless=new',
  '--no-sandbox',
  '--disable-dev-shm-usage',
  '--use-angle=swiftshader',
  '--enable-unsafe-swiftshader',
  '--mute-audio',
  `--remote-debugging-port=${debugPort}`,
  `--user-data-dir=${profile}`,
  '--window-size=1280,800',
  'about:blank',
], { stdio: 'ignore' });
// Never leave a Chrome behind: on a waitFor timeout the script used to exit
// without killing it, and the next run then drove that stale browser.
process.on('exit', () => { try { chrome.kill('SIGKILL'); } catch { /* already dead */ } try { rmSync(profile, { recursive: true, force: true }); } catch { /* leftover profile */ } });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getPageWs() {
  for (let i = 0; i < 40; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${debugPort}/json/list`);
      const targets = await res.json();
      const page = targets.find((t) => t.type === 'page');
      if (page) return page.webSocketDebuggerUrl;
    } catch {
      // not up yet
    }
    await sleep(250);
  }
  throw new Error('chrome did not start');
}

const ws = new WebSocket(await getPageWs());
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
let msgId = 0;
const pending = new Map();
const consoleMessages = [];
ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  if (data.id && pending.has(data.id)) {
    const { resolve: res, reject: rej } = pending.get(data.id);
    pending.delete(data.id);
    if (data.error) rej(new Error(JSON.stringify(data.error)));
    else res(data.result);
  } else if (data.method === 'Runtime.consoleAPICalled') {
    consoleMessages.push(`${data.params.type}: ${data.params.args.map((a) => a.value ?? a.description ?? '').join(' ')}`);
  } else if (data.method === 'Runtime.exceptionThrown') {
    consoleMessages.push(`EXCEPTION: ${JSON.stringify(data.params.exceptionDetails).slice(0, 500)}`);
  } else if (data.method === 'Log.entryAdded') {
    const e = data.params.entry;
    if (e.level === 'error') consoleMessages.push(`LOG error: ${e.text} ${e.url ?? ''}`);
  }
};
function send(method, params = {}) {
  const id = ++msgId;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
}
async function evalJs(expression) {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(`JS error: ${JSON.stringify(result.exceptionDetails).slice(0, 800)}`);
  return result.result?.value;
}
const evalSession = evalJs;
const sendSession = send;
await send('Runtime.enable');
await send('Page.enable');
await send('Log.enable');

async function navigate(url) {
  await sendSession('Page.navigate', { url });
  await sleep(1500);
}

async function waitFor(expression, timeoutMs = 30000, pollMs = 500) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const value = await evalSession(expression);
      if (value) return value;
    } catch (e) {
      // page still loading
    }
    await sleep(pollMs);
  }
  throw new Error(`timeout waiting for ${expression}`);
}

async function screenshot(name) {
  const shot = await sendSession('Page.captureScreenshot', { format: 'jpeg', quality: 85 });
  writeFileSync(join(OUT, name), Buffer.from(shot.data, 'base64'));
  const stats = statSync(join(OUT, name));
  console.log(`shot ${name}: ${stats.size} bytes`);
  return stats.size;
}

// ---- 1. plain load: no console errors, game boots -------------------------
await navigate(`http://127.0.0.1:${port}/index.html?seed=${SEED}`);
await sleep(2500);
const booted = await evalSession(`!!window.__game && !!window.__game.scene`);
console.log('booted:', booted);
console.log('errors so far:', JSON.stringify(await evalSession(`window.__errors`)));
console.log('console:', consoleMessages.slice(0, 10).join('\n') || '(clean)');

// ---- 2. screenshots via ?shot modes ---------------------------------------
for (const mode of ['start', 'buy', 'play', 'end']) {
  await navigate(`http://127.0.0.1:${port}/index.html?shot=${mode}&seed=${SEED}`);
  await waitFor(`window.__shotReady === true`, 30000);
  await screenshot(`${mode}.jpg`);
  const errs = await evalSession(`window.__errors`);
  console.log(`shot ${mode}: errors=${JSON.stringify(errs)}`);
}

// ---- 3. full autopilot match ----------------------------------------------
await navigate(`http://127.0.0.1:${port}/index.html?test=1&seed=${SEED}&speed=60`);
const done = await waitFor(`window.__testDone`, 600000, 1000);
console.log('TEST MATCH:', JSON.stringify(done, null, 1));

console.log('console tail:', consoleMessages.slice(-10).join('\n') || '(clean)');
chrome.kill('SIGKILL');
server.close();
process.exit(0);
