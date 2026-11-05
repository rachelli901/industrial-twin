import test from 'node:test';
import assert from 'node:assert/strict';
import { SimulationEngine } from '../server/SimulationEngine.ts';
import { charger, distance, dropoff, homes, walkable } from '../server/navigation.ts';
import { parseCommand, parseOperationsState } from '../src/domain/operations.ts';

function runUntil(engine, predicate, seconds = 180) {
  for (let i=0; i < seconds * 10; i++) {
    engine.tick(.1);
    const state = engine.snapshot();
    assert.ok(distance(state.robots[0].position, state.robots[1].position) >= .999, 'robots keep physical clearance');
    assert.ok(state.robots.every(r => walkable(r.position, state.geofenceActive)), 'no robot crosses static obstacles or fence');
    if (predicate(state)) return state;
  }
  throw new Error(`simulation did not reach expected state: ${JSON.stringify(engine.snapshot().tasks)}`);
}
test('six queued orders execute end to end with two robots and real arrivals', () => {
  const engine = new SimulationEngine();
  assert.equal(engine.dispatch({ id: 'all', kind: 'PICK_ALL' }).accepted, true);
  const state = runUntil(engine, s => s.completedCount === 6);
  assert.equal(state.conveyorCount, 6);
  assert.equal(state.slots.filter(s => s.status === 'OCCUPIED').length, 0);
  assert.equal(new Set(state.tasks.map(t => t.deviceId)).size, 2);
  assert.ok(state.robots.every(r => !r.hasPayload && distance(r.position, homes[r.id]) < .01));
  assert.ok(parseOperationsState(state));
});
test('loading occurs at the correct shelf and unloading occurs only at the conveyor', () => {
  const engine = new SimulationEngine();
  engine.dispatch({ id: 'pick', kind: 'PICK', slotId: 'LOC-3-3' });
  const picked = runUntil(engine, s => s.robots.some(r => r.hasPayload));
  const robot = picked.robots.find(r => r.hasPayload);
  assert.ok(distance(robot.position, { x: -1.5, z: -.75 }) < .01);
  assert.ok(robot.liftHeight > 2);
  assert.equal(picked.slots.find(s => s.id === 'LOC-3-3').status, 'EMPTY');
  const dropped = runUntil(engine, s => s.conveyorBoxes.length > 0);
  assert.ok(distance(dropped.robots.find(r => r.id === robot.id).position, dropoff) < .01);
});
test('paused vehicle preserves task, position and cargo, then resumes to completion', () => {
  const engine = new SimulationEngine();
  engine.dispatch({ id: 'pick', kind: 'PICK', slotId: 'LOC-1-1' });
  const picked = runUntil(engine, s => s.robots.some(r => r.hasPayload));
  const before = picked.robots.find(r => r.hasPayload);
  engine.dispatch({ id: 'pause', kind: 'PAUSE', deviceId: before.id });
  for(let i=0;i<100;i++) engine.tick(.1);
  const paused = engine.snapshot().robots.find(r => r.id === before.id);
  assert.deepEqual(paused.position, before.position);
  assert.equal(paused.hasPayload, true);
  assert.equal(engine.snapshot().tasks[0].status, 'PAUSED');
  engine.dispatch({ id: 'resume', kind: 'RESUME', deviceId: before.id });
  runUntil(engine, s => s.completedCount === 1);
});
test('charge task drives to the charger before battery increases and returns home', () => {
  const engine = new SimulationEngine();
  engine.dispatch({ id: 'charge', kind: 'CHARGE', deviceId: 'AGV_02' });
  let previousBattery = 65;
  const state = runUntil(engine, s => {
    const robot = s.robots[1];
    if (robot.battery > previousBattery + .0001) assert.ok(distance(robot.position, charger) < .01);
    previousBattery = robot.battery;
    return s.tasks[0].status === 'COMPLETED';
  });
  assert.ok(state.robots[1].battery > 99);
});
test('request IDs and inventory reservations prevent duplicate tasks', () => {
  const engine = new SimulationEngine();
  const command = { id: 'same', kind: 'PICK', slotId: 'LOC-1-1' };
  assert.deepEqual(engine.dispatch(command), engine.dispatch(command));
  assert.equal(engine.dispatch({ ...command, id: 'other' }).accepted, false);
  assert.equal(engine.snapshot().tasks.length, 1);
  assert.equal(engine.dispatch({ id: 'stock', kind: 'RESTOCK' }).accepted, false);
  assert.equal(parseCommand({ id: 'bad', kind: 'CHARGE', deviceId: 'unknown' }), null);
});
test('blocked fence destination waits without consuming stock and recovers when cleared', () => {
  const engine = new SimulationEngine();
  assert.equal(engine.dispatch({ id: 'fence', kind: 'SET_GEOFENCE', active: true }).accepted, true);
  engine.dispatch({ id: 'pick', kind: 'PICK', slotId: 'LOC-1-3' });
  runUntil(engine, s => s.tasks[0].status === 'BLOCKED');
  assert.equal(engine.snapshot().robots.some(r => r.hasPayload), false);
  engine.dispatch({ id: 'clear', kind: 'SET_GEOFENCE', active: false });
  runUntil(engine, s => s.completedCount === 1);
});
test('restocking permits a second full shift without deadlocks', () => {
  const engine = new SimulationEngine();
  engine.dispatch({ id: 'first', kind: 'PICK_ALL' });
  runUntil(engine, s => s.completedCount === 6);
  assert.equal(engine.dispatch({ id: 'restock', kind: 'RESTOCK' }).accepted, true);
  engine.dispatch({ id: 'second', kind: 'PICK_ALL' });
  runUntil(engine, s => s.completedCount === 18, 360);
});
