// Optional Windows/Chrome Docker smoke check. Uses isolated containers/profile.
import { execFileSync, spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import WebSocket from 'ws';
import assert from 'node:assert/strict';

const suffix = randomBytes(6).toString('hex');
const network = `twin-smoke-${suffix}`;
const backend = `${network}-backend`;
const frontend = `${network}-frontend`;
const token = randomBytes(32).toString('hex');
const profile = await mkdtemp(path.join(tmpdir(), 'twin-smoke-'));
const containers = [];
const docker = args => execFileSync('docker', args, { encoding: 'utf8', windowsHide: true }).trim();
let browser, cdp, networkCreated = false;
let messageId = 0;
const pending = new Map();
const errors = [];
async function waitFor(fn, label) {
  for (let i = 0; i < 150; i++) {
    try { const value = await fn(); if (value) return value; } catch { /* Startup race. */ }
    await delay(200);
  }
  throw new Error(`Timeout: ${label}`);
}
function call(method, params = {}) {
  const id = ++messageId;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 10000);
    pending.set(id, { resolve: value => { clearTimeout(timer); resolve(value); }, reject });
    cdp.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const result = await call('Runtime.evaluate', { expression, returnByValue: true });
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
  return result.result?.value;
}
try {
  const reservation = createServer();
  reservation.listen(0, '127.0.0.1');
  await once(reservation, 'listening');
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  const origin = `http://127.0.0.1:${port}`;
  docker(['network', 'create', network]); networkCreated = true;
  docker(['run', '-d', '--name', backend, '--network', network, '--network-alias', 'backend',
    '-e', 'WS_HOST=0.0.0.0', '-e', `GATEWAY_TOKEN=${token}`, '-e', `ALLOWED_ORIGINS=${origin}`,
    '-e', 'GATEWAY_MODE=MOCK', 'industrial-twin-backend']);
  containers.push(backend);
  docker(['run', '-d', '--name', frontend, '--network', network, '-p', `127.0.0.1:${port}:80`, 'industrial-twin-frontend']);
  containers.push(frontend);
  await waitFor(async () => (await fetch(origin)).ok, 'frontend HTTP');
  assert.equal((await fetch(`${origin}/models/robot.glb`)).status, 200);
  const executable = process.env.BROWSER_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  browser = spawn(executable, ['--headless=new', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--disable-background-networking', '--remote-debugging-port=0',
    '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader',
    `--user-data-dir=${profile}`, 'about:blank'], { windowsHide: true, stdio: 'ignore' });
  browser.on('error', error => errors.push(error.message));
  const debugPort = await waitFor(async () => (await readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0], 'browser debugger');
  const target = await (await fetch(`http://127.0.0.1:${debugPort}/json/new?about:blank`, { method: 'PUT' })).json();
  cdp = new WebSocket(target.webSocketDebuggerUrl);
  await once(cdp, 'open');
  cdp.on('message', bytes => {
    const message = JSON.parse(bytes.toString());
    if (message.id) {
      const task = pending.get(message.id); pending.delete(message.id);
      if (message.error) task?.reject(new Error(JSON.stringify(message.error)));
      else task?.resolve(message.result);
    } else if (message.method === 'Runtime.exceptionThrown') errors.push(JSON.stringify(message.params.exceptionDetails));
  });
  await call('Runtime.enable');
  await call('Page.enable');
  await call('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
  await call('Page.navigate', { url: origin });
  await waitFor(() => evaluate("!!document.querySelector('#gateway-token')"), 'login form');
  await evaluate(`(() => { const input = document.querySelector('#gateway-token'); input.value = ${JSON.stringify(token)}; input.dispatchEvent(new Event('input', {bubbles:true})); document.querySelector('.gateway-login form').requestSubmit(); })()`);
  await waitFor(() => evaluate("document.querySelector('.net-badge')?.textContent.includes('模拟网关在线')"), 'authenticated telemetry');
  assert.equal(await evaluate("document.querySelectorAll('.task-center').length"), 1, 'single authoritative task panel');
  await evaluate("document.querySelector('.poi-btn').click()");
  await evaluate("document.querySelector('.fence-toggle-btn').click()");
  await waitFor(() => evaluate("document.querySelector('.fence-toggle-btn')?.classList.contains('active')"), 'geofence acknowledgement');
  await evaluate("document.querySelector('.alarm-toggle-btn').click()");
  await waitFor(() => evaluate("document.querySelector('.agv-card')?.classList.contains('card-alarm')"), 'simulated alarm');
  await evaluate("document.querySelector('.alarm-toggle-btn').click()");
  await delay(1200);
  await evaluate("document.querySelector('.playback-toggle-btn').click()");
  await waitFor(() => evaluate("!!document.querySelector('.playback-timeline-bar')"), 'recorded history playback');
  await evaluate("(() => { const slider = document.querySelector('.time-slider'); slider.value = '50'; slider.dispatchEvent(new Event('input', {bubbles:true})); document.querySelector('.play-btn').click(); })()");
  await delay(300);
  await evaluate("document.querySelector('.exit-btn').click()");
  await waitFor(() => evaluate("!document.querySelector('.playback-timeline-bar')"), 'exit to buffered live state');
  if (process.env.SMOKE_TASK_FLOW) {
    await evaluate("if (document.querySelector('.fence-toggle-btn').classList.contains('active')) document.querySelector('.fence-toggle-btn').click()");
    await waitFor(() => evaluate("!document.querySelector('.fence-toggle-btn').classList.contains('active')"), 'clear fence before dispatch');
    await evaluate("document.querySelector('.slot-cell.occupied').click()");
    await waitFor(() => evaluate("!!document.querySelector('.task-list article')"), 'server accepts pick task');
    await waitFor(() => evaluate("document.querySelector('.task-list article[data-status=COMPLETED]') !== null"), 'drive, pick, unload and return');
    await waitFor(() => evaluate("document.querySelector('.task-center footer').textContent.includes('过箱 1 箱')"), 'backend conveyor count');
    await evaluate("document.querySelector('.charge-toggle-btn').click()");
    await waitFor(() => evaluate("!!document.querySelector('.agv-card.card-charging')"), 'arrival at charging dock');
    assert.ok(await evaluate("document.querySelector('.agv-card.card-charging .metric-row.coord').textContent.includes('-4.50, 2.00')"));
    await waitFor(() => evaluate("document.querySelectorAll('.task-list article[data-status=COMPLETED]').length === 2"), 'charging and return complete');
    await call('Page.reload', { ignoreCache: true });
    await waitFor(() => evaluate("document.querySelectorAll('.task-list article[data-status=COMPLETED]').length === 2"), 'refresh restores server tasks');
    console.log('PASS: actual browser dispatch -> drive -> shelf pickup -> conveyor -> return, charger arrival -> charge -> return, task history survives refresh');
  }
  assert.deepEqual(errors, [], 'No uncaught browser exceptions');
  if (process.env.SMOKE_SCREENSHOT) {
    const screenshot = await call('Page.captureScreenshot', { format: 'png' });
    await writeFile(process.env.SMOKE_SCREENSHOT, Buffer.from(screenshot.data, 'base64'));
  }
  console.log('PASS: container HTTP/model, Nginx WebSocket proxy, token login, fresh telemetry, POI, geofence acknowledgement, alarm toggle, history seek/play/exit, no uncaught browser exceptions');
} finally {
  if (cdp?.readyState === WebSocket.OPEN) await call('Browser.close').catch(() => {});
  cdp?.terminate();
  if (browser && browser.exitCode === null) { browser.kill(); await Promise.race([once(browser, 'exit'), delay(3000)]).catch(() => {}); }
  for (const container of containers.reverse()) docker(['rm', '-f', container]);
  if (networkCreated) docker(['network', 'rm', network]);
  const resolved = path.resolve(profile);
  if (path.dirname(resolved) !== path.resolve(tmpdir()) || !path.basename(resolved).startsWith('twin-smoke-')) throw new Error('Unexpected cleanup target');
  await rm(resolved, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }).catch(() => {});
}
