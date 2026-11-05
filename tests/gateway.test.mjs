import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import WebSocket from 'ws';
import mqttPacket from 'mqtt-packet';

const secret = 'test-only-secret-0123456789abcdef';
async function gateway(t, extra = {}) {
  const reservation = createServer();
  reservation.listen(0, '127.0.0.1');
  await once(reservation, 'listening');
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  const child = spawn(process.execPath, ['--import', 'tsx', 'server.ts'], {
    cwd: new URL('../', import.meta.url),
    env: { ...process.env, WS_PORT: String(port), WS_HOST: '127.0.0.1', GATEWAY_TOKEN: secret,
      ALLOWED_ORIGINS: 'http://localhost:5173', GATEWAY_MODE: 'MOCK', ...extra },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  child.stderr.on('data', b => process.stderr.write(b));
  t.after(async () => { if (child.exitCode === null) { child.kill(); await once(child, 'exit'); } });
  await Promise.race([
    new Promise((resolve,reject) => {
      child.stdout.on('data', b => { if (b.toString().includes('listening on')) resolve(); });
      child.once('exit', code => reject(new Error(`gateway exited ${code}`)));
    }), delay(10000, undefined, { ref: false }).then(() => { throw new Error('gateway startup timeout'); })
  ]);
  await delay(50);
  return `ws://127.0.0.1:${port}/v1/telemetry`;
}
function session(t, url, origin = 'http://localhost:5173') {
  const ws = new WebSocket(url, { origin });
  const messages = [];
  ws.on('message', b => messages.push(JSON.parse(b.toString())));
  ws.on('error', () => {});
  t.after(() => ws.terminate());
  const wait = async predicate => {
    for (let i=0;i<100;i++) {
      const found = messages.find(predicate);
      if (found) return found;
      await delay(20);
    }
    throw new Error('message timeout');
  };
  return { ws, messages, wait };
}
async function authenticate(session) {
  await session.wait(m => m.type === 'AUTH_REQUIRED');
  session.ws.send(JSON.stringify({ type: 'AUTH', token: secret }));
  return session.wait(m => m.type === 'SYSTEM_INFO');
}

test('gateway rejects foreign origins and bad credentials, then synchronizes authenticated clients', { timeout: 15000 }, async t => {
  const url = await gateway(t);
  const foreign = session(t, url, 'https://untrusted.example');
  const [error] = await once(foreign.ws, 'error');
  assert.match(error.message, /401|403/);
  const invalid = session(t, url);
  await invalid.wait(m => m.type === 'AUTH_REQUIRED');
  assert.equal(invalid.messages.some(m => m.type === 'AGV_POSE'), false);
  invalid.ws.send(JSON.stringify({ type: 'AUTH', token: 'wrong' }));
  const [code] = await once(invalid.ws, 'close');
  assert.equal(code, 1008);
  const a = session(t, url);
  await authenticate(a);
  a.ws.send(JSON.stringify({ type: 'SET_GEOFENCE', active: true }));
  assert.equal((await a.wait(m => m.type === 'GEOFENCE_STATUS')).data.active, true);
  const b = session(t, url);
  assert.equal((await authenticate(b)).data.geofenceActive, true);
  a.ws.send(JSON.stringify({ type: 'PING' }));
  await a.wait(m => m.type === 'PONG');
  await b.wait(m => m.type === 'AGV_POSE');
  a.ws.send(JSON.stringify({ type: 'COMMAND', data: { id: 'pick-once', kind: 'PICK', slotId: 'LOC-1-1' } }));
  assert.equal((await a.wait(m => m.type === 'COMMAND_RESULT' && m.data.requestId === 'pick-once')).data.accepted, true);
  a.ws.send(JSON.stringify({ type: 'COMMAND', data: { id: 'pick-once', kind: 'PICK', slotId: 'LOC-1-1' } }));
  await b.wait(m => m.type === 'OPERATIONS_STATE' && m.data.tasks.length === 1);
  const refreshed = session(t, url);
  await authenticate(refreshed);
  const snapshot = await refreshed.wait(m => m.type === 'OPERATIONS_STATE');
  assert.equal(snapshot.data.tasks.length, 1);
  assert.equal(snapshot.data.slots.find(s => s.id === 'LOC-1-1').status, 'PICKING');
});

test('MQTT mode validates topic/payload and refuses unsupported control', { timeout: 15000 }, async t => {
  const connections = new Set();
  let brokerSocket;
  let subscribed = false;
  const broker = createServer(socket => {
    connections.add(socket);
    socket.on('close', () => connections.delete(socket));
    const parser = mqttPacket.parser();
    socket.on('data', b => parser.parse(b));
    parser.on('packet', packet => {
      if (packet.cmd === 'connect') socket.write(mqttPacket.generate({ cmd: 'connack', returnCode: 0 }));
      if (packet.cmd === 'subscribe') {
        brokerSocket = socket;
        socket.write(mqttPacket.generate({ cmd: 'suback', messageId: packet.messageId, granted: packet.subscriptions.map(() => 0) }));
        subscribed = true;
      }
      if (packet.cmd === 'pingreq') socket.write(mqttPacket.generate({ cmd: 'pingresp' }));
    });
  });
  broker.listen(0, '127.0.0.1');
  await once(broker, 'listening');
  t.after(() => { connections.forEach(s => s.destroy()); broker.close(); });
  const url = await gateway(t, { GATEWAY_MODE: 'MQTT', MQTT_BROKER_URL: `mqtt://127.0.0.1:${broker.address().port}` });
  const a = session(t, url);
  await authenticate(a);
  for (let i=0;!subscribed && i<100;i++) await delay(20);
  assert.equal(subscribed, true);
  a.ws.send(JSON.stringify({ type: 'SET_GEOFENCE', active: true }));
  await a.wait(m => m.type === 'COMMAND_ERROR');
  const topic = 'factory/workshop1/agv/01/telemetry';
  const publish = (data, destination = topic) => brokerSocket.write(mqttPacket.generate({
    cmd: 'publish', topic: destination, qos: 0, payload: JSON.stringify(data)
  }));
  publish({ id: 'AGV_01', position: { x: 1 }, heading: 0 });
  publish({ id: 'AGV_02', position: { x: 1, z: 2 }, heading: 0 });
  await delay(100);
  assert.equal(a.messages.some(m => m.type === 'AGV_POSE'), false);
  publish({ id: 'AGV_01', position: { x: 1, z: 2 }, heading: 0, hasPayload: true });
  const telemetry = await a.wait(m => m.type === 'AGV_POSE');
  assert.equal(telemetry.data.hasPayload, undefined);
  assert.equal(telemetry.data.position.z, 2);
});
