import test from 'node:test';
import assert from 'node:assert/strict';
import { TelemetryClient } from '../src/utils/telemetryClient.ts';

function setup(t) {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout', 'setInterval'], now: 100000 });
  globalThis.window = globalThis;
  const storage = new Map([['gateway-token', 'test-secret']]);
  globalThis.sessionStorage = { getItem: k => storage.get(k), setItem: (k,v) => storage.set(k,v), removeItem: k => storage.delete(k) };
  const sockets = [];
  globalThis.WebSocket = class {
    static OPEN = 1;
    readyState = 1;
    sent = [];
    constructor() { sockets.push(this); }
    send(v) { this.sent.push(JSON.parse(v)); }
    close() { this.readyState = 3; this.onclose?.({ code: 1006 }); }
    receive(value) { this.onmessage?.({ data: JSON.stringify(value) }); }
  };
  const client = new TelemetryClient('ws://test');
  t.after(() => client.destroy());
  return { client, sockets };
}
test('continues reconnecting beyond six failures and destroys pending retry', t => {
  const { client, sockets } = setup(t);
  for (let i=0;i<8;i++) { sockets.at(-1).close(); t.mock.timers.tick(30000); }
  assert.equal(sockets.length, 9);
  sockets.at(-1).close();
  client.destroy();
  t.mock.timers.tick(60000);
  assert.equal(sockets.length, 9);
});
test('online requires authentication and fresh telemetry for both AGVs', t => {
  const { client, sockets } = setup(t);
  const ws = sockets[0];
  let status;
  client.onStatusChange = value => { status = value; };
  ws.onopen();
  ws.receive({ type: 'AUTH_REQUIRED' });
  assert.deepEqual(ws.sent[0], { type: 'AUTH', token: 'test-secret' });
  ws.receive({ type: 'SYSTEM_INFO', data: { gatewayMode: 'MOCK', geofenceActive: false, brokerConnected: true } });
  assert.equal(status, 'STALE');
  for (const id of ['AGV_01', 'AGV_02']) ws.receive({ type: 'AGV_POSE', data: { id, position: { x: 0, z: 0 }, heading: 0 } });
  assert.equal(status, 'CONNECTED');
  t.mock.timers.tick(6000);
  assert.equal(status, 'STALE');
});
