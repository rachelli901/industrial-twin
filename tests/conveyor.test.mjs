import test from 'node:test';
import assert from 'node:assert/strict';
import { advanceConveyor } from '../src/utils/conveyor.ts';
import { parsePose, parseSlot } from '../src/utils/telemetryProtocol.ts';

test('conveyor advances once and safely removes multiple exiting boxes', () => {
  const boxes = [{ currentZ: 0 }];
  advanceConveyor(boxes, 0.1);
  assert.equal(boxes[0].currentZ, 0.12);
  const exiting = [{ currentZ: 3.7 }, { currentZ: 3.7 }];
  assert.equal(advanceConveyor(exiting, 0.1).exited.length, 2);
  assert.equal(exiting.length, 0);
});
test('sensor counts each crossing once, including large frame deltas', () => {
  const boxes = [{ currentZ: 0.4 }, { currentZ: 0.45 }];
  assert.equal(advanceConveyor(boxes, 1).passes, 2);
  assert.equal(advanceConveyor(boxes, 0.1).passes, 0);
});
test('telemetry validators reject invalid values and strip extra keys', () => {
  const pose = { id: 'AGV_01', position: { x: 0, z: 0 }, heading: 0 };
  for (const value of [null, {}, { ...pose, battery: 101 }, { ...pose, heading: NaN }, { ...pose, status: 'BAD' }, { ...pose, metrics: { vibration: -1 } }]) assert.equal(parsePose(value), null);
  assert.equal(parsePose({ ...pose, hasPayload: true }).hasPayload, undefined);
  assert.equal(parseSlot({ id: 'LOC-1-1', status: 'BAD' }), null);
  assert.deepEqual(parseSlot({ id: 'LOC-1-1', status: 'EMPTY' }), { id: 'LOC-1-1', status: 'EMPTY' });
});
