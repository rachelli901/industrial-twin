import test from 'node:test';
import assert from 'node:assert/strict';
import { createPinia, setActivePinia } from 'pinia';
import { useWarehouseStore } from '../src/stores/warehouse.ts';
import { SimulationEngine } from '../server/SimulationEngine.ts';

function setup(t) {
  globalThis.window = globalThis;
  t.mock.timers.enable({ apis: ['Date', 'setTimeout', 'setInterval'], now: 100000 });
  setActivePinia(createPinia());
  const store = useWarehouseStore();
  store.gatewayMode = 'MOCK'; store.connectionStatus = 'CONNECTED';
  t.after(() => store.$dispose());
  return store;
}
const pose = (status = 'NAVIGATING', x = 1) => ({ id: 'AGV_01', position: { x, z: 2 }, heading: 0, battery: 80, status });

test('UI queues a command; only server snapshot changes task and inventory state', t => {
  const s = setup(t), engine = new SimulationEngine();
  s.applyOperations(engine.snapshot());
  s.triggerPickTask('LOC-1-1');
  assert.equal(s.slots[0].status, 'OCCUPIED');
  assert.equal(s.tasks.length, 0);
  const command = s.commandQueue.shift();
  const result = engine.dispatch(command);
  s.handleCommandResult(result);
  s.applyOperations(engine.snapshot());
  assert.equal(s.slots[0].status, 'PICKING');
  assert.equal(s.tasks.length, 1);
  assert.equal(s.pendingCommands[command.id], undefined);
});
test('command timeout is explicit and never automatically redispatches', t => {
  const s = setup(t);
  s.triggerPickTask('LOC-1-1');
  s.commandQueue.splice(0);
  t.mock.timers.tick(11000);
  s.expireCommands();
  assert.equal(Object.keys(s.pendingCommands).length, 0);
  assert.equal(s.commandQueue.length, 0);
  assert.equal(s.commandResults[0].accepted, false);
  assert.equal(s.taskCount, 0);
});
test('playback buffers authoritative live snapshots and restores paused state/cargo', t => {
  const s = setup(t), engine = new SimulationEngine();
  s.applyOperations(engine.snapshot());
  t.mock.timers.tick(2000);
  s.applyOperations(engine.snapshot());
  s.togglePlaybackMode();
  assert.equal(s.isPlaybackMode, true);
  engine.dispatch({ id: 'pause', kind: 'PAUSE', deviceId: 'AGV_01' });
  s.applyOperations(engine.snapshot());
  assert.equal(s.agvs.AGV_01.status, 'IDLE');
  s.togglePlaybackMode();
  assert.equal(s.agvs.AGV_01.status, 'ALARM');
});
test('1x playback follows recorded elapsed time including gaps', t => {
  const s = setup(t);
  s.updateAgv('AGV_01', pose('NAVIGATING', 1));
  t.mock.timers.tick(1000); s.updateAgv('AGV_01', pose('NAVIGATING', 2));
  t.mock.timers.tick(9000); s.updateAgv('AGV_01', pose('NAVIGATING', 3));
  s.togglePlaybackMode(); s.seekProgress(20);
  assert.equal(s.agvs.AGV_01.position.x, 2);
  s.seekProgress(0); s.togglePlayPause();
  t.mock.timers.tick(1000);
  assert.ok(Math.abs(s.playbackProgress - 10) < .001);
});
test('untrusted pose cannot overwrite payload or poison coordinates', t => {
  const s = setup(t);
  s.updateAgv('AGV_01', { ...pose(), position: { x: 1 } });
  assert.ok(Number.isFinite(s.interAgvDistance));
  s.updateAgv('AGV_01', { ...pose(), hasPayload: true, name: 'injected' });
  assert.equal(s.agvs.AGV_01.hasPayload, false);
  assert.notEqual(s.agvs.AGV_01.name, 'injected');
});
test('MQTT and offline modes never create local simulation tasks', t => {
  const s = setup(t);
  s.gatewayMode = 'MQTT'; s.triggerPickTask('LOC-1-1'); s.toggleAlarm('AGV_01');
  assert.equal(s.commandQueue.length, 0);
  s.gatewayMode = 'MOCK'; s.connectionStatus = 'STALE'; s.pickAll();
  assert.equal(s.commandQueue.length, 0);
});
