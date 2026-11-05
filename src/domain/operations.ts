import { parsePose, parseSlot } from '../utils/telemetryProtocol.ts';

export type Point = { x: number; z: number };
export type TaskPhase = 'TO_PICK' | 'PICKING' | 'TO_DROP' | 'UNLOADING' | 'TO_CHARGER' | 'CHARGING' | 'RETURNING';
export type TaskStatus = 'QUEUED' | 'RUNNING' | 'PAUSED' | 'BLOCKED' | 'COMPLETED';
export type Task = {
  id: string; kind: 'PICK' | 'CHARGE'; slotId?: string; deviceId?: string;
  phase: TaskPhase; status: TaskStatus; progress: number; reason: string;
  createdAt: number; completedAt?: number;
};
export type Robot = {
  id: string; position: Point; heading: number; battery: number; speed: number;
  status: 'NAVIGATING' | 'PICKING' | 'DELIVERING' | 'IDLE' | 'ALARM' | 'CHARGING';
  hasPayload: boolean; paused: boolean; taskId: string | null; route: Point[];
  liftHeight: number; workProgress: number;
  metrics: { motorTemp: number; vibration: number; mileage: number; healthScore: number };
};
export type OperationsState = {
  revision: number; time: number; geofenceActive: boolean; tasks: Task[]; robots: Robot[];
  slots: { id: string; tier: number; col: number; status: 'EMPTY' | 'OCCUPIED' | 'PICKING' }[];
  completedCount: number; conveyorCount: number; conveyorBoxes: { id: string; currentZ: number }[];
};
export type Command = { id: string } & (
  | { kind: 'PICK'; slotId: string }
  | { kind: 'CHARGE' | 'PAUSE' | 'RESUME'; deviceId: string }
  | { kind: 'SET_GEOFENCE'; active: boolean }
  | { kind: 'PICK_ALL' | 'RESTOCK' }
);
export type CommandResult = { requestId: string; accepted: boolean; message: string; taskId?: string };
export interface OperationsAdapter {
  dispatch(command: Command): CommandResult;
  snapshot(): OperationsState;
  tick(delta: number): void;
}
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const number = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
export function parseCommand(v: unknown): Command | null {
  if (!object(v) || typeof v.id !== 'string' || !/^[\w-]{1,80}$/.test(v.id)) return null;
  if (v.kind === 'PICK' && typeof v.slotId === 'string' && /^LOC-[1-3]-[1-4]$/.test(v.slotId)) return { id: v.id, kind: v.kind, slotId: v.slotId };
  if (['CHARGE', 'PAUSE', 'RESUME'].includes(String(v.kind)) && ['AGV_01', 'AGV_02'].includes(String(v.deviceId))) return { id: v.id, kind: v.kind, deviceId: v.deviceId } as Command;
  if (v.kind === 'SET_GEOFENCE' && typeof v.active === 'boolean') return { id: v.id, kind: v.kind, active: v.active };
  if (v.kind === 'PICK_ALL' || v.kind === 'RESTOCK') return { id: v.id, kind: v.kind };
  return null;
}
export function parseOperationsState(v: unknown): OperationsState | null {
  if (!object(v) || !number(v.revision) || !number(v.time) || typeof v.geofenceActive !== 'boolean' ||
      !number(v.completedCount) || !number(v.conveyorCount) || !Array.isArray(v.robots) || v.robots.length !== 2 ||
      !Array.isArray(v.slots) || v.slots.length !== 12 || !Array.isArray(v.tasks) || v.tasks.length > 100 ||
      !Array.isArray(v.conveyorBoxes) || v.conveyorBoxes.length > 100) return null;
  if (!v.robots.every(r => object(r) && parsePose(r) && typeof r.hasPayload === 'boolean' && typeof r.paused === 'boolean' &&
      (r.taskId === null || typeof r.taskId === 'string') && number(r.liftHeight) && number(r.workProgress) &&
      Array.isArray(r.route) && r.route.length <= 3000 && r.route.every(p => object(p) && number(p.x) && number(p.z)))) return null;
  if (!v.slots.every(s => object(s) && parseSlot(s) && number(s.tier) && number(s.col))) return null;
  if (!v.tasks.every(t => object(t) && typeof t.id === 'string' && ['PICK', 'CHARGE'].includes(String(t.kind)) &&
      ['QUEUED', 'RUNNING', 'PAUSED', 'BLOCKED', 'COMPLETED'].includes(String(t.status)) &&
      ['TO_PICK', 'PICKING', 'TO_DROP', 'UNLOADING', 'TO_CHARGER', 'CHARGING', 'RETURNING'].includes(String(t.phase)) &&
      number(t.progress) && number(t.createdAt) && typeof t.reason === 'string')) return null;
  if (!v.conveyorBoxes.every(b => object(b) && typeof b.id === 'string' && number(b.currentZ))) return null;
  return v as OperationsState;
}
