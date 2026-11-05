// Load local configuration without overriding explicitly supplied environment variables.
try { process.loadEnvFile(); } catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
}

import { WebSocketServer, WebSocket } from 'ws';
import * as mqtt from 'mqtt';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { SimulationEngine } from './server/SimulationEngine.ts';
import { parseCommand } from './src/domain/operations.ts';
import { parsePose, parseSlot } from './src/utils/telemetryProtocol.ts';

const WS_PORT = Number(process.env.WS_PORT || 8080);
const PROTOCOL_MODE = process.env.GATEWAY_MODE || 'MOCK';
if (!['MOCK', 'MQTT'].includes(PROTOCOL_MODE)) throw new Error('Invalid GATEWAY_MODE');
if (PROTOCOL_MODE === 'MQTT' && !process.env.GATEWAY_TOKEN) throw new Error('MQTT requires GATEWAY_TOKEN');
const token = process.env.GATEWAY_TOKEN || randomBytes(24).toString('hex');
if (!process.env.GATEWAY_TOKEN) console.log(`[Gateway] 临时访问令牌: ${token}`);
const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:5173,http://127.0.0.1:5173,http://localhost:7000,http://127.0.0.1:7000').split(',').map(s => s.trim());
const MQTT_BROKER_URL = process.env.MQTT_BROKER_URL || 'mqtt://127.0.0.1:1883';
const wss = new WebSocketServer({
  host: process.env.WS_HOST || '127.0.0.1', port: WS_PORT, path: '/v1/telemetry', maxPayload: 8192,
  verifyClient: (info: { origin: string }) => allowedOrigins.includes(info.origin)
});
wss.on('listening', () => console.log(`[Gateway] ${PROTOCOL_MODE} listening on ${WS_PORT}`));
const clients = new Set<WebSocket>();
const simulation = PROTOCOL_MODE === 'MOCK' ? new SimulationEngine() : null;
let brokerConnected = PROTOCOL_MODE === 'MOCK';
const systemInfo = () => ({ type: 'SYSTEM_INFO', data: {
  gatewayMode: PROTOCOL_MODE, serverTime: new Date().toISOString(), geofenceActive: simulation?.snapshot().geofenceActive ?? false,
  brokerConnected, geofenceSupported: PROTOCOL_MODE === 'MOCK'
} });
function send(ws: WebSocket, message: object) {
  if (ws.readyState !== WebSocket.OPEN) return;
  if (ws.bufferedAmount > 1024 * 1024) { ws.terminate(); return; }
  ws.send(JSON.stringify(message), err => { if (err) ws.terminate(); });
}
function broadcast(message: object) { for (const ws of clients) send(ws, message); }
function publishOperations(target?: WebSocket) {
  if (!simulation) return;
  const state = simulation.snapshot();
  const emit = (message: object) => target ? send(target, message) : broadcast(message);
  emit({ type: 'OPERATIONS_STATE', data: state });
  for (const robot of state.robots) emit({ type: 'AGV_POSE', data: robot });
}
wss.on('error', err => console.error('[Gateway]', err.message));
wss.on('connection', ws => {
  let authenticated = false;
  let windowStart = Date.now();
  let count = 0;
  const authTimeout = setTimeout(() => ws.close(1008, 'Authentication timeout'), 15000);
  send(ws, { type: 'AUTH_REQUIRED' });
  ws.on('error', () => ws.terminate());
  ws.on('message', message => {
    if (Date.now() - windowStart > 1000) { windowStart = Date.now(); count = 0; }
    if (++count > 20) { ws.close(1008, 'Rate limit'); return; }
    try {
      const msg = JSON.parse(message.toString());
      if (!msg || typeof msg !== 'object') return;
      if (!authenticated) {
        const supplied = typeof msg.token === 'string' ? Buffer.from(msg.token) : Buffer.alloc(0);
        const expected = Buffer.from(token);
        if (msg.type !== 'AUTH' || supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
          ws.close(1008, 'Authentication failed'); return;
        }
        clearTimeout(authTimeout);
        authenticated = true;
        clients.add(ws);
        send(ws, systemInfo());
        publishOperations(ws);
        return;
      }
      if (msg.type === 'PING') { send(ws, { type: 'PONG' }); return; }
      if (msg.type === 'COMMAND') {
        const command = parseCommand(msg.data);
        const result = !command ? { requestId: typeof msg.data?.id === 'string' ? msg.data.id : '', accepted: false, message: '无效指令' }
          : simulation ? simulation.dispatch(command) : { requestId: command.id, accepted: false, message: '现场 RCS 控制适配器尚未配置，指令已拒绝' };
        send(ws, { type: 'COMMAND_RESULT', data: result });
        if (result.accepted) console.log(`[Dispatch] ${command!.kind} ${command!.id}`);
        publishOperations();
        return;
      }
      // Compatibility with existing clients; all state still belongs to the engine.
      if (msg.type === 'SET_GEOFENCE' && typeof msg.active === 'boolean') {
        const result = simulation?.dispatch({ id: randomBytes(12).toString('hex'), kind: 'SET_GEOFENCE', active: msg.active });
        if (!result?.accepted) send(ws, { type: 'COMMAND_ERROR', data: { message: result?.message || '现场围栏控制协议未配置，操作已拒绝' } });
        else { broadcast({ type: 'GEOFENCE_STATUS', data: { active: msg.active } }); publishOperations(); }
      }
    } catch { /* Invalid messages never reach application state. */ }
  });
  ws.on('close', () => { clearTimeout(authTimeout); clients.delete(ws); });
});

function startMqttAdapter() {
  const client = mqtt.connect(MQTT_BROKER_URL, {
    username: process.env.MQTT_USERNAME, password: process.env.MQTT_PASSWORD,
    reconnectPeriod: 3000, connectTimeout: 5000
  });
  const offline = () => { brokerConnected = false; broadcast(systemInfo()); };
  client.on('offline', offline);
  client.on('close', offline);
  client.on('connect', () => {
    client.subscribe(['factory/workshop1/agv/+/telemetry', 'factory/workshop1/storage/slot/+/status'], (err, grants) => {
      brokerConnected = !err && !!grants?.length && grants.every(g => g.qos !== 128);
      broadcast(systemInfo());
    });
  });
  client.on('message', (topic, payload) => {
    if (payload.length > 8192) return;
    try {
      const data = JSON.parse(payload.toString());
      const agvTopic = /^factory\/workshop1\/agv\/(01|02)\/telemetry$/.exec(topic);
      const slotTopic = /^factory\/workshop1\/storage\/slot\/(LOC-[1-3]-[1-4])\/status$/.exec(topic);
      if (agvTopic) {
        const pose = parsePose(data);
        if (pose && pose.id === `AGV_${agvTopic[1]}`) broadcast({ type: 'AGV_POSE', data: pose });
      } else if (slotTopic) {
        const slot = parseSlot(data);
        if (slot && slot.id === slotTopic[1]) broadcast({ type: 'SLOT_UPDATE', data: slot });
      }
    } catch { /* Reject malformed telemetry. */ }
  });
  client.on('error', err => console.error('[MQTT]', err.message));
}

if (simulation) {
  let lastTick = performance.now();
  setInterval(() => {
    const now = performance.now();
    simulation.tick((now - lastTick) / 1000);
    lastTick = now;
    publishOperations();
  }, 100);
} else startMqttAdapter();
