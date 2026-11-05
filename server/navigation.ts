import type { Point } from '../src/domain/operations.ts';

export const ROBOT_CLEARANCE = 0.45;
export const SEPARATION = 1.0;
export const fence = { x: -0.2, z: -0.2, radius: 2 };
export const charger = { x: -4.5, z: 2 };
export const dropoff = { x: 2.25, z: -1.75 };
export const homes: Record<string, Point> = { AGV_01: { x: -3.5, z: -0.75 }, AGV_02: { x: 1.5, z: 2.5 } };
export const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.z - b.z);
const obstacles = [
  { left: -4, right: 0, top: -2.5, bottom: -1.5 }, // rack
  { left: 3, right: 4, top: -2, bottom: 4 }, // conveyor
  { left: -4.75, right: -4.25, top: 0.7, bottom: 1.1 } // charging cabinet
];
const bollards: Point[] = [[-4.6, -1.2], [-4.6, -2.8], [0.6, -1.2], [0.6, -2.8], [4.2, -2], [4.2, 4]].map(([x, z]) => ({ x: x!, z: z! }));
export function walkable(point: Point, geofence: boolean) {
  if (point.x < -6 || point.x > 6 || point.z < -4 || point.z > 5) return false;
  if (obstacles.some(r => point.x > r.left - ROBOT_CLEARANCE && point.x < r.right + ROBOT_CLEARANCE &&
      point.z > r.top - ROBOT_CLEARANCE && point.z < r.bottom + ROBOT_CLEARANCE)) return false;
  if (bollards.some(p => distance(point, p) < ROBOT_CLEARANCE + 0.06)) return false;
  return !geofence || distance(point, fence) >= fence.radius + ROBOT_CLEARANCE;
}
export function segmentClear(a: Point, b: Point, active: boolean, others: Point[] = []) {
  const count = Math.max(1, Math.ceil(distance(a, b) / 0.05));
  for (let i = 0; i <= count; i++) {
    const p = { x: a.x + (b.x - a.x) * i / count, z: a.z + (b.z - a.z) * i / count };
    if (!walkable(p, active) || others.some(other => distance(p, other) < SEPARATION - 0.001)) return false;
  }
  return true;
}

/** A* on a 25 cm grid; no diagonals, so inflated obstacle corners cannot be cut. */
export function findPath(start: Point, goal: Point, active: boolean, others: Point[] = []): Point[] | null {
  const cell = (p: Point) => ({ x: Math.round(p.x * 4), z: Math.round(p.z * 4) });
  const origin = cell(start), to = cell(goal);
  const key = (p: Point) => `${p.x},${p.z}`;
  const point = (k: string): Point => { const [x, z] = k.split(',').map(Number); return { x: x! / 4, z: z! / 4 }; };
  const valid = (p: Point) => walkable(p, active) && others.every(other => distance(p, other) >= SEPARATION);
  const candidates: Point[] = [];
  for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) candidates.push({ x: origin.x + dx, z: origin.z + dz });
  candidates.sort((a, b) => distance({ x: a.x / 4, z: a.z / 4 }, start) - distance({ x: b.x / 4, z: b.z / 4 }, start));
  const from = candidates.find(p => valid({ x: p.x / 4, z: p.z / 4 }) && segmentClear(start, { x: p.x / 4, z: p.z / 4 }, active, others));
  if (!from || !valid(goal)) return null;
  const first = key(from), last = key(to);
  const open = new Set([first]);
  const scores = new Map([[first, 0]]);
  const parent = new Map<string, string>();
  const estimate = (k: string) => distance(point(k), goal) * 4;
  while (open.size) {
    let current = '', best = Infinity;
    for (const k of open) { const score = scores.get(k)! + estimate(k); if (score < best) { best = score; current = k; } }
    if (current === last) {
      const route = [goal];
      while (parent.has(current)) { current = parent.get(current)!; route.unshift(point(current)); }
      return route;
    }
    open.delete(current);
    const p = cell(point(current));
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const next = { x: p.x + dx!, z: p.z + dz! }, k = key(next);
      if (!valid({ x: next.x / 4, z: next.z / 4 }) || !segmentClear(point(current), point(k), active, others)) continue;
      const score = scores.get(current)! + 1;
      if (score >= (scores.get(k) ?? Infinity)) continue;
      scores.set(k, score); parent.set(k, current); open.add(k);
    }
  }
  return null;
}
